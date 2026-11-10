# -*- coding: utf-8 -*-
"""
Antigravity 中文汉化安装器（纯 Python 零外部依赖）
====================================================
为 Google Antigravity 桌面客户端（Agent Manager）注入中文翻译引擎。

原理：解包 app.asar -> 向 dist/preload.js 与 dist/ideInstall/wizardPreload.js
注入 DOM 翻译引擎与全量字典 -> 重新打包 -> （macOS）ad-hoc 重签名。

用法：
    python3 install.py              # 安装汉化
    python3 install.py --restore    # 还原官方原版
    python3 install.py --status     # 查看当前状态
    python3 install.py --asar PATH  # 指定 app.asar 路径（非默认安装时）

说明：本工具修改本地 app.asar，非 Google 官方语言包；Antigravity 官方
升级后汉化会失效，重新运行本脚本即可。安装前会自动备份 app.asar.bak。
"""
import argparse
from contextlib import contextmanager
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile

# 允许 install.py 从任意工作目录运行
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import asar  # noqa: E402

TAG = "Antigravity Chinese Translation Injection v3-full"
DICT_PLACEHOLDER = "__DICT_ITEMS__"


def _load_engine_template():
    """读取翻译引擎模板（含 __DICT_ITEMS__ 占位符）。"""
    p = os.path.join(HERE, "dicts", "engine.js")
    if not os.path.exists(p):
        sys.exit("[ERR] 找不到引擎模板: %s" % p)
    with open(p, "r", encoding="utf-8") as f:
        return f.read()


# 注入引擎 IIFE 的起始两行（build_injection 输出的开头），用于定位旧引擎块
ENGINE_START_MARKER = "// AGZH ENGINE START"
LEGACY_ENGINE_START_MARKER = "(function() {\n  const dictionary = {"


def build_injection(dictionary):
    """由全量字典生成注入 JS（引擎模板 + 字典项）。"""
    payload = json.dumps(json.dumps(dictionary, ensure_ascii=False), ensure_ascii=True)
    dict_block = "// ===== %s =====\n  const bundledDictionary = JSON.parse(%s);" % (TAG, payload)
    template = _load_engine_template()
    if template.count(DICT_PLACEHOLDER) != 1:
        raise ValueError("引擎模板必须包含一个词典占位符")
    return template.replace(DICT_PLACEHOLDER, dict_block)


# ---------------------------------------------------------------- 平台与路径
def detect_paths(asar_path=None):
    """自动探测 Antigravity 安装路径；返回 (asar_path, resources_dir)。"""
    if asar_path:
        if not os.path.exists(asar_path):
            sys.exit("[ERR] 指定的 app.asar 不存在: %s" % asar_path)
        return os.path.abspath(asar_path), os.path.dirname(os.path.abspath(asar_path))

    system = sys.platform
    candidates = []
    if system == "darwin":
        candidates = [
            "/Applications/Antigravity.app/Contents/Resources/app.asar",
            os.path.expanduser("~/Applications/Antigravity.app/Contents/Resources/app.asar"),
        ]
    elif system == "win32":
        base = os.environ.get("LOCALAPPDATA", "")
        candidates = [
            os.path.join(base, "Programs", "Antigravity", "resources", "app.asar"),
        ]
    elif system.startswith("linux"):
        import glob
        candidates = [
            os.path.expanduser("~/.local/opt/antigravity/resources/app.asar"),
            "/opt/Antigravity/resources/app.asar",
            os.path.expanduser("~/.local/share/Antigravity/resources/app.asar"),
            os.path.expanduser("~/Downloads/Antigravity-x64/resources/app.asar"),
        ]
        candidates.extend(glob.glob(os.path.expanduser("~/Downloads/Antigravity*/resources/app.asar")))
    for c in candidates:
        if os.path.exists(c):
            return c, os.path.dirname(c)
    sys.exit(
        "[ERR] 未找到 Antigravity app.asar。\n"
        "      macOS: /Applications/Antigravity.app\n"
        "      Windows: %%LOCALAPPDATA%%\\Programs\\Antigravity\n"
        "      或使用 --asar 手动指定路径。"
    )


