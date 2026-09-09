// Serialized into the renderer. Keep all DOM access inside this replaceable
// adapter and scoped to the visible intelligence trigger's menu graph.
function inspectModelPicker(preset, kind) {
  const visible = element => {
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.getAttribute("aria-hidden") === "true" || ancestor.hasAttribute("inert")
        || ancestor.getAttribute("data-active") === "false") return false;
    }
    const rect = element?.getBoundingClientRect?.();
    return Boolean(element && element.getAttribute("aria-hidden") !== "true"
      && (element.offsetParent !== null || (rect?.width > 0 && rect?.height > 0)));
  };
  const triggers = [...document.querySelectorAll("[data-codex-intelligence-trigger]")].filter(visible);
  if (triggers.length !== 1) return kind === "snapshot" ? { modern: false } : [];
  const trigger = triggers[0];
  const open = element => visible(element) && element.getAttribute("data-state") !== "closed";
  const controlled = document.getElementById(trigger.getAttribute("aria-controls"));
  const roots = controlled && open(controlled) ? [controlled] :
    [...document.querySelectorAll('[role="menu"][data-state="open"]')].filter(menu =>
      open(menu) && (menu.querySelector("[data-model-picker-view-toggle]") || menu.querySelector("[data-reasoning-slider]"))
    );
  if (roots.length !== 1) return kind === "snapshot" ? { modern: false } : [];
  const menus = new Set(roots);
  // Radix submenus can be portalled outside their parent. Follow explicit
  // ownership only; unrelated open menus must never contribute candidates.
  for (const menu of menus) {
    for (const owner of menu.querySelectorAll("[aria-controls]")) {
      const child = document.getElementById(owner.getAttribute("aria-controls"));
      if (child && open(child)) menus.add(child);
    }
  }
  const selector = '[role="menuitem"],[role="menuitemradio"],[role="option"],[role="radio"],button';
  const items = [...new Set([...menus].flatMap(menu => [...menu.querySelectorAll(selector)]))]
    .filter(item => visible(item) && !item.disabled && item.getAttribute("aria-disabled") !== "true"
      && !item.hasAttribute("data-disabled") && !item.hasAttribute("data-model-picker-view-toggle")
      && !item.hasAttribute("data-reasoning-slider"));
  const normalize = value => String(value ?? "").replace(/\s+/g, " ").trim();
  const labels = item => [
    item.getAttribute("aria-label"),
    item.getAttribute("data-model-id"),
    item.getAttribute("data-model"),
    item.getAttribute("data-reasoning-effort"),
    item.getAttribute("data-value"),
    item.getAttribute("value"),
    item.textContent,
    // A label and a description often occupy separate spans.
    ...[...item.querySelectorAll("span")].filter(span => !span.children.length).map(span => span.textContent)
  ].filter(Boolean).map(normalize);
  const modelKey = value => normalize(value).toLowerCase().replace(/^gpt[- ]/, "").replace(/[- ]/g, "");
  const targets = new Set([preset.model, preset.displayName].map(modelKey));
  const innermost = candidates => candidates.filter(item =>
    !candidates.some(other => other !== item && item.contains(other)));
  const modelItems = innermost(items.filter(item =>
    // A legacy row can display the current model while opening the model
    // list, rather than selecting that model. Leave those rows to the legacy
    // semantic probe unless they explicitly identify an actual model.
    (item.getAttribute("aria-haspopup") !== "menu" || item.hasAttribute("data-model-id"))
    && labels(item).some(label => targets.has(modelKey(label)))));
  const effortKey = value => {
    const key = normalize(value).toLowerCase();
    return ({ "extra high": "xhigh", "extra-high": "xhigh", "maximum": "max",
      "无": "none", "最低": "minimal", "低": "low", "中": "medium", "高": "high", "极高": "xhigh", "極高": "xhigh", "最高": "max" })[key] || key;
  };
  const efforts = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
  const sliders = [...new Set([...menus].flatMap(menu => [...menu.querySelectorAll("[data-reasoning-slider]")]))]
    .filter(visible);
  let slider = null;
  if (sliders.length === 1) {
    const element = sliders[0];
    // Codex 26.901.6511.0, verified 2026-09-07: the committed host
    // children contain PowerSlider options {id: "model:effort", isLocked}
    // and selectedOptionId. Read only those fields, never invoke React
    // callbacks or infer a level from translated labels / pixel positions.
    const roots = Object.keys(element).filter(key => key.startsWith("__reactProps$"));
    const queue = roots.map(key => element[key]?.children);
    const seen = new Set();
    const candidates = [];
    for (let count = 0; queue.length && count < 200; count += 1) {
      const node = queue.shift();
      if (!node || typeof node !== "object" || seen.has(node)) continue;
      seen.add(node);
      if (Array.isArray(node)) { queue.push(...node); continue; }
      const props = node.props;
      if (!props || typeof props !== "object") continue;
      if (Array.isArray(props.options) && typeof props.selectedOptionId === "string") candidates.push(props);
      queue.push(props.children);
    }
    if (!queue.length && candidates.length === 1) {
      const props = candidates[0];
      const options = props.options.length <= 20 ? props.options.map(option => {
        if (typeof option?.id !== "string" || option.id.length > 160) return null;
        const separator = option.id.lastIndexOf(":");
        const model = option.id.slice(0, separator);
        const effort = option.id.slice(separator + 1);
        return separator > 0 && efforts.has(effort)
          ? { id: option.id, model, effort, locked: option.isLocked === true }
          : null;
      }) : [];
      const index = options.findIndex(option => option?.id === props.selectedOptionId);
      if (options.length && options.every(Boolean) && new Set(options.map(option => option.id)).size === options.length && index >= 0) {
        const targetIndexes = options.flatMap((option, index) =>
          targets.has(modelKey(option.model)) && option.effort === preset.effort ? [index] : []);
        slider = {
          options, index, current: options[index],
          targetIndex: targetIndexes.length === 1 ? targetIndexes[0] : -1,
          disabled: element.disabled || element.hasAttribute("data-disabled")
            || element.getAttribute("aria-disabled") === "true" || props.disabled === true || props.active === false
        };
      }
    }
  }
  if (kind?.type === "slider-step") {
    if (!slider || slider.disabled || sliders.length !== 1) throw new Error("Reasoning slider unavailable");
    const ids = slider.options.map(option => option.id);
    const nextIndex = slider.index + (kind.key === "ArrowRight" ? 1 : kind.key === "ArrowLeft" ? -1 : 0);
    const next = slider.options[nextIndex];
    if (JSON.stringify(ids) !== JSON.stringify(kind.ids) || slider.current.id !== kind.fromId
      || next?.id !== kind.toId || next.locked || next.model !== slider.current.model
      || !targets.has(modelKey(next.model))) throw new Error("Reasoning slider changed before input");
    sliders[0].focus({ preventScroll: true });
    sliders[0].dispatchEvent(new KeyboardEvent("keydown", { key: kind.key, code: kind.key, bubbles: true, cancelable: true }));
    sliders[0].dispatchEvent(new KeyboardEvent("keyup", { key: kind.key, code: kind.key, bubbles: true, cancelable: true }));
    return true;
  }
  const effortItems = innermost(items.filter(item =>
    item.getAttribute("aria-haspopup") !== "menu" && labels(item).some(label => efforts.has(effortKey(label)))));
  const targetEfforts = effortItems.filter(item => labels(item).some(label => effortKey(label) === preset.effort));
  if (kind === "model") return modelItems;
  if (kind === "effort") return targetEfforts;
  return {
    open: true,
    triggerEffort: trigger.getAttribute("data-selected-reasoning-effort"),
    modern: modelItems.length > 0 || effortItems.length > 0 || sliders.length > 0,
    sliderCount: sliders.length,
    slider,
    modelCount: modelItems.length,
    effortCount: targetEfforts.length,
    availableEffortCount: effortItems.length
  };
}

export function modelPickerExpression(preset, kind = "snapshot") {
  return `(${inspectModelPicker.toString()})(${JSON.stringify(preset)}, ${JSON.stringify(kind)})`;
}
