/**
 * Renderer boundary for the active composer's model picker. Keep React internals
 * here; callers receive only a model/effort snapshot, never picker callbacks.
 * @param {'read'|'model'|'reasoning'} kind
 * @param {'left'|'right'} [direction]
 * @returns {Promise<{model: string, modelLabel: string, reasoningEffort: string, modelIndex: number, modelCount: number, reasoningIndex: number, reasoningCount: number, changed?: boolean}|null>}
 */
export async function composerControl(kind = "read", direction) {
  const trigger = [...document.querySelectorAll('[data-composer-navigation-target="reasoning"]')]
    .find(element => element.getClientRects().length > 0 && !element.closest(
      '[data-app-shell-active-page="false"],[hidden],[inert],[aria-hidden="true"]'
    ));
  const picker = () => {
    if (!trigger?.isConnected) return null;
    const key = Object.getOwnPropertyNames(trigger).find(key => key.startsWith("__reactFiber$"));
    let fiber = trigger[key];
    let root = fiber;
    while (root?.return) root = root.return;
    // DOM fiber pointers alternate on commits. Always read the committed branch.
    if (root?.stateNode?.current && root.stateNode.current !== root) fiber = fiber?.alternate;
    for (let depth = 0; fiber && depth < 80; depth++, fiber = fiber.return) {
      const props = fiber.memoizedProps;
      if (Array.isArray(props?.models) && typeof props.onSelectModel === "function") return props;
    }
    return null;
  };
  const props = picker();
  if (!props) {
    if (kind === "read") return null;
    throw new Error("Codex model picker is not available");
  }
  // Picker order is a recommendation order, not a capability order. Keep known
  // lightweight families on the left and flagship families on the right.
  const tier = model => {
    const name = `${model.model} ${model.displayName || ""}`.toLowerCase();
    if (/nano/.test(name)) return 0;
    if (/mini|luna/.test(name)) return 1;
    if (/terra/.test(name)) return 2;
    if (/pro|astra/.test(name)) return 4;
    return 3;
  };
  const availableModels = current => (current.modelOptions ?? current.models.map(model => ({ model })))
    .filter(option => option.disabledReason == null && !option.model.hidden &&
      option.model.model !== current.lockedModelSlug)
    .map(option => option.model).reverse().sort((a, b) => {
      const family = tier(a) - tier(b);
      if (family) return family;
      const version = model => (model.model.match(/\d+(?:\.\d+)*/) || ["0"])[0];
      return version(a).localeCompare(version(b), "en", { numeric: true });
    });
  const efforts = model => model.supportedReasoningEfforts.map(item => item.reasoningEffort);
  const snapshot = current => {
    const models = availableModels(current);
    const model = current.models.find(model => model.model === current.model);
    const reasoningEffort = current.reasoningEffort ?? model?.defaultReasoningEffort;
    const reasoning = model ? efforts(model) : [];
    return {
      model: current.model,
      modelLabel: model?.displayName ?? current.model,
      reasoningEffort,
      modelIndex: models.findIndex(model => model.model === current.model),
      modelCount: models.length,
      reasoningIndex: reasoning.indexOf(reasoningEffort),
      reasoningCount: reasoning.length
    };
  };
  if (kind === "read") return snapshot(props);
  if (!["model", "reasoning"].includes(kind) || !["left", "right"].includes(direction)) {
    throw new Error("Invalid composer selection");
  }
  if ([...document.querySelectorAll('[data-codex-approval-surface]')].some(element =>
    element.getClientRects().length > 0 && !element.closest(
      '[data-app-shell-active-page="false"],[hidden],[inert],[aria-hidden="true"]'
    ))) throw new Error("Codex model selection is disabled during approval");
  if (props.disabled || props.daybreak?.disabled || props.daybreak?.isSaving ||
      trigger.matches(':disabled,[aria-disabled="true"],[data-disabled]') ||
      (kind === "model" ? props.modelOptionsDisabled :
        props.reasoningEffortDisabled || props.showReasoningEffortControls === false)) {
    throw new Error("Codex model selection is disabled");
  }
  const models = availableModels(props);
  const current = models.find(model => model.model === props.model);
  if (!current) throw new Error("Current model is not in the available model list");
  const currentEffort = snapshot(props).reasoningEffort;
  const values = kind === "model" ? models.map(model => model.model) : efforts(current);
  const value = kind === "model" ? props.model : currentEffort;
  const index = values.indexOf(value);
  if (index < 0) throw new Error("Current selection is not in the available list");
  const next = index + (direction === "left" ? -1 : 1);
  // Do not use modulo: reaching either end must leave the selection unchanged.
  if (next < 0 || next >= values.length) return { ...snapshot(props), changed: false };
  const model = kind === "model" ? models[next] : current;
  const effort = kind === "reasoning" ? values[next] :
    efforts(model).includes(currentEffort) ? currentEffort : model.defaultReasoningEffort;
  if (!efforts(model).includes(effort)) throw new Error("Model has no supported reasoning effort");
  if (props.onBeforeSelectModel?.(model.model) === false) {
    throw new Error("Codex requires confirmation before selecting this model");
  }
  await props.onSelectModel(model.model, effort);
  if (kind === "model") props.onSelectModelOption?.();
  // Wait for React to commit before accepting the next dial step.
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 20));
    const updated = picker();
    if (!updated) throw new Error("Codex composer changed during selection");
    if (updated.model === model.model && updated.reasoningEffort === effort) {
      return { ...snapshot(updated), changed: true };
    }
  }
  throw new Error("Codex did not confirm the model selection");
}

export function composerControlExpression(kind, direction) {
  return `(${composerControl.toString()})(${JSON.stringify(kind)}, ${JSON.stringify(direction)})`;
}