def check_app_running():
    """检测 Antigravity 是否在运行（覆盖写前应退出应用）。"""
    try:
        if sys.platform == "darwin":
            # 匹配应用主程序路径而非任意含 "Antigravity" 的命令行，
            # 避免误报（如打开了本仓库的编辑器进程）
            r = subprocess.run(["pgrep", "-f", "Antigravity.app/Contents/MacOS"],
                               capture_output=True)
            return r.returncode == 0
        elif sys.platform == "win32":
            r = subprocess.run(["tasklist", "/FI", "IMAGENAME eq Antigravity.exe"],
                               capture_output=True, text=True)
            return "antigravity.exe" in r.stdout.lower()
        elif sys.platform.startswith("linux"):
            r = subprocess.run(["pgrep", "-x", "[Aa]ntigravity"], capture_output=True)
            return r.returncode == 0
    except Exception:
        pass
    return False


def codesign_macos(app_path):
    """macOS ad-hoc 重签名，解决修改后“应用已损坏”问题。"""
    if sys.platform != "darwin":
        return True
    try:
        r = subprocess.run(["codesign", "--force", "--deep", "--sign", "-", app_path],
                           capture_output=True, text=True)
        if r.returncode != 0:
            print("[!] 重签名失败，请保留错误信息并检查客户端能否启动: %s" % r.stderr.strip()[:200])
            return False
        print("[OK] macOS 重签名完成")
        return True
    except FileNotFoundError:
        print("[!] 未找到 codesign，未完成重签名")
        return False


# ---------------------------------------------------------------- 字典与注入
def load_dictionary():
    d = {}
    dict_path = os.path.join(HERE, "dicts", "zh_cn.json")
    if not os.path.exists(dict_path):
        sys.exit("[ERR] 找不到字典文件: %s" % dict_path)
    with open(dict_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict):
        d.update(data)
    elif isinstance(data, list):
        for item in data:
            if isinstance(item, dict) and "key" in item and "value" in item:
                d[item["key"]] = item["value"]
    if not d:
        raise ValueError("字典为空")
    if any(not isinstance(k, str) or not k.strip() or not isinstance(v, str) for k, v in d.items()):
        raise ValueError("词典必须由非空字符串键和字符串译文组成")
    return d


def patch_file(path, dictionary):
    """向 preload/wizardPreload 注入汉化。

    分两种情况：
    A. 原版（无引擎）-> 直接追加完整引擎（引擎模板 + 全量字典），无需锚点；
    B. 已有引擎 -> 从第一个引擎起点到文件尾整体重建（历史上多次追加产生的
       重复引擎块一并清除，避免旧引擎先翻译导致新词典永不生效）。
       引擎注入始终追加在文件尾部，因此第一个起点之后全是旧引擎内容。
    """
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    starts = [content.find(marker) for marker in (ENGINE_START_MARKER, LEGACY_ENGINE_START_MARKER)
              if marker in content]
    if starts:
        # 情况 B：已注入引擎（含旧格式）。第一个起点到文件尾全部重建。
        start = min(starts)
        n_old = content.count(ENGINE_START_MARKER) + content.count(LEGACY_ENGINE_START_MARKER)
        if n_old > 1:
            print("[*] %s 检测到 %d 个重复引擎块，合并重建" % (os.path.basename(path), n_old))
        new_engine = build_injection(dictionary)
        if content[start:] == new_engine + "\n":
            print("[*] %s 引擎与词典均无变化，跳过" % os.path.basename(path))
            return
        content = content[:start] + new_engine + "\n"
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        print("[OK] %s 引擎与词典更新完成" % os.path.basename(path))
        return

    # 情况 A：官方原版，追加完整引擎（含全量字典）
    content = content.rstrip() + "\n\n" + build_injection(dictionary) + "\n"
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print("[OK] %s 注入完成" % os.path.basename(path))


