# 🀄 Antigravity 中文汉化增强版（antigravity-zh）

为 **Google Antigravity** 桌面客户端（Agent Manager）打造的高性能、无侵入式、防误翻的中文汉化补丁。
纯 Python 标准库实现，无需 Node.js / npm 等外部依赖，一键安装、即时生效、一键还原。

> ⚠️ 非 Google 官方语言包。本工具通过本地安全注入方式注入汉化引擎，安装前自动备份官方原版 `app.asar.bak`，可随时一键无损还原。
> Antigravity 官方客户端升级后会覆盖本地文件，升级后重新运行本脚本即可。

---

## ✨ 核心特性

- 🚀 **高性能重构（0 卡顿）**：
  - 重构了原版遍历匹配算法，引入预编译组合正则与 $O(1)$ 大小写哈希索引，彻底解决原版打开“设置”或长会话时主线程严重冻结卡死的问题。
- 🛡️ **深度防误翻与代码隔离**：
  - **单单词小写实体保护**：独创首字母大小写语境隔离，用户项目名（如 `project`）、目录名（如 `workspace`）、代码变量与脚本名 100% 保持英文原貌，永不误伤。
  - **命令行与终端免疫**：深度遍历 `<pre>`、`<code>` 祖先树，支持 `.xterm` 终端仿真器隔离，消除 Shell 脚本（如 `|| true` 变 `|| 真`）被篡改的风险。
  - **智能体动态内容保护**：智能体执行摘要（`toolSummary`）与思考链（Chain of Thought）原生保留，避免碎片化中英混排。
  - **快捷指令纯净原生**：隔离 `/` 指令与 `@` 提及下拉菜单，快捷指令与描述保持官方英文原版。
- 🌐 **深度覆盖 Antigravity 2.29+**：
  - 词库扩展至 **6,200+ 条高质量词条**，完整覆盖内置浏览器、语音模式（Voice Mode / Gemini Live）、对话步骤（Verbose）、无障碍、声音设置及远程智能体协同面板。
  - 专业级术语校对：统一“思考深度 (Reasoning Effort)”、“轮次 (Turn)”、“派生分支 (Fork)”、“工件 (Artifact)”，剔除生硬机翻。
- ⚡ **零重启热重载支持**：
  - 自动创建并监听外部词典 `~/.antigravity-zh/zh-CN.json`，随时修改字典，保存即时热刷新页面，无需重新打包。
- 📦 **纯 Python 零依赖跨平台**：
  - 纯 Python 实现 ASAR 解包与打包，自动探测 Linux / macOS / Windows 安装路径。
  - macOS 自动进行 ad-hoc 代码重签名，避免“应用已损坏”弹窗。

---

## 📥 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/shadowzhz/antigravity-zh.git
cd antigravity-zh
```

### 2. 安装汉化

> **提示**：安装前请先退出 Antigravity 客户端。

```bash
# 自动探测路径并安装
python3 install.py

# 也可以手动指定 app.asar 路径安装（如自定义安装目录）
python3 install.py --asar "/path/to/resources/app.asar"
```

### 3. 一键还原官方原版

```bash
python3 install.py --restore
```

### 4. 查看当前状态

```bash
python3 install.py --status
```

---

## ⚙️ 外部词典即时热重载

安装后，引擎会自动在您的用户家目录生成外部扩展词典：
- **路径**：`~/.antigravity-zh/zh-CN.json`

只要您使用文本编辑器修改并保存该文件，运行中的 Antigravity 客户端会在 200ms 内**自动热重载新词条并无缝刷新当前界面**，无需重启客户端，也无需重新运行安装脚本！

---

## 🧩 目录结构

```text
antigravity-zh/
├── install.py          # 跨平台一键安装 / 还原 / 检测主程序
├── asar.py             # 纯 Python 编写的 ASAR 解包与打包引擎
├── dicts/
│   ├── engine.js       # 运行时 DOM 翻译引擎（注入至 preload.js）
│   └── zh_cn.json      # 全量内嵌汉化词典（6,200+ 词条）
├── SKILL.md            # Antigravity 智能体专属 Skill 描述
└── README.md           # 项目文档
```

---

## 📜 开源协议与致谢

- 本项目采用 [MIT License](LICENSE) 开源。
- 本项目基于 [zhonghugo/antigravity-zh](https://github.com/zhonghugo/antigravity-zh) 进行了深度性能架构重构、DOM 语法安全隔离与 2.29+ 版本全面加固，感谢原作者的开源贡献。
