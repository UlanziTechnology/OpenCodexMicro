import { createRequire } from "node:module";
import { join } from "node:path";

const SW_MAXIMIZE = 3;
const FLASHW_TRAY = 0x00000002;
const INPUT_KEYBOARD = 1;
const KEYEVENTF_KEYUP = 0x0002;
const VK_SHIFT = 0x10;
const VK_CONTROL = 0x11;
const VK_MENU = 0x12;
const VK_LWIN = 0x5B;
const VK_RWIN = 0x5C;
const GW_OWNER = 4;
const MODIFIER_KEYS = [VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN];
const ERROR_ACCESS_DENIED = 5;
const FORCED_VERIFY_DELAYS_MS = [25, 75, 150];
const cachedWindows = new Map();
let windowsApiPromise = null;

function sameWindow(left, right) {
  return left != null && right != null && String(left) === String(right);
}

function emitDiagnostic(onDiagnostic, stage, fields = {}) {
  try { onDiagnostic?.(stage, fields); } catch {}
}

async function loadKoffi() {
  const nativeRoot = process.env.CODEX_BRIDGE_NATIVE_ROOT;
  if (nativeRoot) {
    return createRequire(join(nativeRoot, "bridge-native.cjs"))(
      join(nativeRoot, "node_modules", "koffi", "index.cjs")
    );
  }
  return (await import("koffi")).default;
}

