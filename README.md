# Antigravity 中文汉化增强版

为 **Google Antigravity 桌面客户端（Agent Manager）** 提供简体中文界面补丁。

安装器使用 Python 标准库，向本地 `app.asar` 注入 JavaScript 翻译引擎，并对可识别的原生菜单、托盘和启动画面进行替换。安装补丁不需要额外安装 Node.js 或 npm。

> 本项目是社区维护的非官方补丁，会修改客户端安装文件。客户端更新可能覆盖补丁，内部结构变化也可能导致部分功能失效。安装与还原前请完全退出 Antigravity，并阅读下方的备份说明。

## 能做什么

| 范围 | 当前实现 |
| --- | --- |
| 主界面、设置、弹窗、安装向导 | 注入 DOM 翻译引擎，监听文本和部分属性变化 |
| 时间、数量、权限提示等动态文案 | 通过正则规则翻译，保留部分动态参数 |
| 原生菜单、托盘、退出确认、启动画面 | 按客户端源码中的固定文本或钩子替换；未匹配时跳过并提示 |
| 代码、终端、输入区、项目名称等内容 | 按标签、类名和属性跳过已知区域，减少误翻；依赖客户端 DOM 结构 |
| 自定义译文 | 从用户目录读取外部 JSON 词典，并尝试监听文件变化 |
| 安装管理 | 自动探测部分安装路径、手动指定路径、状态检查、备份还原 |

当前 `dicts/zh_cn.json` 包含 **6,327 个唯一词条**。词条数量不等于界面覆盖率；工程名、代码、模型回复等内容也不适合按普通 UI 文案翻译。

## 兼容性与准备

- 需要 Python 3；代码使用 `subprocess.run(capture_output=True, text=True)`，要求 Python 3.7 或更新版本。
- 安装器包含 Linux、macOS 和 Windows 的路径探测逻辑。macOS 安装、还原后会尝试调用系统 `codesign` 进行 ad-hoc 重签名。
- 目标客户端必须采用 `resources/app.asar` 布局，并包含 `dist/preload.js`。名称相同但内部结构不同的客户端不一定适用。
- 仓库包含面向 2.29 系列文案的适配，但目前没有自动化兼容性矩阵，不能据此保证所有 2.29 及后续版本均可使用。
- 需要对目标安装目录有写权限。权限不足时，先确认目标路径和目录权限。

**首次安装或客户端更新后，建议另存以下文件，便于独立恢复：**

1. 当前版本的 `app.asar`。
2. 同目录的 `app.asar.unpacked/`（如果存在）。
3. 自定义过的 `~/.antigravity-zh/zh-CN.json`（如果存在）。

脚本会成套备份为 `app.asar.bak` 与 `app.asar.bak.unpacked/`（原包存在外置目录时），保留原始 unpacked 清单及执行标记。重装不会覆盖用户词典。已汉化的客户端会继续使用经过校验的原版备份；识别到当前未注入时，会备份当前这套文件，不再用修改时间猜测版本。

## 快速开始

### 1. 获取项目

```bash
git clone https://github.com/shadowzhz/antigravity-zh.git
cd antigravity-zh
```

下文使用 Linux/macOS 常见的 `python3` 命令。Windows 安装了 Python Launcher 时，可以将它替换为 `py -3`；否则使用指向 Python 3 的 `python`。

### 2. 退出客户端并安装

请完全退出 Antigravity，包括托盘中的后台进程。安装与还原都会尝试检查运行中的进程；Linux 使用 `pgrep`。进程检测受平台和命令可用性影响，请仍自行确认客户端已经退出。

```bash
python3 install.py
```

没有找到安装目录时，手动指定文件路径：

```bash
python3 install.py --asar "/path/to/resources/app.asar"
```

完成后重新启动客户端。若输出中出现“钩子未匹配”或文件不存在，相应原生界面的翻译可能未生效。

### 3. 查看状态

```bash
python3 install.py --status
```

