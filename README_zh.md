# OpenCodexMicro

**通过 Ulanzi Studio，用 Ulanzi D200 Series 操控 Codex Desktop。**

[English](README.md)

![Ulanzi D200 Series 上的 OpenCodexMicro](docs/images/codex-keyboard-hero.png)

OpenCodexMicro 通过本机回环 Bridge 暴露 Codex 的实时 Micro 状态，再由原生
Ulanzi Studio 插件显示最近任务、精确切换任务，并提供 Fast、Usage、Pin、New、
Fork、Steer、Mic 和 Submit 操作。

## 实现的功能

| 功能 | 行为 |
| --- | --- |
| 五个实时任务 Action | 展示 Codex Most Recent 任务及空闲、运行、完成、等待处理或错误状态 |
| 精确任务切换 | 通过 Codex 自己的 Micro event bus 打开按键显示的任务 |
| Codex 常用控制 | Fast、Usage、Pin、New、Fork、Steer、Mic 和 Submit |
| Usage 显示 | 在按键上动态绘制剩余额度，点击后回到 Codex 应用 |
| Ulanzi Studio 集成 | 由 Ulanzi Studio 独占设备并管理实体键位 |
| 仅本机通信 | CDP 与 Bridge API 都只绑定回环地址 |

这是由 Ulanzi 维护、通过 CDP 与 Bridge API 对接 Codex Desktop 的插件项目；
它不是 OpenAI 官方集成，也不代表 OpenAI 的背书或支持。

Ulanzi 的实现与维护范围仅限
`integration/com.ulanzi.codexmicro.ulanziPlugin/` 插件目录。插件只消费现有
本机 Bridge 暴露的状态与操作接口；Ulanzi 没有参与 CDP 或 Codex CDP 实现的
设计、规范制定、开发或维护。完整责任边界见[改动与责任声明](NOTICE.md)。

## 安装

要求：

- 已安装 Codex Desktop 与 Ulanzi Studio 的 macOS；
- 已在 Ulanzi Studio 中连接 Ulanzi D200 Series；
- Node.js 20 或更高版本。

克隆仓库后只需完成以下两步。

### 1. Setup Codex Bridge.app

```bash
npm install
npm run setup
```

该命令构建本机 Bridge sidecar、注册用户级 LaunchAgent，并把
`Codex Bridge.app` 安装到 `~/Applications`。

### 2. 安装 Ulanzi Studio 插件

```bash
npm run install:plugin
```

仓库已经包含构建完成的插件。该命令只把
`com.ulanzi.codexmicro.ulanziPlugin` 安装到 Ulanzi Studio 的本地插件目录，
不会在安装时重新构建。安装后重启 Ulanzi Studio。

完全退出 Codex，再打开 `~/Applications/Codex Bridge.app`。可用以下命令确认连接：

```bash
curl http://127.0.0.1:17373/health
curl http://127.0.0.1:17373/state
```

最后在 Ulanzi Studio 中把 Codex Micro actions 拖到需要的按键。安装路径、诊断、
更新与卸载方法见 [安装与运行](docs/setup-and-operations.md)。

## 配置

实体布局完全由 Ulanzi Studio 管理。插件提供 Codex Task 1–5、Fast、Usage、Pin、
New、Fork、Steer、Mic 和 Submit，不需要额外的设备 daemon 或快捷键映射。

Action 行为和布局建议见 [配置详解](docs/configuration.md)，版本说明见
[CHANGELOG.md](CHANGELOG.md)。

仓库包含两个可复用的 Codex skill：

| Skill | 用途 |
| --- | --- |
| [`setup-codex-bridge`](skills/setup-codex-bridge/SKILL.md) | 安装、更新、验证或修复 `Codex Bridge.app` 与 sidecar |
| [`install-ulanzi-studio-plugin`](skills/install-ulanzi-studio-plugin/SKILL.md) | 把仓库中的预构建插件目录安装到 Ulanzi Studio |

## LLM 与代码 Agent 安装入口

LLM 和代码 Agent 在执行安装前必须先阅读 [AGENTS.md](AGENTS.md)。规定流程会先在
Ulanzi Studio 已安装插件中检索 Codex Micro 的 manifest UUID；若未安装，使用
`$install-ulanzi-studio-plugin` 并完成验证，再使用 `$setup-codex-bridge`；若插件
已经安装，则不重复安装，直接使用 `$setup-codex-bridge`。

## 文档

- [配置详解](docs/configuration.md)
- [安装与运行](docs/setup-and-operations.md)
- [架构说明](docs/architecture.md)
- [工程约束](docs/errors.md)

## License

项目自有代码采用 [MIT License](LICENSE)。上游署名、实质改动、Ulanzi 维护关系、
与 OpenAI 的独立关系及责任边界见[改动与责任声明](NOTICE.md)，运行时和构建依赖
的许可见[第三方许可声明](THIRD_PARTY_NOTICES.md)。