async function createWindowsApi() {
  if (process.platform !== "win32") {
    throw new Error("Native Codex window activation is available on Windows only");
  }
  const koffi = await loadKoffi();
  const user32 = koffi.load("user32.dll");
  const kernel32 = koffi.load("kernel32.dll");
  const HANDLE = koffi.pointer("HANDLE", koffi.opaque());
  koffi.alias("HWND", HANDLE);
  const FLASHWINFO = koffi.struct("FLASHWINFO", {
    cbSize: "uint32_t",
    hwnd: "HWND",
    dwFlags: "uint32_t",
    uCount: "uint32_t",
    dwTimeout: "uint32_t"
  });
  const KEYBDINPUT = koffi.struct("KEYBDINPUT", {
    wVk: "uint16_t",
    wScan: "uint16_t",
    dwFlags: "uint32_t",
    time: "uint32_t",
    dwExtraInfo: "uintptr_t"
  });
  const MOUSEINPUT = koffi.struct("MOUSEINPUT", {
    dx: "long",
    dy: "long",
    mouseData: "uint32_t",
    dwFlags: "uint32_t",
    time: "uint32_t",
    dwExtraInfo: "uintptr_t"
  });
  const HARDWAREINPUT = koffi.struct("HARDWAREINPUT", {
    uMsg: "uint32_t",
    wParamL: "uint16_t",
    wParamH: "uint16_t"
  });
  const INPUT = koffi.struct("INPUT", {
    type: "uint32_t",
    u: koffi.union({ mi: MOUSEINPUT, ki: KEYBDINPUT, hi: HARDWAREINPUT })
  });
  const findWindowEx = user32.func(
    "HWND __stdcall FindWindowExW(HWND parent, HWND childAfter, const char16_t *className, const char16_t *windowName)"
  );
  const getWindowThreadProcessId = user32.func(
    "uint32_t __stdcall GetWindowThreadProcessId(HWND hwnd, _Out_ uint32_t *processId)"
  );
  const isWindow = user32.func("bool __stdcall IsWindow(HWND hwnd)");
  const isWindowVisible = user32.func("bool __stdcall IsWindowVisible(HWND hwnd)");
  const getWindowTextLength = user32.func("int __stdcall GetWindowTextLengthW(HWND hwnd)");
  const isZoomed = user32.func("bool __stdcall IsZoomed(HWND hwnd)");
  const showWindowAsync = user32.func("bool __stdcall ShowWindowAsync(HWND hwnd, int command)");
  const setForegroundWindow = user32.func("bool __stdcall SetForegroundWindow(HWND hwnd)");
  const getForegroundWindow = user32.func("HWND __stdcall GetForegroundWindow()");
  const getWindow = user32.func("HWND __stdcall GetWindow(HWND hwnd, uint32_t command)");
  const bringWindowToTop = user32.func("bool __stdcall BringWindowToTop(HWND hwnd)");
  const setFocus = user32.func("HWND __stdcall SetFocus(HWND hwnd)");
  const attachThreadInput = user32.func(
    "bool __stdcall AttachThreadInput(uint32_t sourceThreadId, uint32_t targetThreadId, bool attach)"
  );
  const flashWindowEx = user32.func("bool __stdcall FlashWindowEx(_In_ FLASHWINFO *info)");
  const getAsyncKeyState = user32.func("int16_t __stdcall GetAsyncKeyState(int virtualKey)");
  const sendInput = user32.func(
    "uint32_t __stdcall SendInput(uint32_t inputCount, INPUT *inputs, int inputSize)"
  );
  const getCurrentThreadId = kernel32.func("uint32_t __stdcall GetCurrentThreadId()");
  const getLastError = kernel32.func("uint32_t __stdcall GetLastError()");
  const setLastError = kernel32.func("void __stdcall SetLastError(uint32_t errorCode)");

  const keyboardEvent = (virtualKey, pressed) => ({
    type: INPUT_KEYBOARD,
    u: {
      ki: {
        wVk: virtualKey,
        wScan: 0,
        dwFlags: pressed ? 0 : KEYEVENTF_KEYUP,
        time: 0,
        dwExtraInfo: 0
      }
    }
  });

  function identityForWindow(hwnd) {
    const processId = [0];
    const threadId = getWindowThreadProcessId(hwnd, processId);
    return {
      processId: Number(processId[0]) || 0,
      threadId: Number(threadId) || 0
    };
  }

  function isWindowCandidate(hwnd, processId) {
    return (
      hwnd != null &&
      identityForWindow(hwnd).processId === processId &&
      isWindow(hwnd) &&
      isWindowVisible(hwnd) &&
      getWindowTextLength(hwnd) > 0
    );
  }

  function isPrimaryWindowCandidate(hwnd, processId) {
    return isWindowCandidate(hwnd, processId) && getWindow(hwnd, GW_OWNER) == null;
  }

  function findWindowsForProcess(processId) {
    const primary = [];
    const displayedFallbacks = [];
    let previous = null;
    for (let index = 0; index < 4096; index += 1) {
      const hwnd = findWindowEx(null, previous, null, null);
      if (hwnd == null) return [...primary, ...displayedFallbacks];
      previous = hwnd;
      if (!isWindowCandidate(hwnd, processId)) continue;
      (getWindow(hwnd, GW_OWNER) == null ? primary : displayedFallbacks).push(hwnd);
    }
    throw new Error("Windows window enumeration exceeded its safety bound");
  }

  return {
    isWindow,
    isWindowCandidate,
    isPrimaryWindowCandidate,
    isZoomed,
    getForegroundWindow,
    processIdForWindow(hwnd) {
      return identityForWindow(hwnd).processId;
    },
    findWindowsForProcess,
    findWindowForProcess(processId) {
      return findWindowsForProcess(processId)[0] ?? null;
    },
    maximize(hwnd) {
      return showWindowAsync(hwnd, SW_MAXIMIZE);
    },
    foreground(hwnd) {
      return setForegroundWindow(hwnd);
    },
    forceForeground(hwnd) {
      const currentThreadId = Number(getCurrentThreadId()) || 0;
      const foregroundWindow = getForegroundWindow();
      const foregroundThreadId = foregroundWindow == null
        ? 0
        : identityForWindow(foregroundWindow).threadId;
      const targetThreadId = identityForWindow(hwnd).threadId;
      const attached = [];
      const attach = (threadId) => {
        if (threadId <= 0 || threadId === currentThreadId || attached.includes(threadId)) {
          return { outcome: "skipped", errorCode: 0 };
        }
        setLastError(0);
        const accepted = Boolean(attachThreadInput(currentThreadId, threadId, true));
        if (accepted) attached.push(threadId);
        return {
          outcome: accepted ? "succeeded" : "failed",
          errorCode: accepted ? 0 : Number(getLastError()) || 0
        };
      };
      const result = {
        foregroundAttach: "skipped",
        foregroundAttachErrorCode: 0,
        targetAttach: "skipped",
        targetAttachErrorCode: 0,
        bringToTopAccepted: false,
        setForegroundAccepted: false,
        setFocusReturnedWindow: false,
        detachAccepted: true
      };
      try {
        const foregroundAttachment = attach(foregroundThreadId);
        result.foregroundAttach = foregroundAttachment.outcome;
        result.foregroundAttachErrorCode = foregroundAttachment.errorCode;
        const targetAttachment = attach(targetThreadId);
        result.targetAttach = targetAttachment.outcome;
        result.targetAttachErrorCode = targetAttachment.errorCode;
        result.bringToTopAccepted = Boolean(bringWindowToTop(hwnd));
        result.setForegroundAccepted = Boolean(setForegroundWindow(hwnd));
        result.setFocusReturnedWindow = setFocus(hwnd) != null;
      } finally {
        for (const threadId of attached.reverse()) {
          result.detachAccepted = Boolean(
            attachThreadInput(currentThreadId, threadId, false)
          ) && result.detachAccepted;
        }
      }
      return result;
    },
    aggressiveForeground(hwnd) {
      const modifierStateClear = MODIFIER_KEYS.every(
        virtualKey => (Number(getAsyncKeyState(virtualKey)) & 0x8000) === 0
      );
      const result = {
        modifierStateClear,
        inputEventsInserted: 0,
        inputErrorCode: 0,
        releaseAccepted: true,
        setForegroundAccepted: false
      };
      if (!modifierStateClear) return result;

      const events = [keyboardEvent(VK_MENU, true), keyboardEvent(VK_MENU, false)];
      setLastError(0);
      result.inputEventsInserted = Number(sendInput(events.length, events, koffi.sizeof(INPUT))) || 0;
      if (result.inputEventsInserted !== events.length) {
        result.inputErrorCode = Number(getLastError()) || 0;
        if (result.inputEventsInserted === 1) {
          result.releaseAccepted = sendInput(
            1,
            [keyboardEvent(VK_MENU, false)],
            koffi.sizeof(INPUT)
          ) === 1;
        }
        return result;
      }
      result.setForegroundAccepted = Boolean(setForegroundWindow(hwnd));
      return result;
    },
    flash(hwnd) {
      const wasActiveBeforeRequest = Boolean(flashWindowEx({
        cbSize: koffi.sizeof(FLASHWINFO),
        hwnd,
        dwFlags: FLASHW_TRAY,
        uCount: 3,
        dwTimeout: 0
      }));
      return { requested: true, wasActiveBeforeRequest };
    }
  };
}

