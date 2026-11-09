---
name: antigravity-zh
description: 为 Google Antigravity 桌面客户端（Agent Manager）安装、更新、检查或还原中文汉化补丁。当用户要求安装中文、汉化失效后重装、查看汉化状态或恢复原版时使用。安装器使用 Python 标准库，支持显式指定 app.asar 路径。
---

# Antigravity 中文补丁

先阅读 [README.md](README.md) 中的兼容性和备份说明。目标客户端应包含 `resources/app.asar` 与 `dist/preload.js`；不要根据版本号单独断言兼容。

## 安装与更新

1. 确认客户端完全退出，保留同版本 ASAR 与外置文件的独立备份。
2. 从 `https://github.com/shadowzhz/antigravity-zh` 获取本项目。保持 `install.py`、`asar.py` 和 `dicts/` 的相对结构。
3. 执行 `python3 install.py`；非默认目录使用 `python3 install.py --asar "/path/to/resources/app.asar"`。Windows 可使用 `py -3`。
4. 检查注入日志中的文件缺失、钩子未匹配和签名失败提示，再启动客户端验证。

安装器会保留原始 unpacked 清单和执行标记，成套备份 `app.asar.bak` 与 `app.asar.bak.unpacked/`。已汉化时先校验原版备份，重复安装重建注入块而不叠加引擎。

## 检查与还原

- 检查：`python3 install.py --status`。该命令读取注入标记，不代表客户端功能已验证。
- 还原：完全退出客户端后执行 `python3 install.py --restore`，恢复归档与外置文件。
- 使用自定义安装目录时，检查与还原也传入同一 `--asar` 路径。
- 旧版仅有单文件备份时，仅在外置文件通过原备份 SHA256 校验后自动补齐；校验失败则停止，使用同版本完整备份或重新安装官方客户端。

## 用户词典与异常处理

- 内置词库由 `dicts/zh_cn.json` 提供。用户覆盖文件位于 `~/.antigravity-zh/zh-CN.json`，不存在时创建 `{}`，重装保留已有内容。
- 修改、删除用户词条后会重建字典，并根据保存的原文重新翻译节点。沙箱不允许本地文件访问时，只使用内置词库。
- 安装与还原会检查应用进程并使用安装锁。发现残留锁时，先确认没有安装器运行；不要直接删除活动锁。
- 切换异常会尝试回滚，回滚失败时保留并报告恢复目录。不要删除这些恢复文件后继续安装。
- macOS 会尝试 ad-hoc 重签名；失败时保留错误信息，优先恢复完整备份或重装官方客户端，不默认绕过系统安全检查。
