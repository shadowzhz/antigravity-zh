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

当前 `dicts/zh_cn.json` 包含 **6,227 个唯一词条**。词条数量不等于界面覆盖率；工程名、代码、模型回复等内容也不适合按普通 UI 文案翻译。

## 兼容性与准备

- 需要 Python 3；代码使用 `subprocess.run(capture_output=True, text=True)`，要求 Python 3.7 或更新版本。
- 安装器包含 Linux、macOS 和 Windows 的路径探测逻辑。macOS 安装、还原后会尝试调用系统 `codesign` 进行 ad-hoc 重签名。
- 目标客户端必须采用 `resources/app.asar` 布局，并包含 `dist/preload.js`。名称相同但内部结构不同的客户端不一定适用。
- 仓库包含面向 2.29 系列文案的适配，但目前没有自动化兼容性矩阵，不能据此保证所有 2.29 及后续版本均可使用。
- 需要对目标安装目录有写权限。权限不足时，先确认目标路径和目录权限。

**首次安装或客户端更新后，请把以下文件复制到安装目录以外的备份位置：**

1. 当前版本的 `app.asar`。
2. 同目录的 `app.asar.unpacked/`（如果存在）。
3. 自定义过的 `~/.antigravity-zh/zh-CN.json`（如果存在）。

脚本会生成 `app.asar.bak`，但目前不会为原始 `app.asar.unpacked/` 保留对应的长期备份；重新安装还会覆盖外部词典。因此，脚本自带备份不能代替上述完整备份。

## 快速开始

### 1. 获取项目

```bash
git clone https://github.com/shadowzhz/antigravity-zh.git
cd antigravity-zh
```

下文使用 Linux/macOS 常见的 `python3` 命令。Windows 安装了 Python Launcher 时，可以将它替换为 `py -3`；否则使用指向 Python 3 的 `python`。

### 2. 退出客户端并安装

请完全退出 Antigravity，包括托盘中的后台进程。当前安装器仅对 macOS 和 Windows 实现了进程检查，Linux 需要自行确认；还原命令也不会自动检查运行中的进程。

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

状态信息包含 ASAR 路径、大小、SHA256、备份情况，以及主 preload 中是否存在当前注入标记。它不验证所有翻译功能、文件完整性或客户端是否能够启动。

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

`--restore` 将 `app.asar.bak` 复制回 `app.asar`，不会恢复完整的原始 unpacked 目录，也不会删除用户目录中的外部词典。若还原后无法启动，使用安装前保存的同版本 `app.asar` 与 `app.asar.unpacked/` 成套恢复，或重新安装对应的官方客户端。

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

如果是客户端自身升级，先保存升级后的同版本 ASAR 与 unpacked 目录，再重新安装补丁。当前脚本通过注入标记和文件修改时间判断是否更新 `.bak`，没有校验备份与客户端版本的对应关系。

每次安装都会重新复制仓库词典到用户目录。若维护了自定义译文，请先另存，再把需要的改动合并回去。

## 自定义词典

安装器在运行它的用户家目录中写入词典：

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

### 热更新的实际边界

- 引擎能够访问本地文件时，会加载外部词典；读取失败或环境受限时使用内嵌词典。
- 文件变化后会安排约 200ms 的延迟加载。这不是端到端刷新时间保证，也尚未实现合并连续事件的防抖。
- 已显示的英文会被直接替换成中文，原文没有保留。修改译文后，已经翻译的节点可能继续显示旧中文，需要重新打开页面或重启客户端。
- 从外部文件删除词条，不会立即清除运行时字典里的旧值。重启后重新加载；内嵌词典中已有的词条仍然存在。
- 部分编辑器采用“写临时文件再替换”的保存方式，文件监听可能受影响。修改没有生效时，先检查 JSON，再重启客户端确认。

## 已知限制

- **ASAR 元数据保留不完整：** 重打包仅为匹配 `chrome-devtools-mcp` 的路径保留 unpacked 状态，其他原本外置的文件会被打入归档；解包复制外置文件时也没有保留其可执行权限。依赖这些布局或权限的客户端组件可能受影响。
- **异常恢复仍有缺口：** unpacked 目录切换发生在部分回滚保护之外，复制或移动失败后可能需要手动恢复备份。
- **防误翻依赖页面结构：** 当前规则不能覆盖所有可编辑区、项目名称或未来新增组件。发现误翻请附上触发位置；不要把“已知区域跳过”理解为不会修改任何用户内容。
- **词典存在多个来源：** `engine.js` 仍内置基础词典，部分译文与 JSON 不一致。外部词典不可用时，修改 JSON 中已有键的译文不一定覆盖引擎内置值。
- **仅处理可信安装文件：** 自带 ASAR 解包器尚未完整校验归档路径和元数据，不应作为通用工具处理来源不明的归档。

## 常见问题

| 现象 | 建议检查 |
| --- | --- |
| 找不到 `app.asar` | 确认是目标桌面客户端，并用 `--asar` 指定实际文件 |
| 提示缺少 `dist/preload.js` 或出现文件不存在异常 | 客户端内部结构可能不兼容；核对版本与包结构 |
| 安装完成，但部分菜单仍是英文 | 检查安装输出中的文件缺失、钩子未匹配提示 |
| 词典改了，当前页面没变化 | 验证 JSON、确认客户端和安装器使用同一用户，然后重新打开页面或重启 |
| 自定义译文重装后消失 | 当前安装器会覆盖外部词典，从自备副本重新合并 |
| macOS 重签名失败或无法启动 | 保存 `codesign` 错误信息，优先从完整备份恢复或重新安装官方客户端 |
| 安装或还原后启动异常 | 同时核对 ASAR 和 unpacked 文件，使用同版本完整备份恢复 |

反馈问题请提供：操作系统、客户端版本、仓库提交号、执行命令、相关日志，以及能复现问题的界面描述或截图。分享前请移除路径中的个人信息、对话内容和密钥。

## 项目结构与开发

| 文件 | 用途 |
| --- | --- |
| `install.py` | 路径探测、字典加载、补丁注入、备份、还原和签名 |
| `asar.py` | ASAR 打包、解包、列表与完整性字段生成 |
| `dicts/engine.js` | 翻译引擎模板、基础词典、动态规则和 DOM 保护 |
| `dicts/zh_cn.json` | 安装时嵌入并复制到用户目录的扩展词典 |
| `SKILL.md` | 智能体使用说明；其中版本、词条数和仓库地址仍需同步维护 |
| `LICENSE` | MIT 协议 |

基础检查可以使用：

```bash
python3 -m py_compile install.py asar.py
python3 -m json.tool dicts/zh_cn.json > /dev/null
python3 install.py --help
```

Windows 可将第二条命令的输出重定向改为 `> NUL`。语法检查不等于安装、还原或界面行为测试；当前仓库尚未包含自动化测试和 CI 工作流。

修改引擎时应优先验证：重复安装、同版本完整还原、unpacked 文件与权限保留、安装中断后的恢复、外部词典增改删，以及代码区和可编辑区的原文保护。

## 协议与致谢

本项目采用 [MIT License](LICENSE)，基于 [zhonghugo/antigravity-zh](https://github.com/zhonghugo/antigravity-zh) 继续维护，增加了词库、匹配优化与内容保护规则。感谢原作者及社区贡献者。