def patch_native_menu(tmp):
    """注入原生菜单翻译（menu.js：File/Edit/View… 菜单栏）。"""
    menu_path = os.path.join(tmp, "dist", "menu.js")
    if not os.path.exists(menu_path):
        print("[!] menu.js 不存在，跳过菜单翻译")
        return
    with open(menu_path, "r", encoding="utf-8") as f:
        content = f.read()
    target_hook = "electron_1.Menu.setApplicationMenu(menu);"
    if "translateMenu" in content:
        print("[*] menu.js 已注入菜单翻译，跳过")
        return
    if target_hook not in content:
        print("[!] menu.js 未找到注入钩子，跳过")
        return
    content = content.replace(
        target_hook,
        "if (typeof translateMenu === 'function') { menu.items.forEach(translateMenu); } " + target_hook)
    content += "\n" + MENU_TRANSLATION_CODE
    with open(menu_path, "w", encoding="utf-8") as f:
        f.write(content)
    print("[OK] 注入 原生菜单翻译: menu.js")


def patch_tray(tmp):
    """注入托盘菜单翻译（tray.js：智能体数量/打开/退出）。"""
    tray_path = os.path.join(tmp, "dist", "tray.js")
    if not os.path.exists(tray_path):
        print("[!] tray.js 不存在，跳过托盘翻译")
        return
    with open(tray_path, "r", encoding="utf-8") as f:
        content = f.read()
    if "translatedActions" in content:
        print("[*] tray.js 已注入托盘翻译，跳过")
        return
    old_template = "contextMenu = electron_1.Menu.buildFromTemplate(actions);"
    new_template = (
        "const translatedActions = actions.map(action => {\n"
        "        if (action.label === 'No agents running') action.label = '没有智能体在运行';\n"
        "        if (action.label && action.label.startsWith('Open ')) action.label = '打开 Antigravity';\n"
        "        if (action.label === 'Quit') action.label = '退出';\n"
        "        return action;\n"
        "    });\n"
        "    contextMenu = electron_1.Menu.buildFromTemplate(translatedActions);")
    old_label = "countItem.label = count > 0 ? `${count} active agents` : 'No agents running';"
    old_label_2 = "countItem.label = count > 0 ? `${count} active agents` : \"No agents running\";"
    new_label = "countItem.label = count > 0 ? `${count} 个智能体运行中` : '没有智能体在运行';"
    changed = False
    if old_template in content:
        content = content.replace(old_template, new_template)
        changed = True
    if old_label in content:
        content = content.replace(old_label, new_label)
        changed = True
    elif old_label_2 in content:
        content = content.replace(old_label_2, new_label)
        changed = True
    if changed:
        with open(tray_path, "w", encoding="utf-8") as f:
            f.write(content)
        print("[OK] 注入 托盘翻译: tray.js")
    else:
        print("[!] tray.js 钩子未匹配，跳过")


def patch_quit_dialog(tmp):
    """汉化主进程退出确认弹窗（main.js：原生 dialog，DOM 引擎无法触及）。"""
    main_path = os.path.join(tmp, "dist", "main.js")
    if not os.path.exists(main_path):
        print("[!] main.js 不存在，跳过退出弹窗翻译")
        return
    with open(main_path, "r", encoding="utf-8") as f:
        content = f.read()
    if "AG_ZH_QUIT_DIALOG" in content:
        print("[*] main.js 已注入退出弹窗翻译，跳过")
        return
    replacements = [
        ("buttons: ['Cancel', 'Quit']", "buttons: ['取消', '退出'] /* AG_ZH_QUIT_DIALOG */"),
        ("title: 'Confirm Quit'", "title: '确认退出'"),
        ("message: 'Are you sure you want to quit?'", "message: '您确定要退出吗？'"),
        ("detail: 'There may be agents or background tasks running.'",
         "detail: '可能还有智能体或后台任务正在运行。'"),
    ]
    changed = False
    for old, new in replacements:
        if old in content:
            content = content.replace(old, new)
            changed = True
    if changed:
        with open(main_path, "w", encoding="utf-8") as f:
            f.write(content)
        print("[OK] 注入 退出弹窗翻译: main.js")
    else:
        print("[!] main.js 退出弹窗钩子未匹配，跳过")


