# Antigravity 中文汉化与实时指标

<p align="center">
  <a href="https://github.com/shadowzhz/antigravity-zh/actions/workflows/tests.yml"><img src="https://github.com/shadowzhz/antigravity-zh/actions/workflows/tests.yml/badge.svg" alt="Tests"></a>
  <img src="https://img.shields.io/badge/Python-3.7+-3776AB.svg?logo=python&logoColor=white" alt="Python 3.7+">
  <img src="https://img.shields.io/badge/Platform-Linux%20%7C%20macOS%20%7C%20Windows-blue.svg" alt="Platform">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License: MIT"></a>
</p>

> **为 Google Antigravity 桌面客户端（Agent Manager）提供简体中文汉化和可选实时会话指标。**
> 保留原生主题与字体。纯 Python 标准库安装，无需额外 Node.js / npm；支持词典热更新、安全备份和完整还原。

---

## ✨ 核心特性 (Features)

- ⚡ **零外部依赖**：仅需 Python 3.7+ 标准库，免安装 Node.js、npm 或任何第三方 Python 轮子。
- 🛡️ **开发者级防误翻保护**：
  - **代码与终端隔离**：自动跳过 `<pre>`、`<code>`、终端模拟器（`.xterm`）、代码 Diff 视图及用户输入区域。
  - **全小写实体免伤**：首创孤立小写词保护机制，项目名（如 `project`）、目录名（如 `workspace`）、变量名及 Shell 命令保持英文原貌，杜绝误伤。
  - **AI 思考与指令保护**：模型思考链（Chain of Thought）、工具调用摘要及 `/` 快捷指令原生呈现。
- 📊 **实时会话指标胶囊（`--metrics`）**：显示生成速度、首字耗时与输出量；点击胶囊可查看或收起上下文参考水位、缓存、思考/正文输出、本轮与会话累计统计。直接使用客户端内置 SQLite，无需单独安装 Node.js 或守护服务。
- 🌐 **深度本地化覆盖**：内置 **6,500+ 条** 词条，覆盖 Knowledge Work 知识工作模式、主界面、偏好设置、原生系统菜单、托盘及启动向导；已在 Linux Antigravity **2.31.0** 验证汉化、外观设置与实时指标。
- 🔄 **词典即时热重载**：支持用户自定义扩展词典，编辑保存即可即时生效，无需重启客户端。
- 🔒 **安全事务与无损还原**：成套备份 `app.asar` 与 `unpacked` 资源，具备 SHA256 完整性校验、原子回滚机制与文件锁，随时一键还原官方原版。
- 💻 **跨平台智能探测**：内置 Linux、macOS（集成 ad-hoc 自动重签名）与 Windows 的标准路径智能探测。

---

## ⚡ 快速开始 (Quick Start)

> [!IMPORTANT]
> 安装或还原前，请**完全退出 Antigravity 客户端**（包括系统托盘中的后台驻留进程）。

### 1. 克隆仓库

```bash
git clone https://github.com/shadowzhz/antigravity-zh.git
cd antigravity-zh
```

### 2. 一键安装

```bash
python3 install.py
```
> **Windows 用户**：若未配置 `python3` 别名，请使用 `py -3 install.py` 或 `python install.py`。

若客户端位于非默认路径，使用 `--asar` 手动指定目标文件：
```bash
python3 install.py --asar "/path/to/resources/app.asar"
```

安装完成后，直接启动 Antigravity 即可看到中文界面。

---

## 📋 常用管理命令 (Management)

| 操作 | 命令 | 说明 |
| :--- | :--- | :--- |
| **安装 / 更新** | `python3 install.py` | 注入最新汉化补丁（自动备份原版） |
| **汉化 + 实时指标** | `python3 install.py --metrics` | 启用汉化与指标胶囊，不修改主题或字体 |
| **查看状态** | `python3 install.py --status` | 检查汉化标记、文件大小与 SHA256 校验信息 |
| **一键还原** | `python3 install.py --restore` | 完整还原为官方原版，保留用户自定义词典 |
| **修复权限** | `python3 install.py --repair-acl` | Windows：修复被破坏的 `app.asar` 文件权限（需管理员） |

> *注：若安装时指定了自定义 `--asar` 路径，执行 `--status` 或 `--restore` 时需传入相同的 `--asar` 参数。*

### 实时指标胶囊

旧版 `--theme` 和 `--install-fonts` 已移除。升级时运行 `python3 install.py --metrics` 即可替换旧主题引擎；已有字体和用户 `custom.css` 不会被删除，但不再由补丁安装或加载。

- 需要客户端 Electron 内置 `node:sqlite`。安装器仍只需要 Python；若客户端过旧缺少该接口，胶囊会提示升级，不影响客户端启动。
- 打开已有生成记录的会话后显示；首页、空会话或没有有效用量记录时隐藏。
- 窗口可见时每 2.5 秒检查当前会话。数据来自已写入数据库的调用元数据，并非逐 Token 实时采样。
- 仅只读访问 `~/.gemini/antigravity/conversations/<会话ID>.db`；Insiders 使用 `~/.gemini/antigravity-insiders/conversations/`。不修改会话数据库，不向外发送指标。
- 固定显示在模型选择器同侧；点击胶囊（或聚焦后按 Enter/空格）可展开或收起详情，按 Escape 或点击外部关闭。
- **256k 是参考容量，不是自动识别的模型上限或压缩阈值**。本轮统计沿用上游的规划步数与有效调用尾部匹配方式，缺失用量记录时不能保证逐步精确对应。
- 重新执行不带 `--metrics` 的 `python3 install.py` 会移除指标模块、保留汉化；`--restore` 仍完整还原官方包。