状态信息包含 ASAR 路径、大小、SHA256、备份情况，以及主 preload 中是否存在注入标记。检查直接读取目标文件，不会解包整个客户端；它不等于客户端启动测试或所有翻译功能的验证。

### 4. 还原备份

完全退出客户端后执行：

```bash
python3 install.py --restore
```

自定义安装目录需要在安装、检查、还原时使用同一条 `--asar` 路径：

```bash
python3 install.py --asar "/path/to/resources/app.asar" --status
python3 install.py --asar "/path/to/resources/app.asar" --restore
```

`--restore` 会校验并成套恢复 `app.asar.bak` 与 `app.asar.bak.unpacked/`，保留用户词典。旧版本仅有 `.bak` 时，安装器只有在现有外置文件全部通过原备份的 SHA256 校验后才会补齐备份；缺失、版本不符或缺少校验信息时会停止，请使用同版本完整备份或重新安装官方客户端。

### 自动探测路径

| 平台 | 当前探测位置 |
| --- | --- |
| macOS | `/Applications/Antigravity.app/Contents/Resources/app.asar`、`~/Applications/Antigravity.app/Contents/Resources/app.asar` |
| Windows | `%LOCALAPPDATA%\Programs\Antigravity\resources\app.asar` |
| Linux | `~/.local/opt/antigravity/resources/app.asar`、`/opt/Antigravity/resources/app.asar`、`~/.local/share/Antigravity/resources/app.asar`、`~/Downloads/Antigravity*/resources/app.asar` |

安装器采用第一个存在的候选路径。如果安装了多个版本，建议显式使用 `--asar`。

## 更新补丁与客户端

更新本项目后，完全退出客户端，再运行安装器：

```bash
git pull --ff-only
python3 install.py
```

如果是客户端自身升级，先保存升级后的同版本 ASAR 与 unpacked 目录，再重新安装补丁。客户端内部文件或原生菜单钩子变化时，仍可能需要调整补丁。

每次安装会嵌入最新仓库词典，已有用户覆盖词典保持不变。旧版安装器生成的完整外部词典也会保留；如果其中旧译文覆盖了新版词库，可先另存，再将外部文件精简为自己需要修改的键。

## 自定义词典

安装器仅在文件不存在时创建空的用户覆盖词典 `{}`。基础词库随引擎嵌入，无需复制完整词库；用户文件优先级高于基础词库。路径位于运行安装器的用户家目录：

| 平台 | 路径 |
| --- | --- |
| Linux / macOS | `~/.antigravity-zh/zh-CN.json` |
| Windows | 通常为 `%USERPROFILE%\.antigravity-zh\zh-CN.json` |

安装器与客户端应使用同一个用户账号，否则可能读写不同的家目录。

文件采用英文原文到中文译文的 JSON 映射，例如：

```json
{
  "Settings": "设置",
  "New conversation": "新建对话"
}
```

运行时也接受 `{ "translations": { ... } }` 格式。请使用非空字符串键和字符串译文，保持 JSON 语法正确。

### 热更新

- 修改、新增或删除用户词条后，引擎会从基础词库与当前用户文件重建字典和索引，更新已翻译节点；删除覆盖项会恢复基础译文，没有基础译文时恢复原文。
- 监听词典所在目录，兼容编辑器用临时文件替换原文件的保存方式。连续事件会合并，在最后一个事件后约 200ms 开始加载，不保证整个界面在 200ms 内完成刷新。
- 文本节点及可翻译属性通过 `WeakMap` 保存原文。应用自身更新文本时，采用新的应用文本，不复活旧内容。
- JSON 损坏或词条类型无效时保留上一份有效字典，并在开发者控制台输出提示；删除整个用户文件则恢复基础词库。
- 外部文件需要本地文件访问能力；preload 沙箱禁用相关模块时，仍使用内嵌词库，但无法热更新。以 `__` 开头的用户键保留为元数据，不参与翻译。

## 兼容边界