def patch_loading_overlay(tmp):
    """汉化启动加载画面（loadingOverlay.js：翻译引擎启动前显示）。"""
    overlay_path = os.path.join(tmp, "dist", "loadingOverlay.js")
    if not os.path.exists(overlay_path):
        print("[!] loadingOverlay.js 不存在，跳过加载画面翻译")
        return
    with open(overlay_path, "r", encoding="utf-8") as f:
        content = f.read()
    if "AG_ZH_LOADING" in content:
        print("[*] loadingOverlay.js 已注入加载画面翻译，跳过")
        return
    old = '<div class="text">Loading Antigravity</div>'
    new = '<div class="text">正在加载 Antigravity</div> <!-- AG_ZH_LOADING -->'
    if old in content:
        content = content.replace(old, new)
        with open(overlay_path, "w", encoding="utf-8") as f:
            f.write(content)
        print("[OK] 注入 加载画面翻译: loadingOverlay.js")
    else:
        print("[!] loadingOverlay.js 钩子未匹配，跳过")


MENU_TRANSLATION_CODE = r"""
const menuTranslationMap = {
  'File': '文件',
  'Edit': '编辑',
  'View': '视图',
  'Window': '窗口',
  'Help': '帮助',
  'New Window': '新建窗口',
  'Docs': '使用文档',
  'Toggle Developer Tools': '开发者工具',
  'Check for Updates': '检查更新',
  'Checking for Updates...': '正在检查更新...',
  'Downloading Update...': '正在下载更新...',
  'Restart to Update': '重启以应用更新',
  'Undo': '撤销',
  'Redo': '重做',
  'Cut': '剪切',
  'Copy': '复制',
  'Paste': '粘贴',
  'Select All': '全选',
  'Minimize': '最小化',
  'Close': '关闭',
  'Quit Antigravity': '退出 Antigravity',
  'About Antigravity': '关于 Antigravity',
  'Services': '服务',
  'Hide Antigravity': '隐藏 Antigravity',
  'Hide Others': '隐藏其他',
  'Show All': '显示全部',
  'Force Reload': '强制重新加载',
  'Reload': '重新加载',
  'Actual Size': '实际大小',
  'Zoom In': '放大',
  'Zoom Out': '缩小',
  'Toggle Full Screen': '切换全屏'
};
function translateMenu(menuItem) {
  if (menuItem.label && menuTranslationMap[menuItem.label]) {
    menuItem.label = menuTranslationMap[menuItem.label];
  }
  if (menuItem.submenu && menuItem.submenu.items) {
    menuItem.submenu.items.forEach(translateMenu);
  }
}
"""


# ---------------------------------------------------------------- 主流程
def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _require_app_stopped():
    if check_app_running():
        raise RuntimeError("检测到 Antigravity 正在运行，请完全退出后重试")


@contextmanager
def _archive_lock(asar_path):
    lock = asar_path + ".agzh.lock"
    try:
        handle = open(lock, "x", encoding="utf-8")
    except FileExistsError:
        raise RuntimeError("存在安装锁 %s；确认没有安装器运行后再移除残留锁" % lock)
    try:
        with handle:
            handle.write(str(os.getpid()))
        yield
    finally:
        os.remove(lock)


