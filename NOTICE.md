# Project Attribution, Modifications, and Responsibility

This notice records provenance and responsibility boundaries for this fork of
openCodexMicro. The MIT terms in `LICENSE` control the project-authored code.
Third-party components remain subject to the licenses listed in
`THIRD_PARTY_NOTICES.md`.

## Provenance and material changes

The original openCodexMicro work is copyright 2026 Nian Liu. The original
copyright and MIT permission notice are preserved in `LICENSE`.

This fork materially changes the original distribution by:

- removing the standalone Python/D200 HID runtime, its installer, dependencies,
  tests, generated assets, and maintenance instructions;
- making Ulanzi Studio the only device-integration layer;
- reducing installation to the local `Codex Bridge.app`/sidecar and the Codex
  Micro Ulanzi Studio plugin;
- adding plugin build, validation, atomic installation, documentation, and
  focused installation skills; and
- consuming state and action interfaces exposed by the existing local Bridge
  from the plugin-based runtime.

Git history is the authoritative record of individual changes and authorship.
Files not changed by this fork retain their existing attribution.

## Responsibility boundaries

- **Original authors:** Attribution to an original author identifies authorship
  of the upstream work. It does not imply review, endorsement, support, or
  responsibility for changes introduced by this fork.
- **Ulanzi-maintained scope:** Ulanzi's implementation and maintenance scope in
  this project is limited to
  `integration/com.ulanzi.codexmicro.ulanziPlugin/`. Publication through
  Ulanzi's official GitHub organization must not be interpreted as Ulanzi
  authorship, maintenance, support, or responsibility for the inherited Bridge,
  Codex internals, CDP, or other upstream components outside that directory.
- **CDP role:** The Ulanzi-maintained plugin is only a receiving/consuming side
  of state and action interfaces exposed through the existing local Bridge. It
  did not participate in the design, specification, development, or maintenance
  of CDP or of Codex's CDP implementation, and it does not claim ownership or
  control of either.
- **Other fork maintainers and contributors:** They remain responsible for the
  changes, packaging, documentation, and support commitments they introduce.
  They do not speak for or bind Ulanzi, the original authors, or any third
  party.
- **Third-party components:** Each component is supplied under its own license.
  Its authors and copyright holders are not responsible for this project's
  integration, packaging, operation, or support.
- **OpenAI:** Codex and ChatGPT are products or trademarks of OpenAI. This is an
  independent, unofficial integration with OpenAI products and is not
  affiliated with, sponsored by, endorsed by, or supported by OpenAI. OpenAI's
  applications, services, accounts, and terms remain under OpenAI's control.
- **Ulanzi:** Ulanzi, Ulanzi Studio, and D200 are products or trademarks of
  their respective Ulanzi rights holders. This fork is published and maintained
  through Ulanzi's official GitHub organization subject to the component scope
  above. That publication does not create warranties or customer-support
  commitments beyond those expressly stated by Ulanzi for the plugin or a
  separately distributed product.
- **Users and distributors:** They are responsible for reviewing applicable
  third-party terms, permissions, security settings, backups, and suitability
  before installing, modifying, or redistributing the software.

The software is provided without warranty under the disclaimer in `LICENSE`.
Compatibility with third-party applications, services, APIs, devices, or
future versions is not guaranteed.

## 中文说明

本项目是在 openCodexMicro 原始工作的基础上修改的 fork。原作者 Nian Liu
的版权声明和 MIT 许可完整保留在 `LICENSE` 中。本 fork 的主要改动包括：删除
Python/D200 直连运行时及其安装、依赖、测试和文档；改由 Ulanzi Studio 负责
设备集成；将安装流程收敛为 `Codex Bridge.app`/sidecar 与 Codex Micro 插件；
增加插件构建、校验、原子安装、文档及相关 skills；插件仅消费现有本机 Bridge
暴露的状态与操作接口。具体改动和作者以 Git 历史为准。

原作者不因署名而对本 fork 的改动承担维护、支持或背书责任。Ulanzi 在本项目中的
实现与维护范围仅限
`integration/com.ulanzi.codexmicro.ulanziPlugin/` 插件目录；通过 Ulanzi 官方
GitHub 组织发布，不代表 Ulanzi 对该目录之外继承的 Bridge、Codex 内部实现、CDP
或其他上游组件承担开发、维护或支持责任。Ulanzi 侧插件仅作为现有本机 Bridge 所
暴露状态与操作接口的协议接收/消费方，没有参与 CDP 或 Codex CDP 实现的设计、
规范制定、开发或维护，也不主张对其拥有所有权或控制权。

其他 fork 维护者和贡献者仍各自负责其引入的改动、打包、文档和明确作出的支持承诺；
第三方组件继续适用各自许可，其作者不对本项目的集成和运行负责。除非 Ulanzi 针对
插件或另行分发的产品作出明确说明，官方 GitHub 发布行为本身不新增产品担保或客户
支持承诺。本项目仍是与 OpenAI 产品对接的独立、非官方集成，与 OpenAI 无隶属、
赞助、背书或官方支持关系。用户和再分发者应自行确认第三方条款、权限、安全设置、
备份和适用性。软件不提供担保，责任限制以 `LICENSE` 中的 MIT 免责声明为准。