- 原生界面依赖固定源码钩子，DOM 保护依赖页面结构；客户端升级后仍需实测。当前不会翻译任何 `value` 属性，避免修改表单和业务值。
- ASAR 解包会检查路径、大小、外置文件及已有 SHA256 信息。缺文件会报错，不会创建空占位。当前明确拒绝 ASAR 符号链接条目及不安全路径，不应绕过这些错误继续安装。
- 文件先在目标文件系统暂存、校验，再切换；捕获到切换异常会回滚。若系统也拒绝回滚，会保留恢复目录并报告路径。两个路径的切换不保证断电或强制杀进程时的原子性。
- 操作使用 `app.asar.agzh.lock` 防止安装器并发写入。若上次被强制终止，确认没有安装器进程后再删除残留锁；同时检查日志中的恢复目录。
- macOS 签名、实际客户端启动与界面效果仍需在目标设备上验证；自动化样例测试不能代替这些检查。

## 常见问题

| 现象 | 建议检查 |
| --- | --- |
| 找不到 `app.asar` | 确认是目标桌面客户端，并用 `--asar` 指定实际文件 |
| 提示缺少 `dist/preload.js` 或出现文件不存在异常 | 客户端内部结构可能不兼容；核对版本与包结构 |
| 安装完成，但部分菜单仍是英文 | 检查安装输出中的文件缺失、钩子未匹配提示 |
| 词典改了，当前页面没变化 | 验证 JSON、确认客户端和安装器使用同一用户，然后重新打开页面或重启 |
| 新版词库仍显示旧译文 | 检查旧版遗留的完整外部词典是否覆盖了基础译文 |
| 旧备份校验失败 | 使用同版本完整备份或重新安装官方客户端，不要混用不同版本的外置文件 |
| macOS 重签名失败或无法启动 | 保存 `codesign` 错误信息，优先从完整备份恢复或重新安装官方客户端 |
| 安装或还原后启动异常 | 同时核对 ASAR 和 unpacked 文件，使用同版本完整备份恢复 |

反馈问题请提供：操作系统、客户端版本、仓库提交号、执行命令、相关日志，以及能复现问题的界面描述或截图。分享前请移除路径中的个人信息、对话内容和密钥。

## 项目结构与开发

| 文件 | 用途 |
| --- | --- |
| `install.py` | 路径探测、字典加载、补丁注入、备份、还原和签名 |
| `asar.py` | ASAR 打包、解包、列表与完整性字段生成 |
| `dicts/engine.js` | 翻译引擎模板、动态规则、用户词典热更新和 DOM 保护 |
| `dicts/zh_cn.json` | 唯一的内置词库来源，安装时嵌入引擎 |
| `SKILL.md` | 智能体安装、检查与还原说明 |
| `tests/` | ASAR、安装事务、词典和 DOM 保护的回归测试 |
| `.github/workflows/tests.yml` | Linux、macOS、Windows 的自动化检查 |
| `LICENSE` | MIT 协议 |

安装补丁只需 Python；开发测试还需 Node.js 22 或更新版本，无需 npm 安装依赖：

```bash
python3 -m py_compile install.py asar.py
python3 -m unittest discover -s tests -v
node --test tests/engine.test.cjs
python3 install.py --help
```

JavaScript 测试会调用 Python 生成真实注入脚本，并在 Node VM 与模拟 DOM 中验证行为。可用 `PYTHON` 环境变量指定 Python 可执行文件。CI 在三种桌面系统运行测试，但不会安装或启动真实 Antigravity。

修改引擎时应优先验证：重复安装、同版本完整还原、unpacked 文件与权限保留、安装中断后的恢复、外部词典增改删，以及代码区和可编辑区的原文保护。

## 协议与致谢

本项目采用 [MIT License](LICENSE)，基于 [zhonghugo/antigravity-zh](https://github.com/zhonghugo/antigravity-zh) 继续维护，增加了词库、匹配优化与内容保护规则。感谢原作者及社区贡献者。
