# 模型选择器兼容记录

核对日期：2026-09-07。来源：本机 Windows Stable 包
`OpenAI.Codex_26.901.6511.0_x64__2p2nqsd0c76g0` 中的只读 `app/resources/app.asar`。

- `webview/assets/app-primary-428a0a65766f.js`：模型列表选择后转为 simple power 面板；两个视图同时保留在 DOM，以祖先的 `aria-hidden`、`inert` 和 `data-active` 隔离。不能把隐藏列表当作当前选项。
- 该文件的 power 控件使用 `data-reasoning-slider`，接收 ArrowLeft/ArrowRight，逐档选择；可访问名称与等级标签经过本地化，不能用标签或截图坐标推断等级。
- 同一控件提交到 DOM 的 React children 含 power slider 的 `options` 与 `selectedOptionId`；只读提取有界字段，不调用私有 React 回调。
- `webview/assets/app-initial-f87238153a19.js`：档位 ID 为 `model:reasoningEffort`，方向键按当前选项数组相邻移动。数组可含其他模型或锁定档位，插件必须在移动前检查完整路径，不跨模型、不越过锁定项。
- 输入框旁 trigger 可只显示本地化等级，不再保证含模型名称。面板打开时根据 slider 的当前 model ID，并结合 trigger 的 `data-selected-reasoning-effort` 校验。

这些是版本敏感的 Desktop adapter 契约，不是 OpenAI 公共 API。
自动回归执行真实生成表达式，覆盖独立视图、隐藏列表、中文标签、多步升降、
禁用/缺失/歧义元数据、锁定路径及超时不重放。尚不代表 Studio/D200 的真实按键验收。