def _replace_archive(source, destination, source_unpacked=None):
    """Stage the complete pair on the target filesystem; roll back all switches.

    No live paths are moved until copying and validation have succeeded. If the
    OS also refuses rollback, retain the recovery directory instead of deleting
    the only remaining copy. This is exception-safe, not power-loss atomic.
    """
    source_unpacked = source_unpacked or source + ".unpacked"
    entries = asar.validate_archive(source, source_unpacked)
    parent = os.path.dirname(os.path.abspath(destination))
    stage = tempfile.mkdtemp(prefix=".agzh_stage_", dir=parent)
    staged_asar = os.path.join(stage, "app.asar")
    staged_unpacked = staged_asar + ".unpacked"
    live_unpacked = destination + ".unpacked"
    old_unpacked = os.path.join(stage, "previous.unpacked")
    old_archive = os.path.join(stage, "previous.asar")
    keep_stage = False
    try:
        shutil.copy2(source, staged_asar)
        if os.path.isdir(source_unpacked):
            shutil.copytree(source_unpacked, staged_unpacked, symlinks=True)
            for rel, entry in entries.items():
                if entry["unpacked"] and entry.get("executable"):
                    target = asar._safe_path(staged_unpacked, rel)
                    os.chmod(target, os.stat(target).st_mode | 0o111)
        asar.validate_archive(staged_asar)
        had_archive = os.path.exists(destination)
        if had_archive:
            shutil.copy2(destination, old_archive)
        had_staged_unpacked = os.path.isdir(staged_unpacked)
        try:
            if os.path.lexists(live_unpacked):
                if os.path.islink(live_unpacked) or not os.path.isdir(live_unpacked):
                    raise ValueError("unpacked 目标必须是普通目录: %s" % live_unpacked)
                os.replace(live_unpacked, old_unpacked)
            if had_staged_unpacked:
                os.replace(staged_unpacked, live_unpacked)
            os.replace(staged_asar, destination)
        except BaseException:
            try:
                # Inspect completed renames: interruption can occur before a
                # Python flag assignment following os.replace has executed.
                if had_staged_unpacked and not os.path.lexists(staged_unpacked):
                    shutil.rmtree(live_unpacked)
                if os.path.lexists(old_unpacked):
                    os.replace(old_unpacked, live_unpacked)
                if had_archive and not os.path.exists(staged_asar):
                    # Also cover an interruption immediately after the final
                    # rename, when the new archive may already be visible.
                    os.replace(old_archive, destination)
                elif not had_archive and not os.path.exists(staged_asar) and os.path.exists(destination):
                    os.remove(destination)
            except BaseException as rollback_error:
                keep_stage = True
                raise RuntimeError("自动回滚失败，恢复文件保留在 %s" % stage) from rollback_error
            raise
    finally:
        if not keep_stage:
            shutil.rmtree(stage, ignore_errors=True)


def _is_patched(content):
    return ("Antigravity Chinese Translation Injection" in content or
            ENGINE_START_MARKER in content or LEGACY_ENGINE_START_MARKER in content)


def _prepare_existing_backup(asar_path):
    bak = asar_path + ".bak"
    if not os.path.isfile(bak):
        raise FileNotFoundError("缺少原版备份 %s；请先恢复官方客户端" % bak)
    entries = asar.manifest(bak)
    migrate = any(entry["unpacked"] for entry in entries.values()) and not os.path.exists(bak + ".unpacked")
    source_unpacked = asar_path + ".unpacked" if migrate else bak + ".unpacked"
    asar.validate_archive(bak, source_unpacked, require_integrity=migrate)
    if _is_patched(asar.read_file(bak, "dist/preload.js", source_unpacked).decode("utf-8")):
        raise ValueError("备份中含有汉化引擎，不能作为官方原版还原")
    if migrate:
        # Migrate old single-file backups only when hashes prove that every
        # required sidecar still belongs to the original archive.
        _replace_archive(bak, bak, source_unpacked)
        print("[OK] 已校验并补齐旧版备份的 unpacked 文件")
    asar.validate_archive(bak)
    return bak


def _ensure_external_dictionary():
    ext_dir = os.path.join(os.path.expanduser("~"), ".antigravity-zh")
    os.makedirs(ext_dir, exist_ok=True)
    ext_dict = os.path.join(ext_dir, "zh-CN.json")
    try:
        with open(ext_dict, "x", encoding="utf-8") as target:
            target.write("{}\n")
        print("[OK] 已创建用户覆盖词典: %s" % ext_dict)
    except FileExistsError:
        print("[*] 保留已有用户词典: %s" % ext_dict)