---

## ⚙️ 自定义词典与热重载 (Custom Dictionary)

安装器首次运行时，会在用户家目录下创建独立的用户词典文件，其优先级高于内置词典：

- **词典路径**：
  - **Linux / macOS**: `~/.antigravity-zh/zh-CN.json`
  - **Windows**: `%USERPROFILE%\.antigravity-zh\zh-CN.json`
- **词典格式**（JSON 键值对映射）：
  ```json
  {
    "Settings": "偏好设置",
    "New conversation": "开启新对话"
  }
  ```
- **即时热生效**：编辑并保存该文件后，运行中的客户端会自动重载新词条并局部刷新，**无需重启客户端**。

---

## 🔍 路径自动探测 (Path Discovery)

安装器按以下顺序自动匹配首个存在的客户端路径：

| 操作系统 | 默认检测路径 |
| :--- | :--- |
| **macOS** | `/Applications/Antigravity.app/Contents/Resources/app.asar`<br>`~/Applications/Antigravity.app/Contents/Resources/app.asar` |
| **Windows** | `%LOCALAPPDATA%\Programs\Antigravity\resources\app.asar` |
| **Linux** | `~/.local/opt/antigravity/resources/app.asar`<br>`/opt/Antigravity/resources/app.asar`<br>`~/.local/share/Antigravity/resources/app.asar`<br>`~/Downloads/Antigravity*/resources/app.asar` |

---

## 📁 项目结构 (Project Structure)

```text
antigravity-zh/
├── install.py         # 汉化安装器主入口（路径自发现、事务备份、无损还原与签名维护）
├── asar.py            # 纯 Python 实现的轻量级 ASAR 打包/解包与流式补丁引擎
├── dicts/             # 翻译引擎、词库及独立指标采集/显示模块
├── tests/             # ASAR 读写、事务回滚、翻译与指标测试
└── LICENSE            # MIT 开源许可证
```

---

## 🛠️ 常见问题 (FAQ / Troubleshooting)

<details>
<summary><b>Q: 官方客户端升级后汉化失效怎么办？</b></summary>

官方升级会直接覆盖 `app.asar`。在更新本项目后重新运行安装即可：
```bash
git pull
python3 install.py
```
已有的自定义用户词典（`~/.antigravity-zh/zh-CN.json`）会被完整保留，不会受影响。
</details>

<details>
<summary><b>Q: 提示找不到 app.asar 怎么处理？</b></summary>

若使用了绿色便携版或自定义安装目录，请先找到客户端目录下的 `resources/app.asar`，然后通过参数指定：
```bash
python3 install.py --asar "/your/custom/path/resources/app.asar"
```
</details>

<details>
<summary><b>Q: 启动后只剩下 Electron 欢迎页（提示 <code>Antigravity.exe path-to-app</code>）？</b></summary>

这说明 `app.asar` 的读取权限被破坏了：Electron 读不到应用包，就会退回内置的默认程序，于是只显示那个“Electron”欢迎窗口。

原因是旧版安装器把暂存文件放进 `tempfile.mkdtemp()` 目录，该目录自带受保护 DACL（仅 `SYSTEM`、`Administrators`、所有者可访问）。若安装器本身是以**管理员身份**运行的，新文件的属主会变成 `Administrators`，普通权限启动的客户端就彻底读不到 `app.asar`；此时执行 `--restore` 也没用，因为还原同样走这条暂存路径。

以**管理员身份**打开终端执行一次权限修复即可（无需重装客户端）：

```bash
python install.py --repair-acl
```

`app.asar` 恢复可读后客户端即可正常启动；随后在**普通权限**的终端重新执行 `python install.py` 注入汉化。新版安装器已在暂存目录创建后、以及替换完成后自动重置权限并校验可读性，不会再出现该问题。
</details>

<details>
<summary><b>Q: 为什么某些专业代码、项目名或命令没有被翻译？</b></summary>

这是特意设计的**防误翻保护机制**。为了保证开发体验，代码块、终端输入、全小写单词实体（如 `project`、`workspace`、`task`）默认保持英文原貌。如果确需汉化某个特定词条，可将其添加到自定义用户词典中。
</details>

<details>
<summary><b>Q: macOS 启动提示“应用已损坏”？</b></summary>

安装器在 macOS 上修改 `app.asar` 后会自动调用系统 `codesign` 进行 ad-hoc 重签名。若系统安全策略拦截，可随时使用 `python3 install.py --restore` 一键还原官方原版。
</details>

---

## 🧪 开发与测试 (Testing)

本项目自带完整的自动化测试套件：

```bash
# 1. 语法检查
python3 -m py_compile install.py asar.py

# 2. 运行 Python 事务安全与 ASAR 回归测试
python3 -m unittest discover -s tests -v

# 3. 运行翻译与指标测试（开发环境需 Node.js 22.13+）
node --test tests/engine.test.cjs tests/metrics-backend.test.cjs tests/metrics-ui.test.cjs
```

---

## 📄 开源许可与致谢 (License)

- 本项目采用 [MIT License](LICENSE) 协议开源。
- 基于 [zhonghugo/antigravity-zh](https://github.com/zhonghugo/antigravity-zh) 继续开发与维护，增强了匹配引擎、防误翻隔离与事务安全机制。感谢原作者与社区贡献者的付出！
- 指标方案参考 [Anarcadia/chuanban-antigravity-theme-patch](https://github.com/Anarcadia/chuanban-antigravity-theme-patch)，本项目仅保留指标功能并接入 Electron 主进程 IPC，不运行上游 CDP 守护服务。
