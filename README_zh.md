# OpenCodexMicro

**通过 Ulanzi Studio，用 Ulanzi D200 Series 操控 Codex Desktop。**

[English](README.md)

![Ulanzi D200 Series 上的 OpenCodexMicro](docs/images/codex-keyboard-hero.png)

OpenCodexMicro 通过本机回环 Bridge 暴露 Codex 的实时 Micro 状态，再由原生
Ulanzi Studio 插件显示最近任务、精确切换任务，并提供 Fast、Usage、Pin、New、
Fork、Steer、Mic、Submit 和 Latest Task & Scroll 旋钮操作。

## 实现的功能

| 功能 | 行为 |
| --- | --- |
| 五个实时任务 Action | 展示 Codex Most Recent 任务及空闲、运行、完成、等待处理或错误状态 |
| 精确任务切换 | 通过 Codex 自己的 Micro event bus 打开按键显示的任务 |
| Codex 常用控制 | Fast、Usage、Pin、New、Fork、Steer、Mic 和 Submit |
| 旋钮导航 | 按下打开 task1；左/右旋转通过 Ulanzi Studio hotkey 协议向上/向下滚动 |
| Usage 显示 | 在按键上动态绘制剩余额度，点击后回到 Codex 应用 |
| Ulanzi Studio 集成 | 由 Ulanzi Studio 独占设备并管理实体键位 |
| 仅本机通信 | CDP 与 Bridge API 都只绑定回环地址 |

这是由 Ulanzi 维护、通过 CDP 与 Bridge API 对接 Codex Desktop 的插件项目；
它不是 OpenAI 官方集成，也不代表 OpenAI 的背书或支持。

Ulanzi 的实现与维护范围仅限
`integration/com.ulanzi.codexmicro.ulanziPlugin/` 插件目录。插件只消费现有
本机 Bridge 暴露的状态与操作接口；Ulanzi 没有参与 CDP 或 Codex CDP 实现的
设计、规范制定、开发或维护。完整责任边界见[改动与责任声明](NOTICE.md)。

## 安装说明

### 安装环境

- Windows 10 或更高版本，或 macOS 13 或更高版本；
- Codex Desktop Stable 或 Beta；
- Ulanzi Studio 3.0.1 或更高版本；
- 已在 Ulanzi Studio 中连接 Ulanzi D200 Series；
- 仅使用仓库手动安装时需要 Node.js 20 或更高版本。

### 1. LLM / Agent 安装

LLM 或代码 Agent 必须按以下步骤执行：

1. 阅读 [AGENTS.md](AGENTS.md)，检查 Windows 的
   `%APPDATA%\Ulanzi\UlanziDeck\Plugins` 或 macOS 的
   `~/Library/Application Support/Ulanzi/UlanziDeck/Plugins` 下已经安装的插件 manifest。
2. 仅当 manifest UUID 为 `com.ulanzi.ulanzistudio.codexmicro`，且其 `CodePath`
   确实存在时，才判断 Codex Micro 已安装。
3. 如果插件缺失或无效，加载
   [`$install-ulanzi-studio-plugin`](skills/install-ulanzi-studio-plugin/SKILL.md)，
   安装插件并验证 manifest 和入口文件。
4. 插件验证通过后，加载
   [`$setup-codex-bridge`](skills/setup-codex-bridge/SKILL.md)，安装或修复
    Codex Bridge 与 sidecar，并验证本机 health 接口。
5. 分别报告插件安装状态和 Bridge 连接状态。除非用户要求更新或修复，否则不要重复
   安装有效插件。

### 2. 在 Ulanzi Studio 中安装 Bridge

安装 Codex Micro 插件后，把任意 Codex Micro Action 拖到按键并选中。所有 Action
共用的 **Codex Bridge 设置**页可以：

- 显示 Codex Bridge、用户级后台进程和 CDP 的状态；
- 使用插件内置资源安装或修复 Bridge，不需要仓库目录或 npm 项目目录；
- 使用仅限回环地址的 CDP 参数启动 Codex；
- 重新检测连接或打开完整安装说明。

Windows 安装器写入 `%LOCALAPPDATA%\OpenCodexMicro`；macOS 安装器写入当前用户的
Applications、Application Support 和 LaunchAgents 目录。两者都不需要管理员权限。

### 3. 手动安装

```bash
git clone https://github.com/UlanziTechnology/OpenCodexMicro.git
cd OpenCodexMicro
npm install
npm run install:plugin
npm run setup
```

运行 `npm run install:plugin` 前请退出 Ulanzi Studio。该命令会校验并原子安装仓库
中的预构建插件；`npm run setup` 会构建并安装当前平台的用户级 Bridge sidecar。

重新打开 Ulanzi Studio，在任意 Action 设置页点击“启动 Codex Bridge”，或运行
`npm run bridge:start`。Windows 会从 Appx 包元数据动态发现 Stable 或 Beta，
不会固定带版本号的 WindowsApps 目录。可用以下命令确认连接：

```bash
curl http://127.0.0.1:17373/health
curl http://127.0.0.1:17373/state
```

最后在 Ulanzi Studio 中把 Codex Micro actions 拖到需要的按键。安装路径、诊断、
更新与卸载方法见 [安装与运行](docs/setup-and-operations.md)。

> **注意事项：** Codex 必须带设置页所示的本机回环 CDP 参数启动。如果 `9222`
> 已在线，“启动”只会聚焦当前 Codex；否则会启动所选 Stable 或 Beta 通道。

## 配置

实体布局完全由 Ulanzi Studio 管理。插件提供 Codex Task 1–5、Fast、Usage、Pin、
New、Fork、Steer、Mic、Submit 和 Latest Task & Scroll 旋钮 Action，不需要额外的
设备 daemon 或快捷键映射。

选中任意已配置的 Action，即可打开共用的 **Codex Bridge 设置**页。该页面显示
Bridge 安装、后台服务和 CDP 状态，并提供“安装 / 修复”和“启动”操作。

在 macOS 中，请在“系统设置 > 隐私与安全性 > 辅助功能”中允许 Ulanzi Studio，
否则旋钮无法发送鼠标滚轮事件。

Action 行为和布局建议见[配置详解](docs/configuration.md)。

仓库包含两个可复用的 Codex skill：

| Skill | 用途 |
| --- | --- |
| [`setup-codex-bridge`](skills/setup-codex-bridge/SKILL.md) | 安装、更新、验证或修复 Codex Bridge 与 sidecar |
| [`install-ulanzi-studio-plugin`](skills/install-ulanzi-studio-plugin/SKILL.md) | 把仓库中的预构建插件目录安装到 Ulanzi Studio |

## 文档

- [配置详解](docs/configuration.md)
- [安装与运行](docs/setup-and-operations.md)
- [架构说明](docs/architecture.md)
- [工程约束](docs/errors.md)

## License

项目自有代码采用 [MIT License](LICENSE)。上游署名、实质改动、Ulanzi 维护关系、
与 OpenAI 的独立关系及责任边界见[改动与责任声明](NOTICE.md)，运行时和构建依赖
的许可见[第三方许可声明](THIRD_PARTY_NOTICES.md)。
