import { createRequire } from "node:module";
import { join } from "node:path";

const SW_MAXIMIZE = 3;
const FLASHW_TRAY = 0x00000002;
const FLASHW_TIMERNOFG = 0x0000000C;
const cachedWindows = new Map();
let windowsApiPromise = null;

function sameWindow(left, right) {
  return left != null && right != null && String(left) === String(right);
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
  const bringWindowToTop = user32.func("bool __stdcall BringWindowToTop(HWND hwnd)");
  const setFocus = user32.func("HWND __stdcall SetFocus(HWND hwnd)");
  const attachThreadInput = user32.func(
    "bool __stdcall AttachThreadInput(uint32_t sourceThreadId, uint32_t targetThreadId, bool attach)"
  );
  const getCurrentThreadId = kernel32.func("uint32_t __stdcall GetCurrentThreadId()");
  const flashWindowEx = user32.func("bool __stdcall FlashWindowEx(_Inout_ FLASHWINFO *info)");

  function identityForWindow(hwnd) {
    const processId = [0];
    const threadId = getWindowThreadProcessId(hwnd, processId);
    return {
      processId: Number(processId[0]) || 0,
      threadId: Number(threadId) || 0
    };
  }

  return {
    isWindow,
    isZoomed,
    getForegroundWindow,
    processIdForWindow(hwnd) {
      return identityForWindow(hwnd).processId;
    },
    findWindowForProcess(processId) {
      let previous = null;
      for (let index = 0; index < 4096; index += 1) {
        const hwnd = findWindowEx(null, previous, null, null);
        if (hwnd == null) return null;
        previous = hwnd;
        if (
          identityForWindow(hwnd).processId === processId &&
          isWindow(hwnd) &&
          isWindowVisible(hwnd) &&
          getWindowTextLength(hwnd) > 0
        ) {
          return hwnd;
        }
      }
      throw new Error("Windows window enumeration exceeded its safety bound");
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
        if (
          threadId > 0 &&
          threadId !== currentThreadId &&
          !attached.includes(threadId) &&
          attachThreadInput(currentThreadId, threadId, true)
        ) {
          attached.push(threadId);
        }
      };
      try {
        attach(foregroundThreadId);
        attach(targetThreadId);
        bringWindowToTop(hwnd);
        setForegroundWindow(hwnd);
        setFocus(hwnd);
      } finally {
        for (const threadId of attached.reverse()) {
          attachThreadInput(currentThreadId, threadId, false);
        }
      }
    },
    flash(hwnd) {
      const info = {
        cbSize: koffi.sizeof(FLASHWINFO),
        hwnd,
        dwFlags: FLASHW_TRAY | FLASHW_TIMERNOFG,
        uCount: 3,
        dwTimeout: 0
      };
      flashWindowEx(info);
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
  if (
    hwnd != null &&
    api.isWindow(hwnd) &&
    api.processIdForWindow(hwnd) === processId
  ) {
    return hwnd;
  }
  cachedWindows.delete(processId);
  return null;
}

export async function activateWindowsProcess(processId, {
  api,
  wait = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds))
} = {}) {
  if (!Number.isInteger(processId) || processId <= 0) {
    throw new Error("The connected Codex process identity is unavailable");
  }
  const native = api ?? await defaultWindowsApi();
  const hwnd = validCachedWindow(native, processId) ?? native.findWindowForProcess(processId);
  if (hwnd == null) throw new Error("The connected Codex Desktop window was not found");
  cachedWindows.set(processId, hwnd);

  const alreadyForeground = sameWindow(native.getForegroundWindow(), hwnd);
  const alreadyMaximized = Boolean(native.isZoomed(hwnd));
  if (!alreadyMaximized && !native.maximize(hwnd)) {
    throw new Error("Windows did not accept the Codex maximize request");
  }
  if (!alreadyForeground) native.foreground(hwnd);
  if (!alreadyMaximized) await wait(20);

  let foreground = sameWindow(native.getForegroundWindow(), hwnd);
  if (!foreground && !alreadyForeground) {
    await wait(25);
    foreground = sameWindow(native.getForegroundWindow(), hwnd);
  }
  if (!foreground && !alreadyForeground && typeof native.forceForeground === "function") {
    native.forceForeground(hwnd);
    await wait(25);
    foreground = sameWindow(native.getForegroundWindow(), hwnd);
  }
  if (!foreground) {
    try { native.flash(hwnd); } catch {}
    throw new Error("Windows did not allow Codex Desktop to receive focus");
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