async function defaultWindowsApi() {
  if (!windowsApiPromise) windowsApiPromise = createWindowsApi();
  try {
    return await windowsApiPromise;
  } catch (error) {
    windowsApiPromise = null;
    throw error;
  }
}

export async function initializeWindowsFocusRuntime() {
  await defaultWindowsApi();
  return true;
}

function validCachedWindow(api, processId) {
  const hwnd = cachedWindows.get(processId);
  const candidateValid = hwnd != null && typeof api.isWindowCandidate === "function"
    ? api.isWindowCandidate(hwnd, processId)
    : (
        hwnd != null &&
        api.isWindow(hwnd) &&
        api.processIdForWindow(hwnd) === processId
      );
  if (
    candidateValid
  ) {
    return hwnd;
  }
  cachedWindows.delete(processId);
  return null;
}

async function verifyForegroundWithDelays(native, hwnd, wait, delays, onDiagnostic, stage) {
  for (let index = 0; index < delays.length; index += 1) {
    await wait(delays[index]);
    const matchesTarget = sameWindow(native.getForegroundWindow(), hwnd);
    emitDiagnostic(onDiagnostic, stage, {
      outcome: "observed",
      attempts: index + 1,
      matchesTarget
    });
    if (matchesTarget) return true;
  }
  return false;
}

