/**
 * @typedef {{kind:'read'} | {kind:'policy', direction:'left'|'right', contextKey:string} |
 * {kind:'approval', decision:'once'|'session'|'deny', contextKey:string, requestKey:string} |
 * {kind:'confirm'|'cancel', contextKey:string, confirmationKey:string}} PermissionCommand
 * @typedef {{id:string, label:string, enabled:boolean}} PermissionOption
 * @typedef {{contextKey:string|null, mode:'policy'|'approval'|'confirmation'|'unavailable', policy:PermissionOption|null,
 * policies:PermissionOption[], requestKey:string|null, options:PermissionOption[], confirmationRequired?:boolean, confirmationKey?:string}} PermissionState
 */

/**
 * Renderer boundary: use the active composer's native permission options and
 * approval callbacks, never global approve hotkeys or translated button text.
 * @param {PermissionCommand} command
 * @returns {Promise<PermissionState>}
 */
export async function permissionControl(command = { kind: 'read' }) {
  if (!command || !['read', 'policy', 'approval', 'confirm', 'cancel'].includes(command.kind) ||
      (command.kind === 'policy' && !['left', 'right'].includes(command.direction)) ||
      (command.kind === 'approval' && !['once', 'session', 'deny'].includes(command.decision))) {
    throw new Error('Invalid permission command');
  }
  const visible = element => element?.isConnected && element.getClientRects().length > 0 &&
    !element.closest('[data-app-shell-active-page="false"],[hidden],[inert],[aria-hidden="true"]');
  const ancestors = element => {
    const key = element && Object.getOwnPropertyNames(element).find(key => key.startsWith('__reactFiber$'));
    let fiber = element?.[key], root = fiber;
    while (root?.return) root = root.return;
    if (root?.stateNode?.current && root.stateNode.current !== root) fiber = fiber?.alternate;
    const props = [];
    for (let depth = 0; fiber && depth < 80; depth++, fiber = fiber.return) {
      if (fiber.memoizedProps) props.push(fiber.memoizedProps);
    }
    return props;
  };
  const normalize = value => String(value ?? '').replace(/^local:/, '');
  const identity = props => props.find(p => typeof p.conversationId === 'string' && p.conversationId)?.conversationId;
  const roots = [...document.querySelectorAll('[data-codex-composer-root]')].filter(visible);
  const active = document.querySelector('[data-app-action-sidebar-thread-active="true"],[data-app-action-sidebar-thread-id][aria-current="page"]');
  const activeId = normalize(active?.getAttribute('data-app-action-sidebar-thread-id'));
  const confirmationSymbol = Symbol.for('codex-micro-full-access-confirmation');
  const pending = globalThis[confirmationSymbol];
  const hasConfirmLabel = (value, depth = 0) => {
    if (!value || depth > 8) return false;
    if (Array.isArray(value)) return value.some(item => hasConfirmLabel(item, depth + 1));
    return value.props?.id === 'composer.mode.agentMode.fullAccessConfirm.turnOnButton' ||
      hasConfirmLabel(value.props?.children, depth + 1);
  };
  // A modal can hide/inert the composer. Resolve only the exact native dialog
  // armed by this encoder's preceding FULL selection, before filtering roots.
  if (pending) {
    if ((!pending.button && Date.now() - pending.createdAt > 2000) || !pending.composer.isConnected ||
        normalize(identity(ancestors(pending.composer))) !== normalize(pending.conversationId) ||
        (activeId && pending.conversationId && activeId !== normalize(pending.conversationId))) {
      delete globalThis[confirmationSymbol];
    } else {
      const matches = [...document.querySelectorAll('[role="dialog"] button[type="submit"],[role="alertdialog"] button[type="submit"]')]
        .filter(button => visible(button) && !button.matches(':disabled,[aria-disabled="true"]'))
        .filter(button => {
          const props = ancestors(button);
          return props.some(p => hasConfirmLabel(p.children)) && props.some(p =>
            Object.hasOwn(p, 'conversationId') && normalize(p.conversationId) === normalize(pending.conversationId) &&
            typeof p.onConfirm === 'function' && typeof p.onClose === 'function');
        });
      if (matches.length === 1 && (!pending.button || pending.button === matches[0])) {
        pending.button = matches[0];
        const state = { contextKey: pending.contextKey, mode: 'confirmation', policy: null,
          policies: [], requestKey: null, options: [], confirmationRequired: true, confirmationKey: pending.key };
        if (command.kind === 'read') return state;
        if (!['confirm', 'cancel'].includes(command.kind) || command.contextKey !== pending.contextKey || command.confirmationKey !== pending.key) {
          throw new Error('Review the Full access confirmation before pressing');
        }
        delete globalThis[confirmationSymbol];
        if (command.kind === 'cancel') {
          // Native Cancel calls this exact dialog's onClose; it never applies FULL.
          const owner = ancestors(pending.button).find(p => Object.hasOwn(p, 'conversationId') &&
            normalize(p.conversationId) === normalize(pending.conversationId) &&
            typeof p.onConfirm === 'function' && typeof p.onClose === 'function');
          owner.onClose();
        } else pending.button.click();
        await new Promise(resolve => setTimeout(resolve, 25));
        return permissionControl({ kind: 'read' });
      }
      if (pending.button || matches.length > 1) delete globalThis[confirmationSymbol];
    }
  }
  if (['confirm', 'cancel'].includes(command.kind)) throw new Error('Full access confirmation expired or changed');
  const focused = document.activeElement?.closest('[data-codex-composer-root]');
  const composer = roots.includes(focused) ? focused : roots.length === 1 ? roots[0] :
    roots.find(root => normalize(identity(ancestors(root))) === activeId && activeId);
  const composerProps = ancestors(composer);
  const conversationId = identity(composerProps) ??
    composer?.closest('[data-above-composer-conversation-id]')?.getAttribute('data-above-composer-conversation-id');
  const hostId = composerProps.find(p => typeof p.hostId === 'string')?.hostId ?? 'local';
  // New-chat drafts have no conversation ID; use their mounted composer identity.
  const scopeKey = Symbol.for('codex-micro-permission-scopes');
  const scopes = globalThis[scopeKey] ??= { roots: new WeakMap(), next: 0 };
  if (composer && !scopes.roots.has(composer)) scopes.roots.set(composer, ++scopes.next);
  const contextKey = composer ? JSON.stringify([hostId, conversationId ?? null, scopes.roots.get(composer)]) : null;
  const empty = { contextKey, mode: 'unavailable', policy: null, policies: [], requestKey: null, options: [] };
  if (!composer) {
    if (command.kind !== 'read') throw new Error('Active Codex composer is not available');
    return empty;
  }
  if (command.kind !== 'read' && command.contextKey !== contextKey) {
    throw new Error('Codex conversation changed; review the current selection');
  }
  const surfaces = [...document.querySelectorAll('[data-codex-approval-surface]')].filter(visible)
    .map(surface => {
      const props = ancestors(surface);
      const owner = props.find(p => p.conversationId != null &&
        (p.pendingRequest != null || p.item?.approvalRequestId != null || p.requestId != null));
      const actions = props.find(p => typeof p.actions?.onApprove === 'function' && typeof p.actions?.onDeny === 'function')?.actions;
      const request = owner?.pendingRequest ?? owner?.item;
      const id = request?.requestId ?? request?.approvalRequestId ?? owner?.requestId;
      return { surface, owner, actions, id, type: request?.type ?? request?.kind ?? 'approval' };
    });
  if (surfaces.some(item => !item.owner)) {
    if (command.kind !== 'read') throw new Error('Codex approval context is not available');
    return empty;
  }
  const approvals = surfaces.filter(item => conversationId && normalize(item.owner?.conversationId) === normalize(conversationId));
  if (approvals.length) {
    if (approvals.length !== 1 || !approvals[0].actions ||
        !['string', 'number'].includes(typeof approvals[0].id)) {
      if (command.kind !== 'read') throw new Error('Codex approval is ambiguous or unavailable');
      return empty;
    }
    const { surface, owner, actions, id, type } = approvals[0];
    if ([...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].some(dialog =>
      visible(dialog) && !dialog.contains(surface) && !surface.contains(dialog))) {
      if (command.kind !== 'read') throw new Error('Complete or cancel the Codex confirmation first');
      return empty;
    }
    const requestKey = JSON.stringify([owner.hostId ?? hostId, conversationId, type, id]);
    const enabled = !actions.disabled && !actions.isLoading;
    // Named scoped actions can mean "all sites" or "similar commands". Do not
    // present those broader/different grants as "this conversation".
    const session = actions.scopedApproveAction;
    const options = [
      { id: 'once', label: 'ONCE', enabled: enabled && !actions.approveDisabled },
      { id: 'session', label: 'CHAT', enabled: enabled && session?.label == null && typeof session?.onClick === 'function' },
      { id: 'deny', label: 'DENY', enabled }
    ];
    const state = { ...empty, mode: 'approval', requestKey, options };
    if (command.kind === 'read') return state;
    if (command.kind !== 'approval' || command.requestKey !== requestKey) {
      throw new Error('Codex approval changed; review the current request');
    }
    if (!options.find(option => option.id === command.decision)?.enabled) {
      throw new Error('This approval option is not available');
    }
    const sentKey = Symbol.for('codex-micro-permission-sent');
    const sent = globalThis[sentKey] ??= new Set();
    if (sent.has(requestKey)) throw new Error('Codex approval is already being submitted');
    sent.add(requestKey);
    if (sent.size > 128) sent.delete(sent.values().next().value);
    try {
      await ({ once: actions.onApprove, session: session?.onClick, deny: actions.onDeny })[command.decision]();
    } catch (error) {
      sent.delete(requestKey);
      throw error;
    }
    return state;
  }
  if (command.kind === 'approval') throw new Error('Codex approval is no longer available');
  const trigger = [...composer.querySelectorAll('[data-composer-navigation-target="permissions"]')].find(visible);
  if (!trigger) {
    if (command.kind !== 'read') throw new Error('Codex permissions picker is not available');
    return empty;
  }
  const picker = () => {
    const props = ancestors(trigger);
    let selected = JSON.stringify(props.find(p => p.selectedPermissionSelection != null)?.selectedPermissionSelection);
    const options = new Map();
    const labels = {
      'composer.permissionsDropdown.default.approvalOptionLabel': 'ASK',
      'composer.permissionsDropdown.guardianApproval.optionLabel': 'REVIEW',
      'composer.permissionsDropdown.fullAccess.optionLabel': 'FULL',
      'composer.permissionsDropdown.custom.optionLabel': 'CUSTOM',
      'workPreferences.composer.useWorkSettings': 'CUSTOM',
      'workPreferences.composer.fullAccess': 'FULL'
    };
    const labelOf = (value, depth = 0) => {
      if (!value || depth > 6) return null;
      if (Array.isArray(value)) return value.map(item => labelOf(item, depth + 1)).find(Boolean);
      return labels[value.props?.id] ?? labelOf(value.props?.children, depth + 1);
    };
    // Closed dropdowns retain their React children. Codex has both selection-
    // shaped options and native menu items; neither requires opening the menu.
    const visit = (value, depth = 0) => {
      if (!value || depth > 12) return;
      if (Array.isArray(value)) { value.forEach(item => visit(item, depth + 1)); return; }
      const p = value.props;
      if (!p) return;
      if (p.selection?.permissionSelection && typeof p.selectPermission === 'function') {
        const selection = p.selection.permissionSelection;
        const id = JSON.stringify(selection);
        const label = selection.kind === 'agent-mode' ?
          ({ auto: 'ASK', granular: 'ASK', 'read-only': 'ASK', 'guardian-approvals': 'REVIEW', 'full-access': 'FULL' })[selection.agentMode] :
          ({ custom: 'CUSTOM', profile: 'PROFILE', 'server-default': 'MANAGED' })[selection.kind];
        if (label) options.set(id, { id, label, enabled: p.selection.disabledReason == null && selection.kind !== 'server-default',
          select: () => p.selectPermission(selection) });
        selected ??= JSON.stringify(p.selectedPermissionSelection);
      } else if (typeof (p.onClick ?? p.onSelect) === 'function' &&
          ('LeftIcon' in p || 'rightIconAsset' in p || 'RightIcon' in p || typeof p.isActive === 'boolean')) {
        // Intl IDs are language-independent. Use the item's own callback so
        // Full access still opens Codex's confirmation instead of bypassing it.
        const label = labelOf(p.children) ?? (value.key != null && typeof p.children === 'string' ? 'PROFILE' : null);
        if (label) {
          const id = label === 'PROFILE' ? `profile:${value.key}` : `menu:${label}`;
          options.set(id, { id, label, enabled: !p.disabled,
            select: () => (p.onClick ?? p.onSelect)() });
          if (p.rightIconAsset != null || p.RightIcon != null || p.isActive === true) selected = id;
        }
      }
      visit(p.children, depth + 1);
    };
    const dropdown = props.find(p => p.triggerButton && p.children);
    if (dropdown) visit(dropdown.children);
    return { selected, options: [...options.values()] };
  };
  const snapshot = () => {
    const { selected, options } = picker();
    const clean = options.map(({ id, label, enabled }) => ({ id, label, enabled }));
    return { ...empty, mode: clean.length ? 'policy' : 'unavailable', policies: clean,
      policy: clean.find(option => option.id === selected) ?? null };
  };
  if (command.kind === 'read') return { ...snapshot(), confirmationRequired:
    [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].some(visible) };
  if (trigger.matches(':disabled,[aria-disabled="true"],[aria-busy="true"]')) {
    throw new Error('Codex permission selection is disabled');
  }
  // Do not rotate past a pending native security confirmation.
  if ([...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].some(visible)) {
    throw new Error('Complete or cancel the Codex confirmation first');
  }
  const { selected, options } = picker();
  const allowed = options.filter(option => option.enabled || option.id === selected);
  const index = allowed.findIndex(option => option.id === selected);
  if (index < 0) throw new Error('Current Codex permission policy is not available');
  const next = index + (command.direction === 'left' ? -1 : 1);
  if (next < 0 || next >= allowed.length) return snapshot();
  if (!allowed[next].enabled) throw new Error('Codex permission policy is not selectable');
  if (allowed[next].label === 'FULL') {
    globalThis[confirmationSymbol] = { contextKey, conversationId, composer,
      key: `${contextKey}:${Date.now()}:${++scopes.next}`, createdAt: Date.now(), button: null };
  }
  await allowed[next].select();
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 25));
    if (!composer.isConnected || identity(ancestors(composer)) !== identity(composerProps)) {
      throw new Error('Codex conversation changed during permission selection');
    }
    if ([...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].some(visible)) {
      return permissionControl({ kind: 'read' });
    }
    const state = snapshot();
    if (state.policy?.id === allowed[next].id) {
      delete globalThis[confirmationSymbol];
      return state;
    }
  }
  throw new Error('Codex did not confirm the permission selection');
}

/** @param {PermissionCommand} command @returns {string} */
export function permissionControlExpression(command) {
  return `(${permissionControl.toString()})(${JSON.stringify(command)})`;
}
