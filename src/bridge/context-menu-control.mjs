/** @typedef {'up'|'down'|'select'|'close'} ContextMenuAction */

/**
 * Operate only the active composer's + / @ suggestions. DOM identifiers and
 * keyboard events stay at this renderer boundary; no translated labels or
 * text insertion are needed to open the menu.
 * @param {ContextMenuAction} action
 * @returns {Promise<{open: boolean, handled: boolean}>}
 */
export async function contextMenuControl(action) {
  if (!["up", "down", "select", "close"].includes(action)) {
    throw new Error("Invalid context menu action");
  }
  const visible = element => element?.isConnected && element.getClientRects().length > 0 &&
    !element.closest('[data-app-shell-active-page="false"],[hidden],[inert],[aria-hidden="true"]');
  const triggers = [...document.querySelectorAll(
    '[data-codex-composer-root] [data-composer-navigation-target="add-context"][aria-expanded]'
  )].filter(visible);
  const trigger = triggers.find(element => element.getAttribute("aria-expanded") === "true") ??
    triggers.find(element => element.closest('[data-codex-composer-root]').contains(document.activeElement)) ??
    triggers[0];
  const open = () => visible(trigger) && trigger.getAttribute("aria-expanded") === "true";
  // Confirm/cancel on a closed menu must not focus, open, or send a key.
  if (["select", "close"].includes(action) && !open()) return { open: false, handled: false };
  if (!trigger || trigger.matches(':disabled,[aria-disabled="true"],[data-disabled]')) {
    throw new Error("Codex context menu is not available");
  }
  const menu = () => open() && [...document.querySelectorAll(
    '[data-composer-overlay-floating-ui] [data-mention-list-scroll-area]'
  )].some(visible);
  if (!open()) {
    trigger.click();
    // First detent opens the menu without skipping its initially selected item.
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 20));
      if (!visible(trigger)) break;
      if (menu()) return { open: true, handled: true };
    }
    throw new Error("Codex did not open the context menu");
  }
  if (!menu()) return { open: Boolean(open()), handled: false };
  const key = { up: "ArrowUp", down: "ArrowDown", select: "Enter", close: "Escape" }[action];
  const event = new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true });
  if (action === "close") {
    // Escape belongs to the editor keymap; bubbling also reaches dismissal
    // layers when enabled. Neither window nor the + button reaches that keymap.
    const editor = trigger.closest('[data-codex-composer-root]').querySelector('[data-codex-composer]');
    if (!visible(editor)) throw new Error("Codex context menu editor is not available");
    editor.dispatchEvent(event);
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 20));
      if (!open()) return { open: false, handled: true };
    }
    throw new Error("Codex did not close the context menu");
  }
  window.dispatchEvent(event);
  // Commit the highlighted row before the next queued detent or press.
  await new Promise(resolve => setTimeout(resolve, 20));
  return { open: Boolean(open()), handled: event.defaultPrevented };
}

/** @param {ContextMenuAction} action @returns {string} */
export function contextMenuControlExpression(action) {
  return `(${contextMenuControl.toString()})(${JSON.stringify(action)})`;
}
