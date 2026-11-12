import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import asar
import install


def make_archive(root, version='v1'):
    root = Path(root)
    src = root / 'source'
    resources = root / 'resources'
    resources.mkdir(parents=True)
    files = {
        'dist/preload.js': 'globalThis.fixture = %s;\n' % json.dumps(version),
        'dist/main.js': 'globalThis.fixtureMain = %s;\n' % json.dumps(version),
        'dist/ideInstall/wizardPreload.js': 'globalThis.wizard = true;\n',
        'dist/native/helper.bin': 'native-' + version,
        'node_modules/chrome-devtools-mcp/helper': '#!/bin/sh\necho ' + version,
        'packed.txt': 'packed-' + version,
        'empty.txt': '',
    }
    for name, data in files.items():
        target = src / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(data, encoding='utf-8')
    executable = src / 'node_modules/chrome-devtools-mcp/helper'
    executable.chmod(0o755)
    archive = resources / 'app.asar'
    asar.pack(src, archive, ['dist/native/**', '**/node_modules/chrome-devtools-mcp/**'],
              metadata={'node_modules/chrome-devtools-mcp/helper': {'executable': True}})
    return archive


def raw_archive(path, entries, payload=b''):
    header = json.dumps({'files': entries}).encode()
    padded = header + b'\0' * (-len(header) % 4)
    Path(path).write_bytes(struct.pack('<IIII', 4, 8 + len(padded), 4 + len(padded), len(header)) + padded + payload)


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = make_archive(self.root)

    def test_roundtrip_preserves_payload_layout_and_executable(self):
        metadata = asar.manifest(self.archive)
        out = self.root / 'out'
        asar.extract(self.archive, out)
        new = self.root / 'new.asar'
        asar.pack(out, new, metadata=metadata)
        self.assertEqual(asar.list_files(self.archive), asar.list_files(new))
        for rel in metadata:
            self.assertEqual(asar.read_file(self.archive, rel), asar.read_file(new, rel))
        helper = Path(str(new) + '.unpacked/node_modules/chrome-devtools-mcp/helper')
        self.assertTrue(asar.manifest(new)['node_modules/chrome-devtools-mcp/helper'].get('executable'))
        if os.name != 'nt':
            self.assertTrue(helper.stat().st_mode & 0o111)

    def test_missing_unpacked_fails_without_placeholders(self):
        Path(str(self.archive) + '.unpacked/dist/native/helper.bin').unlink()
        with self.assertRaises(FileNotFoundError):
            asar.extract(self.archive, self.root / 'out')
        self.assertFalse((self.root / 'out').exists())

    def test_skip_unpacked_does_not_create_empty_files(self):
        asar.extract(self.archive, self.root / 'out', with_unpacked=False)
        self.assertFalse((self.root / 'out/dist/native/helper.bin').exists())
        self.assertTrue((self.root / 'out/dist/preload.js').exists())

    def test_empty_directories_survive_roundtrip(self):
        raw_archive(self.root / 'empty.asar', {'empty': {'files': {}}})
        asar.extract(self.root / 'empty.asar', self.root / 'out')
        self.assertTrue((self.root / 'out/empty').is_dir())
        asar.pack(self.root / 'out', self.root / 'empty2.asar')
        asar.extract(self.root / 'empty2.asar', self.root / 'out2')
        self.assertTrue((self.root / 'out2/empty').is_dir())

    def test_truncated_payload_rejected(self):
        self.archive.write_bytes(self.archive.read_bytes()[:-1])
        with self.assertRaisesRegex(ValueError, '截断'):
            asar.extract(self.archive, self.root / 'out')

    def test_path_traversal_variants_rejected_before_writing(self):
        for name in ['../escape', '/absolute', 'a/b', 'a\\b', 'C:escape', '..', 'NUL', 'trailing.']:
            with self.subTest(name=name):
                raw_archive(self.root / 'bad.asar', {name: {'size': 1, 'offset': '0'}}, b'x')
                with self.assertRaises(ValueError):
                    asar.extract(self.root / 'bad.asar', self.root / 'out')
        self.assertFalse((self.root / 'out').exists())

    @unittest.skipIf(os.name == 'nt', 'symlink creation requires Windows privileges')
    def test_destination_symlink_escape_rejected(self):
        out = self.root / 'out'
        outside = self.root / 'outside'
        out.mkdir(); outside.mkdir()
        (out / 'dist').symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            asar.extract(self.archive, out)
        self.assertEqual(list(outside.iterdir()), [])

    def test_unpack_directory_flag_is_inherited(self):
        raw_archive(self.root / 'dir.asar', {'dir': {'unpacked': True, 'files': {'x': {'size': 1}}}})
        sidecar = self.root / 'dir.asar.unpacked/dir/x'
        sidecar.parent.mkdir(parents=True); sidecar.write_bytes(b'x')
        self.assertTrue(asar.manifest(self.root / 'dir.asar')['dir/x']['unpacked'])
        asar.extract(self.root / 'dir.asar', self.root / 'out')
        self.assertEqual((self.root / 'out/dir/x').read_bytes(), b'x')

    def test_single_read_does_not_need_unrelated_sidecars(self):
        shutil.rmtree(str(self.archive) + '.unpacked')
        self.assertIn(b'fixture', asar.read_file(self.archive, 'dist/preload.js'))

    def test_invalid_header_lengths_rejected(self):
        for lengths in [(4, 8, 4, 0xffffffff), (4, 12, 5, 2), (4, 0xfffffffc, 4, 2)]:
            with self.subTest(lengths=lengths):
                bad = self.root / 'bad.asar'
                bad.write_bytes(struct.pack('<IIII', *lengths) + b'{}\0\0')
                with self.assertRaises(ValueError):
                    asar.manifest(bad)

    def test_integrity_uses_streaming_blocks_and_handles_empty(self):
        path = self.root / 'large'
        path.write_bytes(b'a' * (asar.BLOCK_SIZE + 3))
        result = asar._file_integrity(path)
        self.assertEqual(result['hash'], hashlib.sha256(path.read_bytes()).hexdigest())
        self.assertEqual(len(result['blocks']), 2)
        path.write_bytes(b'')
        self.assertEqual(asar._file_integrity(path)['blocks'], [hashlib.sha256(b'').hexdigest()])


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = make_archive(self.root)
        self.home = self.root / 'home'
        self.output = io.StringIO()
        for patcher in [patch.object(install, 'check_app_running', return_value=False),
                        patch.object(install, 'codesign_macos', return_value=True),
                        patch.object(install.os.path, 'expanduser', return_value=str(self.home)),
                        contextlib.redirect_stdout(self.output)]:
            patcher.__enter__()
            self.addCleanup(patcher.__exit__, None, None, None)

    def run_install(self):
        install.cmd_install(str(self.archive), str(self.archive.parent))

    def run_restore(self):
        install.cmd_restore(str(self.archive), str(self.archive.parent))

    def test_install_repeat_restore_complete_pair(self):
        original = self.archive.read_bytes()
        entries = asar.manifest(self.archive)
        payloads = {rel: asar.read_file(self.archive, rel) for rel in entries}
        self.run_install()
        first = self.archive.read_bytes()
        self.run_install()
        self.assertEqual(first, self.archive.read_bytes())
        self.assertEqual(original, Path(str(self.archive) + '.bak').read_bytes())
        self.assertTrue(Path(str(self.archive) + '.bak.unpacked/dist/native/helper.bin').exists())
        code = asar.read_file(self.archive, 'dist/preload.js').decode()
        self.assertEqual(code.count(install.ENGINE_START_MARKER), 1)
        self.run_restore()
        self.assertEqual(original, self.archive.read_bytes())
        for rel, data in payloads.items():
            self.assertEqual(asar.read_file(self.archive, rel), data)
        self.assertFalse(Path(str(self.archive) + '.agzh.lock').exists())

    def test_custom_dictionary_is_preserved(self):
        ext = self.home / '.antigravity-zh/zh-CN.json'
        ext.parent.mkdir(parents=True)
        ext.write_text('{"Settings":"个人设置"}', encoding='utf-8')
        before = ext.read_bytes()
        self.run_install()
        self.assertEqual(before, ext.read_bytes())

    def test_new_user_dictionary_is_empty_override(self):
        self.run_install()
        self.assertEqual(json.loads((self.home / '.antigravity-zh/zh-CN.json').read_text()), {})

    def test_restore_checks_running_process(self):
        with patch.object(install, 'check_app_running', return_value=True):
            with self.assertRaisesRegex(RuntimeError, '正在运行'):
                self.run_restore()
        self.assertFalse(Path(str(self.archive) + '.agzh.lock').exists())

    def test_legacy_backup_migrates_only_matching_sidecars(self):
        shutil.copy2(self.archive, str(self.archive) + '.bak')
        self.run_restore()
        self.assertTrue(Path(str(self.archive) + '.bak.unpacked/dist/native/helper.bin').exists())

    def test_legacy_backup_rejects_same_size_wrong_sidecar(self):
        shutil.copy2(self.archive, str(self.archive) + '.bak')
        sidecar = Path(str(self.archive) + '.unpacked/dist/native/helper.bin')
        sidecar.write_bytes(b'x' * sidecar.stat().st_size)
        before = self.archive.read_bytes()
        with self.assertRaisesRegex(ValueError, '校验失败'):
            self.run_restore()
        self.assertEqual(before, self.archive.read_bytes())
        self.assertFalse(Path(str(self.archive) + '.bak.unpacked').exists())

    def test_vendor_update_with_older_mtime_gets_current_backup(self):
        self.run_install()
        newer = make_archive(self.root / 'vendor', 'v2')
        install._replace_archive(str(newer), str(self.archive))
        os.utime(self.archive, (1, 1))
        expected = self.archive.read_bytes()
        self.run_install()
        self.assertEqual(expected, Path(str(self.archive) + '.bak').read_bytes())
        self.run_restore()
        self.assertEqual(asar.read_file(self.archive, 'dist/native/helper.bin'), b'native-v2')

    def test_patch_upgrades_legacy_marker_and_is_idempotent(self):
        preload = self.root / 'legacy.js'
        preload.write_text('globalThis.original = true;\n' + install.LEGACY_ENGINE_START_MARKER + '\n};})();\n')
        install.patch_file(str(preload), {'Settings': '设置'})
        first = preload.read_bytes()
        install.patch_file(str(preload), {'Settings': '设置'})
        self.assertEqual(first, preload.read_bytes())
        self.assertTrue(preload.read_text(encoding='utf-8').startswith('globalThis.original = true;'))
        self.assertNotIn(install.LEGACY_ENGINE_START_MARKER, preload.read_text(encoding='utf-8'))

    def test_status_never_extracts_archive(self):
        with patch.object(asar, 'extract', side_effect=AssertionError('must not extract')):
            install.cmd_status(str(self.archive))
        self.assertIn('未注入', self.output.getvalue())

    def test_quit_dialog_patch_preserves_inline_and_multiline_javascript(self):
        dist = self.root / 'dist'
        dist.mkdir()
        main = dist / 'main.js'
        for separator in (' ', '\n'):
            for trailing_comma in ('', ','):
                with self.subTest(separator=separator, trailing_comma=trailing_comma):
                    code = ("module.exports = {buttons: ['Cancel', 'Quit']," + separator +
                            "title: 'Confirm Quit'" + trailing_comma + "};")
                    main.write_text(code, encoding='utf-8')
                    install.patch_quit_dialog(str(self.root))
                    first = main.read_bytes()
                    install.patch_quit_dialog(str(self.root))
                    self.assertEqual(main.read_bytes(), first)
                    result = subprocess.run(
                        ['node', '-e', 'console.log(JSON.stringify(require(process.argv[1])))', str(main)],
                        capture_output=True, encoding='utf-8', check=True)
                    self.assertEqual(json.loads(result.stdout),
                                     {'buttons': ['取消', '退出'], 'title': '确认退出'})

    def test_quit_dialog_buttons_as_final_property(self):
        dist = self.root / 'dist'
        dist.mkdir()
        main = dist / 'main.js'
        main.write_text("module.exports = {buttons: ['Cancel', 'Quit']};", encoding='utf-8')
        install.patch_quit_dialog(str(self.root))
        subprocess.run(['node', '--check', str(main)], capture_output=True, check=True)

    def test_patch_loading_overlay_handles_text_and_svg_versions(self):
        dist = self.root / 'dist'
        dist.mkdir(exist_ok=True)
        overlay = dist / 'loadingOverlay.js'

        # 1. 旧版文本画面注入
        overlay.write_text('<div class="text">Loading Antigravity</div>', encoding='utf-8')
        install.patch_loading_overlay(str(self.root))
        self.assertIn('正在加载 Antigravity', overlay.read_text(encoding='utf-8'))
        self.assertIn('注入 加载画面翻译', self.output.getvalue())

        # 2. 已注入则幂等跳过
        self.output.truncate(0)
        self.output.seek(0)
        install.patch_loading_overlay(str(self.root))
        self.assertIn('已注入加载画面翻译，跳过', self.output.getvalue())

        # 3. 新版纯 SVG 动画无需汉化，友好跳过不报警告
        self.output.truncate(0)
        self.output.seek(0)
        overlay.write_text('<svg class="logo"></svg>', encoding='utf-8')
        install.patch_loading_overlay(str(self.root))
        self.assertIn('纯图形动画', self.output.getvalue())
        self.assertNotIn('[!]', self.output.getvalue())

    def test_failed_sidecar_or_archive_switch_rolls_back(self):
        newer = make_archive(self.root / 'new', 'v2')
        original = self.archive.read_bytes()
        real_replace = os.replace
        for fail_archive in (False, True):
            def replace(src, dst):
                fail = (str(dst) == str(self.archive) if fail_archive else
                        Path(src).name == 'app.asar.unpacked' and str(dst) == str(self.archive) + '.unpacked')
                if fail:
                    raise OSError('simulated switch failure')
                return real_replace(src, dst)
            with self.subTest(fail_archive=fail_archive):
                with patch.object(install.os, 'replace', side_effect=replace):
                    with self.assertRaises(OSError):
                        install._replace_archive(str(newer), str(self.archive))
                self.assertEqual(original, self.archive.read_bytes())
                self.assertEqual(asar.read_file(self.archive, 'dist/native/helper.bin'), b'native-v1')
                self.assertEqual(list(self.archive.parent.glob('.agzh_stage_*')), [])

    def test_copy_failure_does_not_touch_live_paths(self):
        newer = make_archive(self.root / 'new', 'v2')
        before = self.archive.read_bytes()
        with patch.object(install.shutil, 'copytree', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                install._replace_archive(str(newer), str(self.archive))
        self.assertEqual(before, self.archive.read_bytes())
        self.assertEqual(asar.read_file(self.archive, 'dist/native/helper.bin'), b'native-v1')

    def test_interruption_after_archive_rename_restores_both_parts(self):
        newer = make_archive(self.root / 'new', 'v2')
        before = self.archive.read_bytes()
        real_replace = os.replace
        def interrupt_after_replace(src, dst):
            real_replace(src, dst)
            if Path(src).name == 'app.asar' and str(dst) == str(self.archive):
                raise KeyboardInterrupt()
        with patch.object(install.os, 'replace', side_effect=interrupt_after_replace):
            with self.assertRaises(KeyboardInterrupt):
                install._replace_archive(str(newer), str(self.archive))
        self.assertEqual(before, self.archive.read_bytes())
        self.assertEqual(asar.read_file(self.archive, 'dist/native/helper.bin'), b'native-v1')

    def test_interruption_after_each_sidecar_rename_restores_both_parts(self):
        newer = make_archive(self.root / 'new', 'v2')
        before = self.archive.read_bytes()
        real_replace = os.replace
        for step in ('save_old', 'install_new'):
            def interrupt_after_replace(src, dst):
                real_replace(src, dst)
                if ((step == 'save_old' and Path(dst).name == 'previous.unpacked') or
                        (step == 'install_new' and Path(src).name == 'app.asar.unpacked'
                         and str(dst) == str(self.archive) + '.unpacked')):
                    raise KeyboardInterrupt()
            with self.subTest(step=step):
                with patch.object(install.os, 'replace', side_effect=interrupt_after_replace):
                    with self.assertRaises(KeyboardInterrupt):
                        install._replace_archive(str(newer), str(self.archive))
                self.assertEqual(before, self.archive.read_bytes())
                self.assertEqual(asar.read_file(self.archive, 'dist/native/helper.bin'), b'native-v1')
                self.assertEqual(list(self.archive.parent.glob('.agzh_stage_*')), [])

    def test_rollback_failure_keeps_recovery_files(self):
        newer = make_archive(self.root / 'new', 'v2')
        real_replace = os.replace
        def fail_switch_and_rollback(src, dst):
            if str(dst) == str(self.archive) or Path(src).name == 'previous.unpacked':
                raise OSError('filesystem refuses operation')
            return real_replace(src, dst)
        with patch.object(install.os, 'replace', side_effect=fail_switch_and_rollback):
            with self.assertRaisesRegex(RuntimeError, '恢复文件保留'):
                install._replace_archive(str(newer), str(self.archive))
        stages = list(self.archive.parent.glob('.agzh_stage_*'))
        self.assertEqual(len(stages), 1)
        self.assertTrue((stages[0] / 'previous.unpacked/dist/native/helper.bin').exists())
        self.assertTrue((stages[0] / 'previous.asar').exists())

    def test_refuses_patched_backup(self):
        self.run_install()
        shutil.copy2(self.archive, str(self.archive) + '.bak')
        with self.assertRaisesRegex(ValueError, '备份中含有'):
            self.run_restore()

    def test_lock_blocks_concurrent_mutation(self):
        lock = Path(str(self.archive) + '.agzh.lock')
        lock.write_text('another process')
        with self.assertRaisesRegex(RuntimeError, '安装锁'):
            self.run_install()
        self.assertEqual(lock.read_text(), 'another process')

    def test_cli_actions_are_mutually_exclusive(self):
        result = subprocess.run([sys.executable, 'install.py', '--status', '--restore'], capture_output=True)
        self.assertEqual(result.returncode, 2)


    def test_metrics_reinstall_disable_and_restore_preserve_main_process(self):
        original_archive = self.archive.read_bytes()
        original_main = asar.read_file(self.archive, 'dist/main.js')
        install.cmd_install(str(self.archive), str(self.archive.parent), metrics=True)
        with_metrics = self.archive.read_bytes()
        install.cmd_install(str(self.archive), str(self.archive.parent), metrics=True)
        self.assertEqual(with_metrics, self.archive.read_bytes())
        install.cmd_status(str(self.archive))
        self.assertIn('实时指标: 已启用', self.output.getvalue())
        self.run_install()
        self.assertEqual(original_main, asar.read_file(self.archive, 'dist/main.js'))
        self.output.truncate(0)
        self.output.seek(0)
        install.cmd_status(str(self.archive))
        self.assertIn('实时指标: 未启用', self.output.getvalue())
        self.run_restore()
        self.assertEqual(original_archive, self.archive.read_bytes())

    def test_quit_dialog_marks_partial_match_and_stays_idempotent(self):
        dist = self.root / 'dist'
        dist.mkdir()
        main = dist / 'main.js'
        main.write_text("module.exports = {title: 'Confirm Quit'};\n", encoding='utf-8')
        install.patch_quit_dialog(str(self.root))
        first = main.read_text(encoding='utf-8')
        self.assertIn('AG_ZH_QUIT_DIALOG', first)
        self.assertIn('确认退出', first)
        install.patch_quit_dialog(str(self.root))
        self.assertEqual(main.read_text(encoding='utf-8'), first)

    def test_reset_windows_acl_requires_zero_exit_code(self):
        fake = subprocess.CompletedProcess(['icacls'], 5)
        with patch.object(install.sys, 'platform', 'win32'), \
             patch.object(install, '_is_accessible', return_value=True), \
             patch.object(install.subprocess, 'run', return_value=fake) as run_mock:
            self.assertFalse(install._reset_windows_acl(str(self.archive), recursive=True))
        self.assertNotIn('/C', run_mock.call_args[0][0])


class PlatformChecksTests(unittest.TestCase):
    def test_check_app_running_matches_windows_insiders_image_name(self):
        fake = subprocess.CompletedProcess(
            ['tasklist'], 0,
            stdout=b'"Antigravity - Insiders.exe","123","Console","1","10,000 K"\r\n'
        )
        with patch.object(install.sys, 'platform', 'win32'), \
             patch.object(install.subprocess, 'run', return_value=fake):
            self.assertTrue(install.check_app_running())
        unrelated = subprocess.CompletedProcess(
            ['tasklist'], 0,
            stdout=b'"python.exe","123","Console","1","10,000 K"\r\n'
        )
        with patch.object(install.sys, 'platform', 'win32'), \
             patch.object(install.subprocess, 'run', return_value=unrelated):
            self.assertFalse(install.check_app_running())


if __name__ == '__main__':
    unittest.main()