export async function activateWindowsProcess(processId, {
  api,
  wait = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds)),
  onDiagnostic = null,
  forceFocus = false
} = {}) {
  if (!Number.isInteger(processId) || processId <= 0) {
    throw new Error("The connected Codex process identity is unavailable");
  }
  const native = api ?? await defaultWindowsApi();
  const cacheHit = cachedWindows.has(processId);
  const cachedWindow = validCachedWindow(native, processId);
  const cacheValid = cachedWindow != null;
  let hwnd = cachedWindow;
  let candidateCount = cacheValid ? 1 : 0;
  try {
    if (hwnd == null) {
      const candidates = typeof native.findWindowsForProcess === "function"
        ? native.findWindowsForProcess(processId)
        : [native.findWindowForProcess(processId)].filter(candidate => candidate != null);
      candidateCount = candidates.length;
      hwnd = candidates[0] ?? null;
    }
  } catch (error) {
    emitDiagnostic(onDiagnostic, "target-selection", {
      outcome: "observed",
      cacheHit,
      cacheValid,
      candidateCount,
      source: cacheValid ? "cache" : "discovery",
      targetFound: false
    });
    throw error;
  }
  emitDiagnostic(onDiagnostic, "target-selection", {
    outcome: "observed",
    cacheHit,
    cacheValid,
    candidateCount,
    primaryCandidate: hwnd != null && typeof native.isPrimaryWindowCandidate === "function"
      ? native.isPrimaryWindowCandidate(hwnd, processId)
      : true,
    source: cacheValid ? "cache" : "discovery",
    targetFound: hwnd != null
  });
  if (hwnd == null) throw new Error("The connected Codex Desktop window was not found");
  if (
    typeof native.isPrimaryWindowCandidate !== "function" ||
    native.isPrimaryWindowCandidate(hwnd, processId)
  ) {
    cachedWindows.set(processId, hwnd);
  } else {
    cachedWindows.delete(processId);
  }

  const alreadyForeground = sameWindow(native.getForegroundWindow(), hwnd);
  const alreadyMaximized = Boolean(native.isZoomed(hwnd));
  const maximizeAccepted = alreadyMaximized ? null : Boolean(native.maximize(hwnd));
  emitDiagnostic(onDiagnostic, "maximize", {
    outcome: alreadyMaximized ? "skipped" : "observed",
    alreadyMaximized,
    ...(maximizeAccepted == null ? {} : { accepted: maximizeAccepted })
  });
  if (maximizeAccepted === false) {
    throw new Error("Windows did not accept the Codex maximize request");
  }
  if (alreadyForeground) {
    emitDiagnostic(onDiagnostic, "initial-foreground", {
      outcome: "skipped",
      alreadyForeground
    });
  } else {
    emitDiagnostic(onDiagnostic, "initial-foreground", {
      outcome: "observed",
      alreadyForeground,
      accepted: Boolean(native.foreground(hwnd))
    });
  }
  if (!alreadyMaximized) await wait(20);

  let foreground = sameWindow(native.getForegroundWindow(), hwnd);
  emitDiagnostic(onDiagnostic, "verify-foreground-immediate", {
    outcome: "observed",
    matchesTarget: foreground
  });
  if (!foreground && !alreadyForeground) {
    await wait(25);
    foreground = sameWindow(native.getForegroundWindow(), hwnd);
    emitDiagnostic(onDiagnostic, "verify-foreground-delayed", {
      outcome: "observed",
      matchesTarget: foreground
    });
  }
  let automaticAggressiveFallback = false;
  if (!foreground && !alreadyForeground && typeof native.forceForeground === "function") {
    let result;
    try {
      result = native.forceForeground(hwnd) || {};
      const foregroundAttachErrorCode = Number(result.foregroundAttachErrorCode) || 0;
      const targetAttachErrorCode = Number(result.targetAttachErrorCode) || 0;
      automaticAggressiveFallback =
        foregroundAttachErrorCode === ERROR_ACCESS_DENIED ||
        targetAttachErrorCode === ERROR_ACCESS_DENIED;
      emitDiagnostic(onDiagnostic, "force-foreground", {
        outcome: "observed",
        foregroundAttach: result.foregroundAttach || "unknown",
        foregroundAttachErrorCode,
        targetAttach: result.targetAttach || "unknown",
        targetAttachErrorCode,
        bringToTopAccepted: Boolean(result.bringToTopAccepted),
        setForegroundAccepted: Boolean(result.setForegroundAccepted),
        setFocusReturnedWindow: Boolean(result.setFocusReturnedWindow),
        detachAccepted: result.detachAccepted !== false
      });
    } catch (error) {
      emitDiagnostic(onDiagnostic, "force-foreground", { outcome: "failed" });
      throw error;
    }
    foreground = await verifyForegroundWithDelays(
      native,
      hwnd,
      wait,
      automaticAggressiveFallback ? [FORCED_VERIFY_DELAYS_MS[0]] : FORCED_VERIFY_DELAYS_MS,
      onDiagnostic,
      "verify-foreground-forced"
    );
  }

  if (
    !foreground &&
    !alreadyForeground &&
    (forceFocus || automaticAggressiveFallback) &&
    typeof native.aggressiveForeground === "function"
  ) {
    try {
      const result = native.aggressiveForeground(hwnd) || {};
      emitDiagnostic(onDiagnostic, "aggressive-foreground", {
        outcome: "observed",
        automatic: automaticAggressiveFallback,
        forceFocus: Boolean(forceFocus),
        modifierStateClear: Boolean(result.modifierStateClear),
        inputEventsInserted: Number(result.inputEventsInserted) || 0,
        inputErrorCode: Number(result.inputErrorCode) || 0,
        releaseAccepted: result.releaseAccepted !== false,
        setForegroundAccepted: Boolean(result.setForegroundAccepted)
      });
      if (Number(result.inputEventsInserted) > 0) {
        foreground = await verifyForegroundWithDelays(
          native,
          hwnd,
          wait,
          FORCED_VERIFY_DELAYS_MS,
          onDiagnostic,
          "verify-foreground-aggressive"
        );
      }
    } catch {
      emitDiagnostic(onDiagnostic, "aggressive-foreground", {
        outcome: "failed",
        automatic: automaticAggressiveFallback,
        forceFocus: Boolean(forceFocus)
      });
    }
  }
  if (!foreground) {
    let attentionRequested = false;
    let wasActiveBeforeAttention = null;
    if (typeof native.flash === "function") {
      try {
        const result = native.flash(hwnd);
        attentionRequested = true;
        wasActiveBeforeAttention = typeof result === "object" && result != null
          ? Boolean(result.wasActiveBeforeRequest)
          : Boolean(result);
      } catch {}
    }
    emitDiagnostic(onDiagnostic, "final-attention", {
      outcome: "observed",
      attentionRequested,
      ...(wasActiveBeforeAttention == null ? {} : { wasActiveBeforeAttention })
    });
    emitDiagnostic(onDiagnostic, "final-denial", {
      outcome: "observed",
      matchesTarget: false,
      attentionRequested
    });
    const error = new Error("Windows did not allow Codex Desktop to receive focus");
    error.attentionRequested = attentionRequested;
    throw error;
  }
  return {
    processId,
    alreadyForeground,
    alreadyMaximized,
    maximized: alreadyMaximized || Boolean(native.isZoomed(hwnd))
  };
}

export function clearWindowsFocusCache() {
  cachedWindows.clear();
}
