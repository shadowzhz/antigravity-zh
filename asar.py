# -*- coding: utf-8 -*-
"""Pure-standard-library ASAR reader/writer with unpacked metadata preservation.

Header: size pickle (8 bytes), header pickle (8 + aligned JSON bytes), payload.
Symlink archive entries are rejected explicitly rather than silently flattened.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import stat
import struct

BLOCK_SIZE = 4 * 1024 * 1024


def _file_integrity(path):
    full = hashlib.sha256()
    blocks = []
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(BLOCK_SIZE), b""):
            full.update(block)
            blocks.append(hashlib.sha256(block).hexdigest())
    if not blocks:
        blocks.append(full.hexdigest())
    return {"algorithm": "SHA256", "hash": full.hexdigest(),
            "blockSize": BLOCK_SIZE, "blocks": blocks}


def _glob_to_regex(pattern):
    out = []
    i = 0
    while i < len(pattern):
        c = pattern[i]
        if c == "*":
            if pattern[i:i + 2] == "**":
                if pattern[i + 2:i + 3] == "/":
                    out.append("(?:[^/]+/)*")
                    i += 3
                else:
                    out.append(".*")
                    i += 2
            else:
                out.append("[^/]*")
                i += 1
        elif c == "?":
            out.append("[^/]")
            i += 1
        elif c == "[":
            end = pattern.find("]", i + 1)
            if end < 0:
                out.append(r"\[")
                i += 1
            else:
                out.append("[" + pattern[i + 1:end].replace("\\", "\\\\") + "]")
                i = end + 1
        else:
            out.append(re.escape(c))
            i += 1
    return re.compile("^" + "".join(out) + "$")


def _safe_component(name):
    if (not isinstance(name, str) or name in ("", ".", "..") or
            any(c in name for c in "/\\:\0") or name.endswith((".", " "))):
        raise ValueError("不安全的 ASAR 路径分量: %r" % name)
    # Avoid Windows device aliases even when inspecting an archive on Unix.
    stem = name.split(".", 1)[0].upper()
    if stem in {"CON", "PRN", "AUX", "NUL"} or re.fullmatch(r"(?:COM|LPT)[1-9]", stem):
        raise ValueError("不安全的 ASAR 设备路径: %r" % name)


def _safe_path(root, rel):
    parts = rel.split("/")
    for part in parts:
        _safe_component(part)
    root = os.path.realpath(root)
    target = os.path.realpath(os.path.join(root, *parts))
    if os.path.commonpath([root, target]) != root:
        raise ValueError("ASAR 路径越界: %s" % rel)
    return target


def _read_header(asar_path):
    with open(asar_path, "rb") as source:
        head = source.read(16)
        if len(head) != 16:
            raise ValueError("无效的 ASAR 文件头")
        size, pickle_size, payload_size, json_size = struct.unpack("<IIII", head)
        if (size != 4 or not 8 <= pickle_size <= 64 * 1024 * 1024 or
                pickle_size % 4 or payload_size != pickle_size - 4 or
                json_size > pickle_size - 8 or
                pickle_size != 8 + json_size + (-json_size % 4) or
                8 + pickle_size > os.fstat(source.fileno()).st_size):
            raise ValueError("无效的 ASAR header 长度")
        data = source.read(json_size)
        header = json.loads(data.decode("utf-8"))
        if not isinstance(header, dict) or not isinstance(header.get("files"), dict):
            raise ValueError("ASAR header 缺少 files 对象")
        return header, json_size, pickle_size


def _entries(header):
    def walk(node, prefix="", inherited_unpacked=False):
        unpacked = inherited_unpacked or node.get("unpacked", False)
        children = node.get("files")
        if not isinstance(children, dict):
            raise ValueError("无效的 ASAR 目录节点")
        for name, child in children.items():
            _safe_component(name)
            if not isinstance(child, dict):
                raise ValueError("无效的 ASAR 文件节点: %s" % name)
            rel = prefix + "/" + name if prefix else name
            if "link" in child:
                raise ValueError("暂不支持 ASAR 符号链接: %s" % rel)
            if "files" in child:
                yield from walk(child, rel, unpacked)
            else:
                entry = dict(child)
                entry["unpacked"] = bool(unpacked or child.get("unpacked"))
                size = entry.get("size")
                if type(size) is not int or size < 0:
                    raise ValueError("无效的 ASAR 文件大小: %s" % rel)
                if not entry["unpacked"]:
                    offset = entry.get("offset")
                    if not isinstance(offset, str) or not re.fullmatch(r"[0-9]+", offset):
                        raise ValueError("无效的 ASAR 文件偏移: %s" % rel)
                yield rel, entry
    return dict(walk(header))


def manifest(asar_path):
    header, _, _ = _read_header(asar_path)
    return _entries(header)


def _validate_entries(asar_path, entries, pickle_size, unpacked_root,
                      check_unpacked=True, require_integrity=False):
    length = os.path.getsize(asar_path)
    for rel, entry in entries.items():
        if entry["unpacked"]:
            if not check_unpacked:
                continue
            path = _safe_path(unpacked_root, rel)
            if not os.path.isfile(path):
                raise FileNotFoundError("缺少 unpacked 文件: %s" % path)
            if os.path.getsize(path) != entry["size"]:
                raise ValueError("unpacked 文件大小不匹配: %s" % rel)
            integrity = entry.get("integrity", {})
            if integrity.get("algorithm") == "SHA256" and integrity.get("hash"):
                if _file_integrity(path)["hash"] != integrity["hash"]:
                    raise ValueError("unpacked 文件校验失败: %s" % rel)
            elif require_integrity:
                raise ValueError("旧备份缺少完整性信息，无法确认 unpacked 版本: %s" % rel)
        elif 8 + pickle_size + int(entry["offset"]) + entry["size"] > length:
            raise ValueError("ASAR 文件内容被截断: %s" % rel)


def validate_archive(asar_path, unpacked_root=None, require_integrity=False):
    asar_path = os.fspath(asar_path)
    header, _, pickle_size = _read_header(asar_path)
    entries = _entries(header)
    _validate_entries(asar_path, entries, pickle_size,
                      unpacked_root or asar_path + ".unpacked",
                      require_integrity=require_integrity)
    return entries


def _copy_bytes(source, target, size):
    remaining = size
    while remaining:
        chunk = source.read(min(65536, remaining))
        if not chunk:
            raise ValueError("ASAR 文件内容被截断")
        target.write(chunk)
        remaining -= len(chunk)


def read_file(asar_path, rel, unpacked_root=None):
    """Read a single entry without extracting the archive or unrelated sidecars."""
    asar_path = os.fspath(asar_path)
    header, _, pickle_size = _read_header(asar_path)
    entries = _entries(header)
    if rel not in entries:
        raise FileNotFoundError("ASAR 内不存在: %s" % rel)
    entry = entries[rel]
    unpacked_root = unpacked_root or asar_path + ".unpacked"
    _validate_entries(asar_path, {rel: entry}, pickle_size, unpacked_root)
    if entry["unpacked"]:
        with open(_safe_path(unpacked_root, rel), "rb") as source:
            return source.read()
    with open(asar_path, "rb") as source:
        source.seek(8 + pickle_size + int(entry["offset"]))
        data = source.read(entry["size"])
    if len(data) != entry["size"]:
        raise ValueError("ASAR 文件内容被截断: %s" % rel)
    return data


def extract(asar_path, dest_dir, with_unpacked=True):
    asar_path = os.fspath(asar_path)
    header, _, pickle_size = _read_header(asar_path)
    entries = _entries(header)
    unpacked_root = asar_path + ".unpacked"
    _validate_entries(asar_path, entries, pickle_size, unpacked_root, with_unpacked)
    # Preflight all destinations, including existing symlinks, before writing.
    targets = {rel: _safe_path(dest_dir, rel) for rel in entries}
    def directories(node, prefix=""):
        for name, child in node["files"].items():
            if "files" in child:
                rel = prefix + "/" + name if prefix else name
                yield _safe_path(dest_dir, rel)
                yield from directories(child, rel)
    directory_paths = list(directories(header))
    for directory in directory_paths:
        os.makedirs(directory, exist_ok=True)
    count = 0
    with open(asar_path, "rb") as source:
        for rel, entry in entries.items():
            if entry["unpacked"] and not with_unpacked:
                continue
            target = targets[rel]
            os.makedirs(os.path.dirname(target), exist_ok=True)
            if entry["unpacked"]:
                shutil.copy2(_safe_path(unpacked_root, rel), target)
            else:
                source.seek(8 + pickle_size + int(entry["offset"]))
                with open(target, "wb") as dest:
                    _copy_bytes(source, dest, entry["size"])
            if entry.get("executable"):
                os.chmod(target, os.stat(target).st_mode | 0o111)
            count += 1
    return count


def _build_tree(src_dir, metadata):
    header = {"files": {}}
    file_list = []
    for root, dirs, files in os.walk(src_dir):
        dirs.sort()
        files.sort()
        for name in dirs + files:
            _safe_component(name)
            if os.path.islink(os.path.join(root, name)):
                raise ValueError("暂不支持打包符号链接: %s" % os.path.join(root, name))
        rel_root = os.path.relpath(root, src_dir)
        curr = header
        if rel_root != ".":
            for part in rel_root.split(os.sep):
                curr = curr["files"].setdefault(part, {"files": {}})
        for name in dirs:
            curr["files"].setdefault(name, {"files": {}})
        for name in files:
            path = os.path.join(root, name)
            rel = os.path.relpath(path, src_dir).replace(os.sep, "/")
            if not stat.S_ISREG(os.stat(path).st_mode):
                raise ValueError("不是普通文件: %s" % rel)
            node = {"size": os.path.getsize(path)}
            executable = (metadata[rel].get("executable", False) if rel in metadata
                          else bool(os.stat(path).st_mode & 0o111))
            if executable:
                node["executable"] = True
            curr["files"][name] = node
            file_list.append((path, node, rel))
    return header, file_list


def pack(src_dir, dest_asar, unpack_patterns=None, metadata=None):
    """Keep original unpacked/executable flags when metadata is supplied."""
    dest_asar = os.fspath(dest_asar)
    metadata = metadata or {}
    patterns = [_glob_to_regex(pattern) for pattern in (unpack_patterns or [])]
    header, file_list = _build_tree(src_dir, metadata)
    offset = 0
    for path, node, rel in file_list:
        if metadata.get(rel, {}).get("unpacked") or any(rx.match(rel) for rx in patterns):
            node["unpacked"] = True
            target = _safe_path(dest_asar + ".unpacked", rel)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            shutil.copy2(path, target)
            if node.get("executable"):
                os.chmod(target, os.stat(target).st_mode | 0o111)
        else:
            node["offset"] = str(offset)
            offset += node["size"]
        node["integrity"] = _file_integrity(path)
    data = json.dumps(header, separators=(",", ":")).encode("utf-8")
    padded = data + b"\0" * (-len(data) % 4)
    os.makedirs(os.path.dirname(dest_asar) or ".", exist_ok=True)
    with open(dest_asar, "wb") as dest:
        dest.write(struct.pack("<IIII", 4, 8 + len(padded), 4 + len(padded), len(data)))
        dest.write(padded)
        for path, node, _ in file_list:
            if not node.get("unpacked"):
                with open(path, "rb") as source:
                    _copy_bytes(source, dest, node["size"])
    return dest_asar


def list_files(asar_path):
    return [(rel, entry["size"], entry["unpacked"])
            for rel, entry in manifest(asar_path).items()]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ASAR 打包、解包、列表")
    sub = parser.add_subparsers(dest="command", required=True)
    extract_parser = sub.add_parser("extract")
    extract_parser.add_argument("archive")
    extract_parser.add_argument("destination")
    pack_parser = sub.add_parser("pack")
    pack_parser.add_argument("source")
    pack_parser.add_argument("archive")
    pack_parser.add_argument("patterns", nargs="*")
    list_parser = sub.add_parser("list")
    list_parser.add_argument("archive")
    args = parser.parse_args()
    if args.command == "extract":
        print("extracted %d files" % extract(args.archive, args.destination))
    elif args.command == "pack":
        pack(args.source, args.archive, args.patterns)
        print("packed -> %s" % args.archive)
    else:
        for rel, size, unpacked in list_files(args.archive):
            print("%s\t%s\t%s" % (rel, size, "unpacked" if unpacked else ""))