def cmd_install(asar_path, resources_dir):
    with _archive_lock(asar_path):
        _require_app_stopped()
        dictionary = load_dictionary()
        metadata = asar.validate_archive(asar_path)
        current_preload = asar.read_file(asar_path, "dist/preload.js").decode("utf-8")
        with tempfile.TemporaryDirectory(prefix="agy_zh_") as tmp:
            extracted = os.path.join(tmp, "source")
            print("[*] 解包 app.asar ...")
            asar.extract(asar_path, extracted)
            if _is_patched(current_preload):
                _prepare_existing_backup(asar_path)
                print("[*] 保留已校验的官方原版备份")
            else:
                # Back up the current pristine pair regardless of mtime; a
                # vendor update can preserve or backdate timestamps.
                _replace_archive(asar_path, asar_path + ".bak")
                print("[OK] 已成套备份当前原版 ASAR 与 unpacked 文件")
            print("[*] 字典词条: %d" % len(dictionary))
            patch_file(os.path.join(extracted, "dist", "preload.js"), dictionary)
            wizard = os.path.join(extracted, "dist", "ideInstall", "wizardPreload.js")
            if os.path.exists(wizard):
                patch_file(wizard, dictionary)
            patch_native_menu(extracted)
            patch_tray(extracted)
            patch_quit_dialog(extracted)
            patch_loading_overlay(extracted)
            new_asar = os.path.join(tmp, "app.asar")
            print("[*] 重新打包（保留原始 unpacked 清单和执行标记）...")
            asar.pack(extracted, new_asar, metadata=metadata)
            asar.validate_archive(new_asar)
            _ensure_external_dictionary()
            _require_app_stopped()
            _replace_archive(new_asar, asar_path)
        if sys.platform == "darwin":
            codesign_macos(os.path.dirname(os.path.dirname(resources_dir)))
        print("[DONE] 汉化注入完成（SHA256: %s），请启动 Antigravity。" % sha256(asar_path))


def cmd_restore(asar_path, resources_dir):
    with _archive_lock(asar_path):
        _require_app_stopped()
        bak = _prepare_existing_backup(asar_path)
        _require_app_stopped()
        _replace_archive(bak, asar_path)
        if sys.platform == "darwin":
            codesign_macos(os.path.dirname(os.path.dirname(resources_dir)))
        print("[OK] 已成套还原原版 ASAR 与 unpacked 文件（SHA256: %s）" % sha256(asar_path))
        print("[OK] 用户词典已保留，请重新启动 Antigravity。")


def cmd_status(asar_path):
    print("asar 路径: %s" % asar_path)
    print("SHA256: %s" % sha256(asar_path))
    print("大小: %d bytes" % os.path.getsize(asar_path))
    bak = asar_path + ".bak"
    print("备份: %s" % ("存在" if os.path.exists(bak) else "无"))
    print("unpacked 备份: %s" % ("存在" if os.path.isdir(bak + ".unpacked") else "无（若原包有外置文件需校验）"))
    content = asar.read_file(asar_path, "dist/preload.js").decode("utf-8")
    print("汉化: %s" % ("已注入" if _is_patched(content) else "未注入（原版）"))


def main():
    ap = argparse.ArgumentParser(description="Antigravity 中文汉化安装器（零依赖）")
    actions = ap.add_mutually_exclusive_group()
    actions.add_argument("--restore", action="store_true", help="还原官方原版")
    actions.add_argument("--status", action="store_true", help="查看汉化状态")
    ap.add_argument("--asar", default=None, help="手动指定 app.asar 路径")
    args = ap.parse_args()

    asar_path, resources_dir = detect_paths(args.asar)
    print("[*] 使用 app.asar: %s" % asar_path)

    if args.restore:
        cmd_restore(asar_path, resources_dir)
    elif args.status:
        cmd_status(asar_path)
    else:
        cmd_install(asar_path, resources_dir)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError) as error:
        sys.exit("[ERR] %s" % error)
