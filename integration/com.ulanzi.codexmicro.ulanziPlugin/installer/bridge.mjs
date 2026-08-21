import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../src/bridge/windows-focus.mjs
var windows_focus_exports = {};
__export(windows_focus_exports, {
  activateWindowsProcess: () => activateWindowsProcess,
  clearWindowsFocusCache: () => clearWindowsFocusCache,
  initializeWindowsFocusRuntime: () => initializeWindowsFocusRuntime
});
import { createRequire } from "node:module";
import { join } from "node:path";
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
        if (identityForWindow(hwnd).processId === processId && isWindow(hwnd) && isWindowVisible(hwnd) && getWindowTextLength(hwnd) > 0) {
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
      const foregroundThreadId = foregroundWindow == null ? 0 : identityForWindow(foregroundWindow).threadId;
      const targetThreadId = identityForWindow(hwnd).threadId;
      const attached = [];
      const attach = (threadId) => {
        if (threadId > 0 && threadId !== currentThreadId && !attached.includes(threadId) && attachThreadInput(currentThreadId, threadId, true)) {
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
async function initializeWindowsFocusRuntime() {
  await defaultWindowsApi();
  return true;
}
function validCachedWindow(api, processId) {
  const hwnd = cachedWindows.get(processId);
  if (hwnd != null && api.isWindow(hwnd) && api.processIdForWindow(hwnd) === processId) {
    return hwnd;
  }
  cachedWindows.delete(processId);
  return null;
}
async function activateWindowsProcess(processId, {
  api,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
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
    try {
      native.flash(hwnd);
    } catch {
    }
    throw new Error("Windows did not allow Codex Desktop to receive focus");
  }
  return {
    processId,
    alreadyForeground,
    alreadyMaximized,
    maximized: alreadyMaximized || Boolean(native.isZoomed(hwnd))
  };
}
function clearWindowsFocusCache() {
  cachedWindows.clear();
}
var SW_MAXIMIZE, FLASHW_TRAY, FLASHW_TIMERNOFG, cachedWindows, windowsApiPromise;
var init_windows_focus = __esm({
  "../../src/bridge/windows-focus.mjs"() {
    SW_MAXIMIZE = 3;
    FLASHW_TRAY = 2;
    FLASHW_TIMERNOFG = 12;
    cachedWindows = /* @__PURE__ */ new Map();
    windowsApiPromise = null;
  }
});

// ../../node_modules/ws/lib/constants.js
var require_constants = __commonJS({
  "../../node_modules/ws/lib/constants.js"(exports, module) {
    "use strict";
    var BINARY_TYPES = ["nodebuffer", "arraybuffer", "fragments"];
    var hasBlob = typeof Blob !== "undefined";
    if (hasBlob) BINARY_TYPES.push("blob");
    module.exports = {
      BINARY_TYPES,
      CLOSE_TIMEOUT: 3e4,
      EMPTY_BUFFER: Buffer.alloc(0),
      GUID: "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
      hasBlob,
      kForOnEventAttribute: Symbol("kIsForOnEventAttribute"),
      kListener: Symbol("kListener"),
      kStatusCode: Symbol("status-code"),
      kWebSocket: Symbol("websocket"),
      NOOP: () => {
      }
    };
  }
});

// ../../node_modules/ws/lib/buffer-util.js
var require_buffer_util = __commonJS({
  "../../node_modules/ws/lib/buffer-util.js"(exports, module) {
    "use strict";
    var { EMPTY_BUFFER } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    function concat(list, totalLength) {
      if (list.length === 0) return EMPTY_BUFFER;
      if (list.length === 1) return list[0];
      const target = Buffer.allocUnsafe(totalLength);
      let offset = 0;
      for (let i = 0; i < list.length; i++) {
        const buf = list[i];
        target.set(buf, offset);
        offset += buf.length;
      }
      if (offset < totalLength) {
        return new FastBuffer(target.buffer, target.byteOffset, offset);
      }
      return target;
    }
    function _mask(source, mask, output, offset, length) {
      for (let i = 0; i < length; i++) {
        output[offset + i] = source[i] ^ mask[i & 3];
      }
    }
    function _unmask(buffer, mask) {
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] ^= mask[i & 3];
      }
    }
    function toArrayBuffer(buf) {
      if (buf.length === buf.buffer.byteLength) {
        return buf.buffer;
      }
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
    }
    function toBuffer(data) {
      toBuffer.readOnly = true;
      if (Buffer.isBuffer(data)) return data;
      let buf;
      if (data instanceof ArrayBuffer) {
        buf = new FastBuffer(data);
      } else if (ArrayBuffer.isView(data)) {
        buf = new FastBuffer(data.buffer, data.byteOffset, data.byteLength);
      } else {
        buf = Buffer.from(data);
        toBuffer.readOnly = false;
      }
      return buf;
    }
    module.exports = {
      concat,
      mask: _mask,
      toArrayBuffer,
      toBuffer,
      unmask: _unmask
    };
    if (!process.env.WS_NO_BUFFER_UTIL) {
      try {
        const bufferUtil = __require("bufferutil");
        module.exports.mask = function(source, mask, output, offset, length) {
          if (length < 48) _mask(source, mask, output, offset, length);
          else bufferUtil.mask(source, mask, output, offset, length);
        };
        module.exports.unmask = function(buffer, mask) {
          if (buffer.length < 32) _unmask(buffer, mask);
          else bufferUtil.unmask(buffer, mask);
        };
      } catch (e) {
      }
    }
  }
});

// ../../node_modules/ws/lib/limiter.js
var require_limiter = __commonJS({
  "../../node_modules/ws/lib/limiter.js"(exports, module) {
    "use strict";
    var kDone = Symbol("kDone");
    var kRun = Symbol("kRun");
    var Limiter = class {
      /**
       * Creates a new `Limiter`.
       *
       * @param {Number} [concurrency=Infinity] The maximum number of jobs allowed
       *     to run concurrently
       */
      constructor(concurrency) {
        this[kDone] = () => {
          this.pending--;
          this[kRun]();
        };
        this.concurrency = concurrency || Infinity;
        this.jobs = [];
        this.pending = 0;
      }
      /**
       * Adds a job to the queue.
       *
       * @param {Function} job The job to run
       * @public
       */
      add(job) {
        this.jobs.push(job);
        this[kRun]();
      }
      /**
       * Removes a job from the queue and runs it if possible.
       *
       * @private
       */
      [kRun]() {
        if (this.pending === this.concurrency) return;
        if (this.jobs.length) {
          const job = this.jobs.shift();
          this.pending++;
          job(this[kDone]);
        }
      }
    };
    module.exports = Limiter;
  }
});

// ../../node_modules/ws/lib/permessage-deflate.js
var require_permessage_deflate = __commonJS({
  "../../node_modules/ws/lib/permessage-deflate.js"(exports, module) {
    "use strict";
    var zlib = __require("zlib");
    var bufferUtil = require_buffer_util();
    var Limiter = require_limiter();
    var { kStatusCode } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    var TRAILER = Buffer.from([0, 0, 255, 255]);
    var kPerMessageDeflate = Symbol("permessage-deflate");
    var kTotalLength = Symbol("total-length");
    var kCallback = Symbol("callback");
    var kBuffers = Symbol("buffers");
    var kError = Symbol("error");
    var zlibLimiter;
    var PerMessageDeflate2 = class {
      /**
       * Creates a PerMessageDeflate instance.
       *
       * @param {Object} [options] Configuration options
       * @param {(Boolean|Number)} [options.clientMaxWindowBits] Advertise support
       *     for, or request, a custom client window size
       * @param {Boolean} [options.clientNoContextTakeover=false] Advertise/
       *     acknowledge disabling of client context takeover
       * @param {Number} [options.concurrencyLimit=10] The number of concurrent
       *     calls to zlib
       * @param {Boolean} [options.isServer=false] Create the instance in either
       *     server or client mode
       * @param {Number} [options.maxPayload=0] The maximum allowed message length
       * @param {(Boolean|Number)} [options.serverMaxWindowBits] Request/confirm the
       *     use of a custom server window size
       * @param {Boolean} [options.serverNoContextTakeover=false] Request/accept
       *     disabling of server context takeover
       * @param {Number} [options.threshold=1024] Size (in bytes) below which
       *     messages should not be compressed if context takeover is disabled
       * @param {Object} [options.zlibDeflateOptions] Options to pass to zlib on
       *     deflate
       * @param {Object} [options.zlibInflateOptions] Options to pass to zlib on
       *     inflate
       */
      constructor(options) {
        this._options = options || {};
        this._threshold = this._options.threshold !== void 0 ? this._options.threshold : 1024;
        this._maxPayload = this._options.maxPayload | 0;
        this._isServer = !!this._options.isServer;
        this._deflate = null;
        this._inflate = null;
        this.params = null;
        if (!zlibLimiter) {
          const concurrency = this._options.concurrencyLimit !== void 0 ? this._options.concurrencyLimit : 10;
          zlibLimiter = new Limiter(concurrency);
        }
      }
      /**
       * @type {String}
       */
      static get extensionName() {
        return "permessage-deflate";
      }
      /**
       * Create an extension negotiation offer.
       *
       * @return {Object} Extension parameters
       * @public
       */
      offer() {
        const params = {};
        if (this._options.serverNoContextTakeover) {
          params.server_no_context_takeover = true;
        }
        if (this._options.clientNoContextTakeover) {
          params.client_no_context_takeover = true;
        }
        if (this._options.serverMaxWindowBits) {
          params.server_max_window_bits = this._options.serverMaxWindowBits;
        }
        if (this._options.clientMaxWindowBits) {
          params.client_max_window_bits = this._options.clientMaxWindowBits;
        } else if (this._options.clientMaxWindowBits == null) {
          params.client_max_window_bits = true;
        }
        return params;
      }
      /**
       * Accept an extension negotiation offer/response.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Object} Accepted configuration
       * @public
       */
      accept(configurations) {
        configurations = this.normalizeParams(configurations);
        this.params = this._isServer ? this.acceptAsServer(configurations) : this.acceptAsClient(configurations);
        return this.params;
      }
      /**
       * Releases all resources used by the extension.
       *
       * @public
       */
      cleanup() {
        if (this._inflate) {
          this._inflate.close();
          this._inflate = null;
        }
        if (this._deflate) {
          const callback = this._deflate[kCallback];
          this._deflate.close();
          this._deflate = null;
          if (callback) {
            callback(
              new Error(
                "The deflate stream was closed while data was being processed"
              )
            );
          }
        }
      }
      /**
       *  Accept an extension negotiation offer.
       *
       * @param {Array} offers The extension negotiation offers
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsServer(offers) {
        const opts = this._options;
        const accepted = offers.find((params) => {
          if (opts.serverNoContextTakeover === false && params.server_no_context_takeover || params.server_max_window_bits && (opts.serverMaxWindowBits === false || typeof opts.serverMaxWindowBits === "number" && opts.serverMaxWindowBits > params.server_max_window_bits) || typeof opts.clientMaxWindowBits === "number" && !params.client_max_window_bits) {
            return false;
          }
          return true;
        });
        if (!accepted) {
          throw new Error("None of the extension offers can be accepted");
        }
        if (opts.serverNoContextTakeover) {
          accepted.server_no_context_takeover = true;
        }
        if (opts.clientNoContextTakeover) {
          accepted.client_no_context_takeover = true;
        }
        if (typeof opts.serverMaxWindowBits === "number") {
          accepted.server_max_window_bits = opts.serverMaxWindowBits;
        }
        if (typeof opts.clientMaxWindowBits === "number") {
          accepted.client_max_window_bits = opts.clientMaxWindowBits;
        } else if (accepted.client_max_window_bits === true || opts.clientMaxWindowBits === false) {
          delete accepted.client_max_window_bits;
        }
        return accepted;
      }
      /**
       * Accept the extension negotiation response.
       *
       * @param {Array} response The extension negotiation response
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsClient(response) {
        const params = response[0];
        if (this._options.clientNoContextTakeover === false && params.client_no_context_takeover) {
          throw new Error('Unexpected parameter "client_no_context_takeover"');
        }
        if (!params.client_max_window_bits) {
          if (typeof this._options.clientMaxWindowBits === "number") {
            params.client_max_window_bits = this._options.clientMaxWindowBits;
          }
        } else if (this._options.clientMaxWindowBits === false || typeof this._options.clientMaxWindowBits === "number" && params.client_max_window_bits > this._options.clientMaxWindowBits) {
          throw new Error(
            'Unexpected or invalid parameter "client_max_window_bits"'
          );
        }
        return params;
      }
      /**
       * Normalize parameters.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Array} The offers/response with normalized parameters
       * @private
       */
      normalizeParams(configurations) {
        configurations.forEach((params) => {
          Object.keys(params).forEach((key) => {
            let value = params[key];
            if (value.length > 1) {
              throw new Error(`Parameter "${key}" must have only a single value`);
            }
            value = value[0];
            if (key === "client_max_window_bits") {
              if (value !== true) {
                const num = +value;
                if (!Number.isInteger(num) || num < 8 || num > 15) {
                  throw new TypeError(
                    `Invalid value for parameter "${key}": ${value}`
                  );
                }
                value = num;
              } else if (!this._isServer) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else if (key === "server_max_window_bits") {
              const num = +value;
              if (!Number.isInteger(num) || num < 8 || num > 15) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
              value = num;
            } else if (key === "client_no_context_takeover" || key === "server_no_context_takeover") {
              if (value !== true) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else {
              throw new Error(`Unknown parameter "${key}"`);
            }
            params[key] = value;
          });
        });
        return configurations;
      }
      /**
       * Decompress data. Concurrency limited.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      decompress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._decompress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Compress data. Concurrency limited.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      compress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._compress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Decompress data.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _decompress(data, fin, callback) {
        const endpoint = this._isServer ? "client" : "server";
        if (!this._inflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._inflate = zlib.createInflateRaw({
            ...this._options.zlibInflateOptions,
            windowBits
          });
          this._inflate[kPerMessageDeflate] = this;
          this._inflate[kTotalLength] = 0;
          this._inflate[kBuffers] = [];
          this._inflate.on("error", inflateOnError);
          this._inflate.on("data", inflateOnData);
        }
        this._inflate[kCallback] = callback;
        this._inflate.write(data);
        if (fin) this._inflate.write(TRAILER);
        this._inflate.flush(() => {
          const err = this._inflate[kError];
          if (err) {
            this._inflate.close();
            this._inflate = null;
            callback(err);
            return;
          }
          const data2 = bufferUtil.concat(
            this._inflate[kBuffers],
            this._inflate[kTotalLength]
          );
          if (this._inflate._readableState.endEmitted) {
            this._inflate.close();
            this._inflate = null;
          } else {
            this._inflate[kTotalLength] = 0;
            this._inflate[kBuffers] = [];
            if (fin && this.params[`${endpoint}_no_context_takeover`]) {
              this._inflate.reset();
            }
          }
          callback(null, data2);
        });
      }
      /**
       * Compress data.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _compress(data, fin, callback) {
        const endpoint = this._isServer ? "server" : "client";
        if (!this._deflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._deflate = zlib.createDeflateRaw({
            ...this._options.zlibDeflateOptions,
            windowBits
          });
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          this._deflate.on("data", deflateOnData);
        }
        this._deflate[kCallback] = callback;
        this._deflate.write(data);
        this._deflate.flush(zlib.Z_SYNC_FLUSH, () => {
          if (!this._deflate) {
            return;
          }
          let data2 = bufferUtil.concat(
            this._deflate[kBuffers],
            this._deflate[kTotalLength]
          );
          if (fin) {
            data2 = new FastBuffer(data2.buffer, data2.byteOffset, data2.length - 4);
          }
          this._deflate[kCallback] = null;
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          if (fin && this.params[`${endpoint}_no_context_takeover`]) {
            this._deflate.reset();
          }
          callback(null, data2);
        });
      }
    };
    module.exports = PerMessageDeflate2;
    function deflateOnData(chunk) {
      this[kBuffers].push(chunk);
      this[kTotalLength] += chunk.length;
    }
    function inflateOnData(chunk) {
      this[kTotalLength] += chunk.length;
      if (this[kPerMessageDeflate]._maxPayload < 1 || this[kTotalLength] <= this[kPerMessageDeflate]._maxPayload) {
        this[kBuffers].push(chunk);
        return;
      }
      this[kError] = new RangeError("Max payload size exceeded");
      this[kError].code = "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH";
      this[kError][kStatusCode] = 1009;
      this.removeListener("data", inflateOnData);
      this.reset();
    }
    function inflateOnError(err) {
      this[kPerMessageDeflate]._inflate = null;
      if (this[kError]) {
        this[kCallback](this[kError]);
        return;
      }
      err[kStatusCode] = 1007;
      this[kCallback](err);
    }
  }
});

// ../../node_modules/ws/lib/validation.js
var require_validation = __commonJS({
  "../../node_modules/ws/lib/validation.js"(exports, module) {
    "use strict";
    var { isUtf8 } = __require("buffer");
    var { hasBlob } = require_constants();
    var tokenChars = [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 0 - 15
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 16 - 31
      0,
      1,
      0,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      1,
      1,
      0,
      1,
      1,
      0,
      // 32 - 47
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      // 48 - 63
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 64 - 79
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      // 80 - 95
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 96 - 111
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      1,
      0,
      1,
      0
      // 112 - 127
    ];
    function isValidStatusCode(code) {
      return code >= 1e3 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006 || code >= 3e3 && code <= 4999;
    }
    function _isValidUTF8(buf) {
      const len = buf.length;
      let i = 0;
      while (i < len) {
        if ((buf[i] & 128) === 0) {
          i++;
        } else if ((buf[i] & 224) === 192) {
          if (i + 1 === len || (buf[i + 1] & 192) !== 128 || (buf[i] & 254) === 192) {
            return false;
          }
          i += 2;
        } else if ((buf[i] & 240) === 224) {
          if (i + 2 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || buf[i] === 224 && (buf[i + 1] & 224) === 128 || // Overlong
          buf[i] === 237 && (buf[i + 1] & 224) === 160) {
            return false;
          }
          i += 3;
        } else if ((buf[i] & 248) === 240) {
          if (i + 3 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || (buf[i + 3] & 192) !== 128 || buf[i] === 240 && (buf[i + 1] & 240) === 128 || // Overlong
          buf[i] === 244 && buf[i + 1] > 143 || buf[i] > 244) {
            return false;
          }
          i += 4;
        } else {
          return false;
        }
      }
      return true;
    }
    function isBlob(value) {
      return hasBlob && typeof value === "object" && typeof value.arrayBuffer === "function" && typeof value.type === "string" && typeof value.stream === "function" && (value[Symbol.toStringTag] === "Blob" || value[Symbol.toStringTag] === "File");
    }
    module.exports = {
      isBlob,
      isValidStatusCode,
      isValidUTF8: _isValidUTF8,
      tokenChars
    };
    if (isUtf8) {
      module.exports.isValidUTF8 = function(buf) {
        return buf.length < 24 ? _isValidUTF8(buf) : isUtf8(buf);
      };
    } else if (!process.env.WS_NO_UTF_8_VALIDATE) {
      try {
        const isValidUTF8 = __require("utf-8-validate");
        module.exports.isValidUTF8 = function(buf) {
          return buf.length < 32 ? _isValidUTF8(buf) : isValidUTF8(buf);
        };
      } catch (e) {
      }
    }
  }
});

// ../../node_modules/ws/lib/receiver.js
var require_receiver = __commonJS({
  "../../node_modules/ws/lib/receiver.js"(exports, module) {
    "use strict";
    var { Writable } = __require("stream");
    var PerMessageDeflate2 = require_permessage_deflate();
    var {
      BINARY_TYPES,
      EMPTY_BUFFER,
      kStatusCode,
      kWebSocket
    } = require_constants();
    var { concat, toArrayBuffer, unmask } = require_buffer_util();
    var { isValidStatusCode, isValidUTF8 } = require_validation();
    var FastBuffer = Buffer[Symbol.species];
    var GET_INFO = 0;
    var GET_PAYLOAD_LENGTH_16 = 1;
    var GET_PAYLOAD_LENGTH_64 = 2;
    var GET_MASK = 3;
    var GET_DATA = 4;
    var INFLATING = 5;
    var DEFER_EVENT = 6;
    var Receiver2 = class extends Writable {
      /**
       * Creates a Receiver instance.
       *
       * @param {Object} [options] Options object
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {String} [options.binaryType=nodebuffer] The type for binary data
       * @param {Object} [options.extensions] An object containing the negotiated
       *     extensions
       * @param {Boolean} [options.isServer=false] Specifies whether to operate in
       *     client or server mode
       * @param {Number} [options.maxBufferedChunks=0] The maximum number of
       *     buffered data chunks
       * @param {Number} [options.maxFragments=0] The maximum number of message
       *     fragments
       * @param {Number} [options.maxPayload=0] The maximum allowed message length
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       */
      constructor(options = {}) {
        super();
        this._allowSynchronousEvents = options.allowSynchronousEvents !== void 0 ? options.allowSynchronousEvents : true;
        this._binaryType = options.binaryType || BINARY_TYPES[0];
        this._extensions = options.extensions || {};
        this._isServer = !!options.isServer;
        this._maxBufferedChunks = options.maxBufferedChunks | 0;
        this._maxFragments = options.maxFragments | 0;
        this._maxPayload = options.maxPayload | 0;
        this._skipUTF8Validation = !!options.skipUTF8Validation;
        this[kWebSocket] = void 0;
        this._bufferedBytes = 0;
        this._buffers = [];
        this._compressed = false;
        this._payloadLength = 0;
        this._mask = void 0;
        this._fragmented = 0;
        this._masked = false;
        this._fin = false;
        this._opcode = 0;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._numFragments = 0;
        this._fragments = [];
        this._errored = false;
        this._loop = false;
        this._state = GET_INFO;
      }
      /**
       * Implements `Writable.prototype._write()`.
       *
       * @param {Buffer} chunk The chunk of data to write
       * @param {String} encoding The character encoding of `chunk`
       * @param {Function} cb Callback
       * @private
       */
      _write(chunk, encoding, cb) {
        if (this._opcode === 8 && this._state == GET_INFO) return cb();
        if (this._maxBufferedChunks > 0 && this._buffers.length >= this._maxBufferedChunks) {
          cb(
            this.createError(
              RangeError,
              "Too many buffered chunks",
              false,
              1008,
              "WS_ERR_TOO_MANY_BUFFERED_PARTS"
            )
          );
          return;
        }
        this._bufferedBytes += chunk.length;
        this._buffers.push(chunk);
        this.startLoop(cb);
      }
      /**
       * Consumes `n` bytes from the buffered data.
       *
       * @param {Number} n The number of bytes to consume
       * @return {Buffer} The consumed bytes
       * @private
       */
      consume(n) {
        this._bufferedBytes -= n;
        if (n === this._buffers[0].length) return this._buffers.shift();
        if (n < this._buffers[0].length) {
          const buf = this._buffers[0];
          this._buffers[0] = new FastBuffer(
            buf.buffer,
            buf.byteOffset + n,
            buf.length - n
          );
          return new FastBuffer(buf.buffer, buf.byteOffset, n);
        }
        const dst = Buffer.allocUnsafe(n);
        do {
          const buf = this._buffers[0];
          const offset = dst.length - n;
          if (n >= buf.length) {
            dst.set(this._buffers.shift(), offset);
          } else {
            dst.set(new Uint8Array(buf.buffer, buf.byteOffset, n), offset);
            this._buffers[0] = new FastBuffer(
              buf.buffer,
              buf.byteOffset + n,
              buf.length - n
            );
          }
          n -= buf.length;
        } while (n > 0);
        return dst;
      }
      /**
       * Starts the parsing loop.
       *
       * @param {Function} cb Callback
       * @private
       */
      startLoop(cb) {
        this._loop = true;
        do {
          switch (this._state) {
            case GET_INFO:
              this.getInfo(cb);
              break;
            case GET_PAYLOAD_LENGTH_16:
              this.getPayloadLength16(cb);
              break;
            case GET_PAYLOAD_LENGTH_64:
              this.getPayloadLength64(cb);
              break;
            case GET_MASK:
              this.getMask();
              break;
            case GET_DATA:
              this.getData(cb);
              break;
            case INFLATING:
            case DEFER_EVENT:
              this._loop = false;
              return;
          }
        } while (this._loop);
        if (!this._errored) cb();
      }
      /**
       * Reads the first two bytes of a frame.
       *
       * @param {Function} cb Callback
       * @private
       */
      getInfo(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        const buf = this.consume(2);
        if ((buf[0] & 48) !== 0) {
          const error = this.createError(
            RangeError,
            "RSV2 and RSV3 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_2_3"
          );
          cb(error);
          return;
        }
        const compressed = (buf[0] & 64) === 64;
        if (compressed && !this._extensions[PerMessageDeflate2.extensionName]) {
          const error = this.createError(
            RangeError,
            "RSV1 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_1"
          );
          cb(error);
          return;
        }
        this._fin = (buf[0] & 128) === 128;
        this._opcode = buf[0] & 15;
        this._payloadLength = buf[1] & 127;
        if (this._opcode === 0) {
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (!this._fragmented) {
            const error = this.createError(
              RangeError,
              "invalid opcode 0",
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._opcode = this._fragmented;
        } else if (this._opcode === 1 || this._opcode === 2) {
          if (this._fragmented) {
            const error = this.createError(
              RangeError,
              `invalid opcode ${this._opcode}`,
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._compressed = compressed;
        } else if (this._opcode > 7 && this._opcode < 11) {
          if (!this._fin) {
            const error = this.createError(
              RangeError,
              "FIN must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_FIN"
            );
            cb(error);
            return;
          }
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (this._payloadLength > 125 || this._opcode === 8 && this._payloadLength === 1) {
            const error = this.createError(
              RangeError,
              `invalid payload length ${this._payloadLength}`,
              true,
              1002,
              "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH"
            );
            cb(error);
            return;
          }
        } else {
          const error = this.createError(
            RangeError,
            `invalid opcode ${this._opcode}`,
            true,
            1002,
            "WS_ERR_INVALID_OPCODE"
          );
          cb(error);
          return;
        }
        if (!this._fin && !this._fragmented) this._fragmented = this._opcode;
        this._masked = (buf[1] & 128) === 128;
        if (this._isServer) {
          if (!this._masked) {
            const error = this.createError(
              RangeError,
              "MASK must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_MASK"
            );
            cb(error);
            return;
          }
        } else if (this._masked) {
          const error = this.createError(
            RangeError,
            "MASK must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_MASK"
          );
          cb(error);
          return;
        }
        if (this._payloadLength === 126) this._state = GET_PAYLOAD_LENGTH_16;
        else if (this._payloadLength === 127) this._state = GET_PAYLOAD_LENGTH_64;
        else this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+16).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength16(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        this._payloadLength = this.consume(2).readUInt16BE(0);
        this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+64).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength64(cb) {
        if (this._bufferedBytes < 8) {
          this._loop = false;
          return;
        }
        const buf = this.consume(8);
        const num = buf.readUInt32BE(0);
        if (num > Math.pow(2, 53 - 32) - 1) {
          const error = this.createError(
            RangeError,
            "Unsupported WebSocket frame: payload length > 2^53 - 1",
            false,
            1009,
            "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH"
          );
          cb(error);
          return;
        }
        this._payloadLength = num * Math.pow(2, 32) + buf.readUInt32BE(4);
        this.haveLength(cb);
      }
      /**
       * Payload length has been read.
       *
       * @param {Function} cb Callback
       * @private
       */
      haveLength(cb) {
        if (this._payloadLength && this._opcode < 8) {
          this._totalPayloadLength += this._payloadLength;
          if (this._totalPayloadLength > this._maxPayload && this._maxPayload > 0) {
            const error = this.createError(
              RangeError,
              "Max payload size exceeded",
              false,
              1009,
              "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
            );
            cb(error);
            return;
          }
        }
        if (this._masked) this._state = GET_MASK;
        else this._state = GET_DATA;
      }
      /**
       * Reads mask bytes.
       *
       * @private
       */
      getMask() {
        if (this._bufferedBytes < 4) {
          this._loop = false;
          return;
        }
        this._mask = this.consume(4);
        this._state = GET_DATA;
      }
      /**
       * Reads data bytes.
       *
       * @param {Function} cb Callback
       * @private
       */
      getData(cb) {
        let data = EMPTY_BUFFER;
        if (this._payloadLength) {
          if (this._bufferedBytes < this._payloadLength) {
            this._loop = false;
            return;
          }
          data = this.consume(this._payloadLength);
          if (this._masked && (this._mask[0] | this._mask[1] | this._mask[2] | this._mask[3]) !== 0) {
            unmask(data, this._mask);
          }
        }
        if (this._opcode > 7) {
          this.controlMessage(data, cb);
          return;
        }
        if (this._maxFragments > 0 && ++this._numFragments > this._maxFragments) {
          const error = this.createError(
            RangeError,
            "Too many message fragments",
            false,
            1008,
            "WS_ERR_TOO_MANY_BUFFERED_PARTS"
          );
          cb(error);
          return;
        }
        if (this._compressed) {
          this._state = INFLATING;
          this.decompress(data, cb);
          return;
        }
        if (data.length) {
          this._messageLength = this._totalPayloadLength;
          this._fragments.push(data);
        }
        this.dataMessage(cb);
      }
      /**
       * Decompresses data.
       *
       * @param {Buffer} data Compressed data
       * @param {Function} cb Callback
       * @private
       */
      decompress(data, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        perMessageDeflate.decompress(data, this._fin, (err, buf) => {
          if (err) return cb(err);
          if (buf.length) {
            this._messageLength += buf.length;
            if (this._messageLength > this._maxPayload && this._maxPayload > 0) {
              const error = this.createError(
                RangeError,
                "Max payload size exceeded",
                false,
                1009,
                "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
              );
              cb(error);
              return;
            }
            this._fragments.push(buf);
          }
          this.dataMessage(cb);
          if (this._state === GET_INFO) this.startLoop(cb);
        });
      }
      /**
       * Handles a data message.
       *
       * @param {Function} cb Callback
       * @private
       */
      dataMessage(cb) {
        if (!this._fin) {
          this._state = GET_INFO;
          return;
        }
        const messageLength = this._messageLength;
        const fragments = this._fragments;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._fragmented = 0;
        this._numFragments = 0;
        this._fragments = [];
        if (this._opcode === 2) {
          let data;
          if (this._binaryType === "nodebuffer") {
            data = concat(fragments, messageLength);
          } else if (this._binaryType === "arraybuffer") {
            data = toArrayBuffer(concat(fragments, messageLength));
          } else if (this._binaryType === "blob") {
            data = new Blob(fragments);
          } else {
            data = fragments;
          }
          if (this._allowSynchronousEvents) {
            this.emit("message", data, true);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", data, true);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        } else {
          const buf = concat(fragments, messageLength);
          if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
            const error = this.createError(
              Error,
              "invalid UTF-8 sequence",
              true,
              1007,
              "WS_ERR_INVALID_UTF8"
            );
            cb(error);
            return;
          }
          if (this._state === INFLATING || this._allowSynchronousEvents) {
            this.emit("message", buf, false);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", buf, false);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        }
      }
      /**
       * Handles a control message.
       *
       * @param {Buffer} data Data to handle
       * @return {(Error|RangeError|undefined)} A possible error
       * @private
       */
      controlMessage(data, cb) {
        if (this._opcode === 8) {
          if (data.length === 0) {
            this._loop = false;
            this.emit("conclude", 1005, EMPTY_BUFFER);
            this.end();
          } else {
            const code = data.readUInt16BE(0);
            if (!isValidStatusCode(code)) {
              const error = this.createError(
                RangeError,
                `invalid status code ${code}`,
                true,
                1002,
                "WS_ERR_INVALID_CLOSE_CODE"
              );
              cb(error);
              return;
            }
            const buf = new FastBuffer(
              data.buffer,
              data.byteOffset + 2,
              data.length - 2
            );
            if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
              const error = this.createError(
                Error,
                "invalid UTF-8 sequence",
                true,
                1007,
                "WS_ERR_INVALID_UTF8"
              );
              cb(error);
              return;
            }
            this._loop = false;
            this.emit("conclude", code, buf);
            this.end();
          }
          this._state = GET_INFO;
          return;
        }
        if (this._allowSynchronousEvents) {
          this.emit(this._opcode === 9 ? "ping" : "pong", data);
          this._state = GET_INFO;
        } else {
          this._state = DEFER_EVENT;
          setImmediate(() => {
            this.emit(this._opcode === 9 ? "ping" : "pong", data);
            this._state = GET_INFO;
            this.startLoop(cb);
          });
        }
      }
      /**
       * Builds an error object.
       *
       * @param {function(new:Error|RangeError)} ErrorCtor The error constructor
       * @param {String} message The error message
       * @param {Boolean} prefix Specifies whether or not to add a default prefix to
       *     `message`
       * @param {Number} statusCode The status code
       * @param {String} errorCode The exposed error code
       * @return {(Error|RangeError)} The error
       * @private
       */
      createError(ErrorCtor, message, prefix, statusCode, errorCode) {
        this._loop = false;
        this._errored = true;
        const err = new ErrorCtor(
          prefix ? `Invalid WebSocket frame: ${message}` : message
        );
        Error.captureStackTrace(err, this.createError);
        err.code = errorCode;
        err[kStatusCode] = statusCode;
        return err;
      }
    };
    module.exports = Receiver2;
  }
});

// ../../node_modules/ws/lib/sender.js
var require_sender = __commonJS({
  "../../node_modules/ws/lib/sender.js"(exports, module) {
    "use strict";
    var { Duplex } = __require("stream");
    var { randomFillSync } = __require("crypto");
    var {
      types: { isUint8Array }
    } = __require("util");
    var PerMessageDeflate2 = require_permessage_deflate();
    var { EMPTY_BUFFER, kWebSocket, NOOP } = require_constants();
    var { isBlob, isValidStatusCode } = require_validation();
    var { mask: applyMask, toBuffer } = require_buffer_util();
    var kByteLength = Symbol("kByteLength");
    var maskBuffer = Buffer.alloc(4);
    var RANDOM_POOL_SIZE = 8 * 1024;
    var randomPool;
    var randomPoolPointer = RANDOM_POOL_SIZE;
    var DEFAULT = 0;
    var DEFLATING = 1;
    var GET_BLOB_DATA = 2;
    var Sender2 = class _Sender {
      /**
       * Creates a Sender instance.
       *
       * @param {Duplex} socket The connection socket
       * @param {Object} [extensions] An object containing the negotiated extensions
       * @param {Function} [generateMask] The function used to generate the masking
       *     key
       */
      constructor(socket, extensions, generateMask) {
        this._extensions = extensions || {};
        if (generateMask) {
          this._generateMask = generateMask;
          this._maskBuffer = Buffer.alloc(4);
        }
        this._socket = socket;
        this._firstFragment = true;
        this._compress = false;
        this._bufferedBytes = 0;
        this._queue = [];
        this._state = DEFAULT;
        this.onerror = NOOP;
        this[kWebSocket] = void 0;
      }
      /**
       * Frames a piece of data according to the HyBi WebSocket protocol.
       *
       * @param {(Buffer|String)} data The data to frame
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @return {(Buffer|String)[]} The framed data
       * @public
       */
      static frame(data, options) {
        let mask;
        let merge = false;
        let offset = 2;
        let skipMasking = false;
        if (options.mask) {
          mask = options.maskBuffer || maskBuffer;
          if (options.generateMask) {
            options.generateMask(mask);
          } else {
            if (randomPoolPointer === RANDOM_POOL_SIZE) {
              if (randomPool === void 0) {
                randomPool = Buffer.alloc(RANDOM_POOL_SIZE);
              }
              randomFillSync(randomPool, 0, RANDOM_POOL_SIZE);
              randomPoolPointer = 0;
            }
            mask[0] = randomPool[randomPoolPointer++];
            mask[1] = randomPool[randomPoolPointer++];
            mask[2] = randomPool[randomPoolPointer++];
            mask[3] = randomPool[randomPoolPointer++];
          }
          skipMasking = (mask[0] | mask[1] | mask[2] | mask[3]) === 0;
          offset = 6;
        }
        let dataLength;
        if (typeof data === "string") {
          if ((!options.mask || skipMasking) && options[kByteLength] !== void 0) {
            dataLength = options[kByteLength];
          } else {
            data = Buffer.from(data);
            dataLength = data.length;
          }
        } else {
          dataLength = data.length;
          merge = options.mask && options.readOnly && !skipMasking;
        }
        let payloadLength = dataLength;
        if (dataLength >= 65536) {
          offset += 8;
          payloadLength = 127;
        } else if (dataLength > 125) {
          offset += 2;
          payloadLength = 126;
        }
        const target = Buffer.allocUnsafe(merge ? dataLength + offset : offset);
        target[0] = options.fin ? options.opcode | 128 : options.opcode;
        if (options.rsv1) target[0] |= 64;
        target[1] = payloadLength;
        if (payloadLength === 126) {
          target.writeUInt16BE(dataLength, 2);
        } else if (payloadLength === 127) {
          target[2] = target[3] = 0;
          target.writeUIntBE(dataLength, 4, 6);
        }
        if (!options.mask) return [target, data];
        target[1] |= 128;
        target[offset - 4] = mask[0];
        target[offset - 3] = mask[1];
        target[offset - 2] = mask[2];
        target[offset - 1] = mask[3];
        if (skipMasking) return [target, data];
        if (merge) {
          applyMask(data, mask, target, offset, dataLength);
          return [target];
        }
        applyMask(data, mask, data, 0, dataLength);
        return [target, data];
      }
      /**
       * Sends a close message to the other peer.
       *
       * @param {Number} [code] The status code component of the body
       * @param {(String|Buffer)} [data] The message component of the body
       * @param {Boolean} [mask=false] Specifies whether or not to mask the message
       * @param {Function} [cb] Callback
       * @public
       */
      close(code, data, mask, cb) {
        let buf;
        if (code === void 0) {
          buf = EMPTY_BUFFER;
        } else if (typeof code !== "number" || !isValidStatusCode(code)) {
          throw new TypeError("First argument must be a valid error code number");
        } else if (data === void 0 || !data.length) {
          buf = Buffer.allocUnsafe(2);
          buf.writeUInt16BE(code, 0);
        } else {
          const length = Buffer.byteLength(data);
          if (length > 123) {
            throw new RangeError("The message must not be greater than 123 bytes");
          }
          buf = Buffer.allocUnsafe(2 + length);
          buf.writeUInt16BE(code, 0);
          if (typeof data === "string") {
            buf.write(data, 2);
          } else if (isUint8Array(data)) {
            buf.set(data, 2);
          } else {
            throw new TypeError("Second argument must be a string or a Uint8Array");
          }
        }
        const options = {
          [kByteLength]: buf.length,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 8,
          readOnly: false,
          rsv1: false
        };
        if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, buf, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(buf, options), cb);
        }
      }
      /**
       * Sends a ping message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      ping(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 9,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a pong message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      pong(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 10,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a data message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Object} options Options object
       * @param {Boolean} [options.binary=false] Specifies whether `data` is binary
       *     or text
       * @param {Boolean} [options.compress=false] Specifies whether or not to
       *     compress `data`
       * @param {Boolean} [options.fin=false] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Function} [cb] Callback
       * @public
       */
      send(data, options, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        let opcode = options.binary ? 2 : 1;
        let rsv1 = options.compress;
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (this._firstFragment) {
          this._firstFragment = false;
          if (rsv1 && perMessageDeflate && perMessageDeflate.params[perMessageDeflate._isServer ? "server_no_context_takeover" : "client_no_context_takeover"]) {
            rsv1 = byteLength >= perMessageDeflate._threshold;
          }
          this._compress = rsv1;
        } else {
          rsv1 = false;
          opcode = 0;
        }
        if (options.fin) this._firstFragment = true;
        const opts = {
          [kByteLength]: byteLength,
          fin: options.fin,
          generateMask: this._generateMask,
          mask: options.mask,
          maskBuffer: this._maskBuffer,
          opcode,
          readOnly,
          rsv1
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, this._compress, opts, cb]);
          } else {
            this.getBlobData(data, this._compress, opts, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, this._compress, opts, cb]);
        } else {
          this.dispatch(data, this._compress, opts, cb);
        }
      }
      /**
       * Gets the contents of a blob as binary data.
       *
       * @param {Blob} blob The blob
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     the data
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      getBlobData(blob, compress, options, cb) {
        this._bufferedBytes += options[kByteLength];
        this._state = GET_BLOB_DATA;
        blob.arrayBuffer().then((arrayBuffer) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while the blob was being read"
            );
            process.nextTick(callCallbacks, this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          const data = toBuffer(arrayBuffer);
          if (!compress) {
            this._state = DEFAULT;
            this.sendFrame(_Sender.frame(data, options), cb);
            this.dequeue();
          } else {
            this.dispatch(data, compress, options, cb);
          }
        }).catch((err) => {
          process.nextTick(onError, this, err, cb);
        });
      }
      /**
       * Dispatches a message.
       *
       * @param {(Buffer|String)} data The message to send
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     `data`
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      dispatch(data, compress, options, cb) {
        if (!compress) {
          this.sendFrame(_Sender.frame(data, options), cb);
          return;
        }
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        this._bufferedBytes += options[kByteLength];
        this._state = DEFLATING;
        perMessageDeflate.compress(data, options.fin, (_, buf) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while data was being compressed"
            );
            callCallbacks(this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          this._state = DEFAULT;
          options.readOnly = false;
          this.sendFrame(_Sender.frame(buf, options), cb);
          this.dequeue();
        });
      }
      /**
       * Executes queued send operations.
       *
       * @private
       */
      dequeue() {
        while (this._state === DEFAULT && this._queue.length) {
          const params = this._queue.shift();
          this._bufferedBytes -= params[3][kByteLength];
          Reflect.apply(params[0], this, params.slice(1));
        }
      }
      /**
       * Enqueues a send operation.
       *
       * @param {Array} params Send operation parameters.
       * @private
       */
      enqueue(params) {
        this._bufferedBytes += params[3][kByteLength];
        this._queue.push(params);
      }
      /**
       * Sends a frame.
       *
       * @param {(Buffer | String)[]} list The frame to send
       * @param {Function} [cb] Callback
       * @private
       */
      sendFrame(list, cb) {
        if (list.length === 2) {
          this._socket.cork();
          this._socket.write(list[0]);
          this._socket.write(list[1], cb);
          this._socket.uncork();
        } else {
          this._socket.write(list[0], cb);
        }
      }
    };
    module.exports = Sender2;
    function callCallbacks(sender, err, cb) {
      if (typeof cb === "function") cb(err);
      for (let i = 0; i < sender._queue.length; i++) {
        const params = sender._queue[i];
        const callback = params[params.length - 1];
        if (typeof callback === "function") callback(err);
      }
    }
    function onError(sender, err, cb) {
      callCallbacks(sender, err, cb);
      sender.onerror(err);
    }
  }
});

// ../../node_modules/ws/lib/event-target.js
var require_event_target = __commonJS({
  "../../node_modules/ws/lib/event-target.js"(exports, module) {
    "use strict";
    var { kForOnEventAttribute, kListener } = require_constants();
    var kCode = Symbol("kCode");
    var kData = Symbol("kData");
    var kError = Symbol("kError");
    var kMessage = Symbol("kMessage");
    var kReason = Symbol("kReason");
    var kTarget = Symbol("kTarget");
    var kType = Symbol("kType");
    var kWasClean = Symbol("kWasClean");
    var Event = class {
      /**
       * Create a new `Event`.
       *
       * @param {String} type The name of the event
       * @throws {TypeError} If the `type` argument is not specified
       */
      constructor(type) {
        this[kTarget] = null;
        this[kType] = type;
      }
      /**
       * @type {*}
       */
      get target() {
        return this[kTarget];
      }
      /**
       * @type {String}
       */
      get type() {
        return this[kType];
      }
    };
    Object.defineProperty(Event.prototype, "target", { enumerable: true });
    Object.defineProperty(Event.prototype, "type", { enumerable: true });
    var CloseEvent = class extends Event {
      /**
       * Create a new `CloseEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {Number} [options.code=0] The status code explaining why the
       *     connection was closed
       * @param {String} [options.reason=''] A human-readable string explaining why
       *     the connection was closed
       * @param {Boolean} [options.wasClean=false] Indicates whether or not the
       *     connection was cleanly closed
       */
      constructor(type, options = {}) {
        super(type);
        this[kCode] = options.code === void 0 ? 0 : options.code;
        this[kReason] = options.reason === void 0 ? "" : options.reason;
        this[kWasClean] = options.wasClean === void 0 ? false : options.wasClean;
      }
      /**
       * @type {Number}
       */
      get code() {
        return this[kCode];
      }
      /**
       * @type {String}
       */
      get reason() {
        return this[kReason];
      }
      /**
       * @type {Boolean}
       */
      get wasClean() {
        return this[kWasClean];
      }
    };
    Object.defineProperty(CloseEvent.prototype, "code", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "reason", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "wasClean", { enumerable: true });
    var ErrorEvent = class extends Event {
      /**
       * Create a new `ErrorEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.error=null] The error that generated this event
       * @param {String} [options.message=''] The error message
       */
      constructor(type, options = {}) {
        super(type);
        this[kError] = options.error === void 0 ? null : options.error;
        this[kMessage] = options.message === void 0 ? "" : options.message;
      }
      /**
       * @type {*}
       */
      get error() {
        return this[kError];
      }
      /**
       * @type {String}
       */
      get message() {
        return this[kMessage];
      }
    };
    Object.defineProperty(ErrorEvent.prototype, "error", { enumerable: true });
    Object.defineProperty(ErrorEvent.prototype, "message", { enumerable: true });
    var MessageEvent = class extends Event {
      /**
       * Create a new `MessageEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.data=null] The message content
       */
      constructor(type, options = {}) {
        super(type);
        this[kData] = options.data === void 0 ? null : options.data;
      }
      /**
       * @type {*}
       */
      get data() {
        return this[kData];
      }
    };
    Object.defineProperty(MessageEvent.prototype, "data", { enumerable: true });
    var EventTarget = {
      /**
       * Register an event listener.
       *
       * @param {String} type A string representing the event type to listen for
       * @param {(Function|Object)} handler The listener to add
       * @param {Object} [options] An options object specifies characteristics about
       *     the event listener
       * @param {Boolean} [options.once=false] A `Boolean` indicating that the
       *     listener should be invoked at most once after being added. If `true`,
       *     the listener would be automatically removed when invoked.
       * @public
       */
      addEventListener(type, handler, options = {}) {
        for (const listener of this.listeners(type)) {
          if (!options[kForOnEventAttribute] && listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            return;
          }
        }
        let wrapper;
        if (type === "message") {
          wrapper = function onMessage(data, isBinary) {
            const event = new MessageEvent("message", {
              data: isBinary ? data : data.toString()
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "close") {
          wrapper = function onClose(code, message) {
            const event = new CloseEvent("close", {
              code,
              reason: message.toString(),
              wasClean: this._closeFrameReceived && this._closeFrameSent
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "error") {
          wrapper = function onError(error) {
            const event = new ErrorEvent("error", {
              error,
              message: error.message
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "open") {
          wrapper = function onOpen() {
            const event = new Event("open");
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else {
          return;
        }
        wrapper[kForOnEventAttribute] = !!options[kForOnEventAttribute];
        wrapper[kListener] = handler;
        if (options.once) {
          this.once(type, wrapper);
        } else {
          this.on(type, wrapper);
        }
      },
      /**
       * Remove an event listener.
       *
       * @param {String} type A string representing the event type to remove
       * @param {(Function|Object)} handler The listener to remove
       * @public
       */
      removeEventListener(type, handler) {
        for (const listener of this.listeners(type)) {
          if (listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            this.removeListener(type, listener);
            break;
          }
        }
      }
    };
    module.exports = {
      CloseEvent,
      ErrorEvent,
      Event,
      EventTarget,
      MessageEvent
    };
    function callListener(listener, thisArg, event) {
      if (typeof listener === "object" && listener.handleEvent) {
        listener.handleEvent.call(listener, event);
      } else {
        listener.call(thisArg, event);
      }
    }
  }
});

// ../../node_modules/ws/lib/extension.js
var require_extension = __commonJS({
  "../../node_modules/ws/lib/extension.js"(exports, module) {
    "use strict";
    var { tokenChars } = require_validation();
    function push(dest, name, elem) {
      if (dest[name] === void 0) dest[name] = [elem];
      else dest[name].push(elem);
    }
    function parse(header) {
      const offers = /* @__PURE__ */ Object.create(null);
      let params = /* @__PURE__ */ Object.create(null);
      let mustUnescape = false;
      let isEscaping = false;
      let inQuotes = false;
      let extensionName;
      let paramName;
      let start = -1;
      let code = -1;
      let end = -1;
      let i = 0;
      for (; i < header.length; i++) {
        code = header.charCodeAt(i);
        if (extensionName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (i !== 0 && (code === 32 || code === 9)) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            const name = header.slice(start, end);
            if (code === 44) {
              push(offers, name, params);
              params = /* @__PURE__ */ Object.create(null);
            } else {
              extensionName = name;
            }
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else if (paramName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (code === 32 || code === 9) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            push(params, header.slice(start, end), true);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            start = end = -1;
          } else if (code === 61 && start !== -1 && end === -1) {
            paramName = header.slice(start, i);
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else {
          if (isEscaping) {
            if (tokenChars[code] !== 1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (start === -1) start = i;
            else if (!mustUnescape) mustUnescape = true;
            isEscaping = false;
          } else if (inQuotes) {
            if (tokenChars[code] === 1) {
              if (start === -1) start = i;
            } else if (code === 34 && start !== -1) {
              inQuotes = false;
              end = i;
            } else if (code === 92) {
              isEscaping = true;
            } else {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
          } else if (code === 34 && header.charCodeAt(i - 1) === 61) {
            inQuotes = true;
          } else if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (start !== -1 && (code === 32 || code === 9)) {
            if (end === -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            let value = header.slice(start, end);
            if (mustUnescape) {
              value = value.replace(/\\/g, "");
              mustUnescape = false;
            }
            push(params, paramName, value);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            paramName = void 0;
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        }
      }
      if (start === -1 || inQuotes || code === 32 || code === 9) {
        throw new SyntaxError("Unexpected end of input");
      }
      if (end === -1) end = i;
      const token = header.slice(start, end);
      if (extensionName === void 0) {
        push(offers, token, params);
      } else {
        if (paramName === void 0) {
          push(params, token, true);
        } else if (mustUnescape) {
          push(params, paramName, token.replace(/\\/g, ""));
        } else {
          push(params, paramName, token);
        }
        push(offers, extensionName, params);
      }
      return offers;
    }
    function format(extensions) {
      return Object.keys(extensions).map((extension2) => {
        let configurations = extensions[extension2];
        if (!Array.isArray(configurations)) configurations = [configurations];
        return configurations.map((params) => {
          return [extension2].concat(
            Object.keys(params).map((k) => {
              let values = params[k];
              if (!Array.isArray(values)) values = [values];
              return values.map((v) => v === true ? k : `${k}=${v}`).join("; ");
            })
          ).join("; ");
        }).join(", ");
      }).join(", ");
    }
    module.exports = { format, parse };
  }
});

// ../../node_modules/ws/lib/websocket.js
var require_websocket = __commonJS({
  "../../node_modules/ws/lib/websocket.js"(exports, module) {
    "use strict";
    var EventEmitter = __require("events");
    var https = __require("https");
    var http = __require("http");
    var net = __require("net");
    var tls = __require("tls");
    var { randomBytes, createHash: createHash2 } = __require("crypto");
    var { Duplex, Readable } = __require("stream");
    var { URL: URL2 } = __require("url");
    var PerMessageDeflate2 = require_permessage_deflate();
    var Receiver2 = require_receiver();
    var Sender2 = require_sender();
    var { isBlob } = require_validation();
    var {
      BINARY_TYPES,
      CLOSE_TIMEOUT,
      EMPTY_BUFFER,
      GUID,
      kForOnEventAttribute,
      kListener,
      kStatusCode,
      kWebSocket,
      NOOP
    } = require_constants();
    var {
      EventTarget: { addEventListener, removeEventListener }
    } = require_event_target();
    var { format, parse } = require_extension();
    var { toBuffer } = require_buffer_util();
    var kAborted = Symbol("kAborted");
    var protocolVersions = [8, 13];
    var readyStates = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
    var subprotocolRegex = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;
    var WebSocket2 = class _WebSocket extends EventEmitter {
      /**
       * Create a new `WebSocket`.
       *
       * @param {(String|URL)} address The URL to which to connect
       * @param {(String|String[])} [protocols] The subprotocols
       * @param {Object} [options] Connection options
       */
      constructor(address, protocols, options) {
        super();
        this._binaryType = BINARY_TYPES[0];
        this._closeCode = 1006;
        this._closeFrameReceived = false;
        this._closeFrameSent = false;
        this._closeMessage = EMPTY_BUFFER;
        this._closeTimer = null;
        this._errorEmitted = false;
        this._extensions = {};
        this._paused = false;
        this._protocol = "";
        this._readyState = _WebSocket.CONNECTING;
        this._receiver = null;
        this._sender = null;
        this._socket = null;
        if (address !== null) {
          this._bufferedAmount = 0;
          this._isServer = false;
          this._redirects = 0;
          if (protocols === void 0) {
            protocols = [];
          } else if (!Array.isArray(protocols)) {
            if (typeof protocols === "object" && protocols !== null) {
              options = protocols;
              protocols = [];
            } else {
              protocols = [protocols];
            }
          }
          initAsClient(this, address, protocols, options);
        } else {
          this._autoPong = options.autoPong;
          this._closeTimeout = options.closeTimeout;
          this._isServer = true;
        }
      }
      /**
       * For historical reasons, the custom "nodebuffer" type is used by the default
       * instead of "blob".
       *
       * @type {String}
       */
      get binaryType() {
        return this._binaryType;
      }
      set binaryType(type) {
        if (!BINARY_TYPES.includes(type)) return;
        this._binaryType = type;
        if (this._receiver) this._receiver._binaryType = type;
      }
      /**
       * @type {Number}
       */
      get bufferedAmount() {
        if (!this._socket) return this._bufferedAmount;
        return this._socket._writableState.length + this._sender._bufferedBytes;
      }
      /**
       * @type {String}
       */
      get extensions() {
        return Object.keys(this._extensions).join();
      }
      /**
       * @type {Boolean}
       */
      get isPaused() {
        return this._paused;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onclose() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onerror() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onopen() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onmessage() {
        return null;
      }
      /**
       * @type {String}
       */
      get protocol() {
        return this._protocol;
      }
      /**
       * @type {Number}
       */
      get readyState() {
        return this._readyState;
      }
      /**
       * @type {String}
       */
      get url() {
        return this._url;
      }
      /**
       * Set up the socket and the internal resources.
       *
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Object} options Options object
       * @param {Boolean} [options.allowSynchronousEvents=false] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Number} [options.maxBufferedChunks=0] The maximum number of
       *     buffered data chunks
       * @param {Number} [options.maxFragments=0] The maximum number of message
       *     fragments
       * @param {Number} [options.maxPayload=0] The maximum allowed message size
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @private
       */
      setSocket(socket, head, options) {
        const receiver = new Receiver2({
          allowSynchronousEvents: options.allowSynchronousEvents,
          binaryType: this.binaryType,
          extensions: this._extensions,
          isServer: this._isServer,
          maxBufferedChunks: options.maxBufferedChunks,
          maxFragments: options.maxFragments,
          maxPayload: options.maxPayload,
          skipUTF8Validation: options.skipUTF8Validation
        });
        const sender = new Sender2(socket, this._extensions, options.generateMask);
        this._receiver = receiver;
        this._sender = sender;
        this._socket = socket;
        receiver[kWebSocket] = this;
        sender[kWebSocket] = this;
        socket[kWebSocket] = this;
        receiver.on("conclude", receiverOnConclude);
        receiver.on("drain", receiverOnDrain);
        receiver.on("error", receiverOnError);
        receiver.on("message", receiverOnMessage);
        receiver.on("ping", receiverOnPing);
        receiver.on("pong", receiverOnPong);
        sender.onerror = senderOnError;
        if (socket.setTimeout) socket.setTimeout(0);
        if (socket.setNoDelay) socket.setNoDelay();
        if (head.length > 0) socket.unshift(head);
        socket.on("close", socketOnClose);
        socket.on("data", socketOnData);
        socket.on("end", socketOnEnd);
        socket.on("error", socketOnError);
        this._readyState = _WebSocket.OPEN;
        this.emit("open");
      }
      /**
       * Emit the `'close'` event.
       *
       * @private
       */
      emitClose() {
        if (!this._socket) {
          this._readyState = _WebSocket.CLOSED;
          this.emit("close", this._closeCode, this._closeMessage);
          return;
        }
        if (this._extensions[PerMessageDeflate2.extensionName]) {
          this._extensions[PerMessageDeflate2.extensionName].cleanup();
        }
        this._receiver.removeAllListeners();
        this._readyState = _WebSocket.CLOSED;
        this.emit("close", this._closeCode, this._closeMessage);
      }
      /**
       * Start a closing handshake.
       *
       *          +----------+   +-----------+   +----------+
       *     - - -|ws.close()|-->|close frame|-->|ws.close()|- - -
       *    |     +----------+   +-----------+   +----------+     |
       *          +----------+   +-----------+         |
       * CLOSING  |ws.close()|<--|close frame|<--+-----+       CLOSING
       *          +----------+   +-----------+   |
       *    |           |                        |   +---+        |
       *                +------------------------+-->|fin| - - - -
       *    |         +---+                      |   +---+
       *     - - - - -|fin|<---------------------+
       *              +---+
       *
       * @param {Number} [code] Status code explaining why the connection is closing
       * @param {(String|Buffer)} [data] The reason why the connection is
       *     closing
       * @public
       */
      close(code, data) {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this.readyState === _WebSocket.CLOSING) {
          if (this._closeFrameSent && (this._closeFrameReceived || this._receiver._writableState.errorEmitted)) {
            this._socket.end();
          }
          return;
        }
        this._readyState = _WebSocket.CLOSING;
        this._sender.close(code, data, !this._isServer, (err) => {
          if (err) return;
          this._closeFrameSent = true;
          if (this._closeFrameReceived || this._receiver._writableState.errorEmitted) {
            this._socket.end();
          }
        });
        setCloseTimer(this);
      }
      /**
       * Pause the socket.
       *
       * @public
       */
      pause() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = true;
        this._socket.pause();
      }
      /**
       * Send a ping.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the ping is sent
       * @public
       */
      ping(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.ping(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Send a pong.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the pong is sent
       * @public
       */
      pong(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.pong(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Resume the socket.
       *
       * @public
       */
      resume() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = false;
        if (!this._receiver._writableState.needDrain) this._socket.resume();
      }
      /**
       * Send a data message.
       *
       * @param {*} data The message to send
       * @param {Object} [options] Options object
       * @param {Boolean} [options.binary] Specifies whether `data` is binary or
       *     text
       * @param {Boolean} [options.compress] Specifies whether or not to compress
       *     `data`
       * @param {Boolean} [options.fin=true] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when data is written out
       * @public
       */
      send(data, options, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof options === "function") {
          cb = options;
          options = {};
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        const opts = {
          binary: typeof data !== "string",
          mask: !this._isServer,
          compress: true,
          fin: true,
          ...options
        };
        if (!this._extensions[PerMessageDeflate2.extensionName]) {
          opts.compress = false;
        }
        this._sender.send(data || EMPTY_BUFFER, opts, cb);
      }
      /**
       * Forcibly close the connection.
       *
       * @public
       */
      terminate() {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this._socket) {
          this._readyState = _WebSocket.CLOSING;
          this._socket.destroy();
        }
      }
    };
    Object.defineProperty(WebSocket2, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket2.prototype, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket2, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket2.prototype, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket2, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket2.prototype, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket2, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    Object.defineProperty(WebSocket2.prototype, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    [
      "binaryType",
      "bufferedAmount",
      "extensions",
      "isPaused",
      "protocol",
      "readyState",
      "url"
    ].forEach((property) => {
      Object.defineProperty(WebSocket2.prototype, property, { enumerable: true });
    });
    ["open", "error", "close", "message"].forEach((method) => {
      Object.defineProperty(WebSocket2.prototype, `on${method}`, {
        enumerable: true,
        get() {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) return listener[kListener];
          }
          return null;
        },
        set(handler) {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) {
              this.removeListener(method, listener);
              break;
            }
          }
          if (typeof handler !== "function") return;
          this.addEventListener(method, handler, {
            [kForOnEventAttribute]: true
          });
        }
      });
    });
    WebSocket2.prototype.addEventListener = addEventListener;
    WebSocket2.prototype.removeEventListener = removeEventListener;
    module.exports = WebSocket2;
    function initAsClient(websocket, address, protocols, options) {
      const opts = {
        allowSynchronousEvents: true,
        autoPong: true,
        closeTimeout: CLOSE_TIMEOUT,
        protocolVersion: protocolVersions[1],
        maxBufferedChunks: 256 * 1024,
        maxFragments: 16 * 1024,
        maxPayload: 100 * 1024 * 1024,
        skipUTF8Validation: false,
        perMessageDeflate: true,
        followRedirects: false,
        maxRedirects: 10,
        ...options,
        socketPath: void 0,
        hostname: void 0,
        protocol: void 0,
        timeout: void 0,
        method: "GET",
        host: void 0,
        path: void 0,
        port: void 0
      };
      websocket._autoPong = opts.autoPong;
      websocket._closeTimeout = opts.closeTimeout;
      if (!protocolVersions.includes(opts.protocolVersion)) {
        throw new RangeError(
          `Unsupported protocol version: ${opts.protocolVersion} (supported versions: ${protocolVersions.join(", ")})`
        );
      }
      let parsedUrl;
      if (address instanceof URL2) {
        parsedUrl = address;
      } else {
        try {
          parsedUrl = new URL2(address);
        } catch {
          throw new SyntaxError(`Invalid URL: ${address}`);
        }
      }
      if (parsedUrl.protocol === "http:") {
        parsedUrl.protocol = "ws:";
      } else if (parsedUrl.protocol === "https:") {
        parsedUrl.protocol = "wss:";
      }
      websocket._url = parsedUrl.href;
      const isSecure = parsedUrl.protocol === "wss:";
      const isIpcUrl = parsedUrl.protocol === "ws+unix:";
      let invalidUrlMessage;
      if (parsedUrl.protocol !== "ws:" && !isSecure && !isIpcUrl) {
        invalidUrlMessage = `The URL's protocol must be one of "ws:", "wss:", "http:", "https:", or "ws+unix:"`;
      } else if (isIpcUrl && !parsedUrl.pathname) {
        invalidUrlMessage = "The URL's pathname is empty";
      } else if (parsedUrl.hash) {
        invalidUrlMessage = "The URL contains a fragment identifier";
      }
      if (invalidUrlMessage) {
        const err = new SyntaxError(invalidUrlMessage);
        if (websocket._redirects === 0) {
          throw err;
        } else {
          emitErrorAndClose(websocket, err);
          return;
        }
      }
      const defaultPort = isSecure ? 443 : 80;
      const key = randomBytes(16).toString("base64");
      const request = isSecure ? https.request : http.request;
      const protocolSet = /* @__PURE__ */ new Set();
      let perMessageDeflate;
      opts.createConnection = opts.createConnection || (isSecure ? tlsConnect : netConnect);
      opts.defaultPort = opts.defaultPort || defaultPort;
      opts.port = parsedUrl.port || defaultPort;
      opts.host = parsedUrl.hostname.startsWith("[") ? parsedUrl.hostname.slice(1, -1) : parsedUrl.hostname;
      opts.headers = {
        ...opts.headers,
        "Sec-WebSocket-Version": opts.protocolVersion,
        "Sec-WebSocket-Key": key,
        Connection: "Upgrade",
        Upgrade: "websocket"
      };
      opts.path = parsedUrl.pathname + parsedUrl.search;
      opts.timeout = opts.handshakeTimeout;
      if (opts.perMessageDeflate) {
        perMessageDeflate = new PerMessageDeflate2({
          ...opts.perMessageDeflate,
          isServer: false,
          maxPayload: opts.maxPayload
        });
        opts.headers["Sec-WebSocket-Extensions"] = format({
          [PerMessageDeflate2.extensionName]: perMessageDeflate.offer()
        });
      }
      if (protocols.length) {
        for (const protocol of protocols) {
          if (typeof protocol !== "string" || !subprotocolRegex.test(protocol) || protocolSet.has(protocol)) {
            throw new SyntaxError(
              "An invalid or duplicated subprotocol was specified"
            );
          }
          protocolSet.add(protocol);
        }
        opts.headers["Sec-WebSocket-Protocol"] = protocols.join(",");
      }
      if (opts.origin) {
        if (opts.protocolVersion < 13) {
          opts.headers["Sec-WebSocket-Origin"] = opts.origin;
        } else {
          opts.headers.Origin = opts.origin;
        }
      }
      if (parsedUrl.username || parsedUrl.password) {
        opts.auth = `${parsedUrl.username}:${parsedUrl.password}`;
      }
      if (isIpcUrl) {
        const parts = opts.path.split(":");
        opts.socketPath = parts[0];
        opts.path = parts[1];
      }
      let req;
      if (opts.followRedirects) {
        if (websocket._redirects === 0) {
          websocket._originalIpc = isIpcUrl;
          websocket._originalSecure = isSecure;
          websocket._originalHostOrSocketPath = isIpcUrl ? opts.socketPath : parsedUrl.host;
          const headers = options && options.headers;
          options = { ...options, headers: {} };
          if (headers) {
            for (const [key2, value] of Object.entries(headers)) {
              options.headers[key2.toLowerCase()] = value;
            }
          }
        } else if (websocket.listenerCount("redirect") === 0) {
          const isSameHost = isIpcUrl ? websocket._originalIpc ? opts.socketPath === websocket._originalHostOrSocketPath : false : websocket._originalIpc ? false : parsedUrl.host === websocket._originalHostOrSocketPath;
          if (!isSameHost || websocket._originalSecure && !isSecure) {
            delete opts.headers.authorization;
            delete opts.headers.cookie;
            if (!isSameHost) delete opts.headers.host;
            opts.auth = void 0;
          }
        }
        if (opts.auth && !options.headers.authorization) {
          options.headers.authorization = "Basic " + Buffer.from(opts.auth).toString("base64");
        }
        req = websocket._req = request(opts);
        if (websocket._redirects) {
          websocket.emit("redirect", websocket.url, req);
        }
      } else {
        req = websocket._req = request(opts);
      }
      if (opts.timeout) {
        req.on("timeout", () => {
          abortHandshake(websocket, req, "Opening handshake has timed out");
        });
      }
      req.on("error", (err) => {
        if (req === null || req[kAborted]) return;
        req = websocket._req = null;
        emitErrorAndClose(websocket, err);
      });
      req.on("response", (res) => {
        const location = res.headers.location;
        const statusCode = res.statusCode;
        if (location && opts.followRedirects && statusCode >= 300 && statusCode < 400) {
          if (++websocket._redirects > opts.maxRedirects) {
            abortHandshake(websocket, req, "Maximum redirects exceeded");
            return;
          }
          req.abort();
          let addr;
          try {
            addr = new URL2(location, address);
          } catch (e) {
            const err = new SyntaxError(`Invalid URL: ${location}`);
            emitErrorAndClose(websocket, err);
            return;
          }
          initAsClient(websocket, addr, protocols, options);
        } else if (!websocket.emit("unexpected-response", req, res)) {
          abortHandshake(
            websocket,
            req,
            `Unexpected server response: ${res.statusCode}`
          );
        }
      });
      req.on("upgrade", (res, socket, head) => {
        websocket.emit("upgrade", res);
        if (websocket.readyState !== WebSocket2.CONNECTING) return;
        req = websocket._req = null;
        const upgrade = res.headers.upgrade;
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          abortHandshake(websocket, socket, "Invalid Upgrade header");
          return;
        }
        const digest = createHash2("sha1").update(key + GUID).digest("base64");
        if (res.headers["sec-websocket-accept"] !== digest) {
          abortHandshake(websocket, socket, "Invalid Sec-WebSocket-Accept header");
          return;
        }
        const serverProt = res.headers["sec-websocket-protocol"];
        let protError;
        if (serverProt !== void 0) {
          if (!protocolSet.size) {
            protError = "Server sent a subprotocol but none was requested";
          } else if (!protocolSet.has(serverProt)) {
            protError = "Server sent an invalid subprotocol";
          }
        } else if (protocolSet.size) {
          protError = "Server sent no subprotocol";
        }
        if (protError) {
          abortHandshake(websocket, socket, protError);
          return;
        }
        if (serverProt) websocket._protocol = serverProt;
        const secWebSocketExtensions = res.headers["sec-websocket-extensions"];
        if (secWebSocketExtensions !== void 0) {
          if (!perMessageDeflate) {
            const message = "Server sent a Sec-WebSocket-Extensions header but no extension was requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          let extensions;
          try {
            extensions = parse(secWebSocketExtensions);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          const extensionNames = Object.keys(extensions);
          if (extensionNames.length !== 1 || extensionNames[0] !== PerMessageDeflate2.extensionName) {
            const message = "Server indicated an extension that was not requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          try {
            perMessageDeflate.accept(extensions[PerMessageDeflate2.extensionName]);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          websocket._extensions[PerMessageDeflate2.extensionName] = perMessageDeflate;
        }
        websocket.setSocket(socket, head, {
          allowSynchronousEvents: opts.allowSynchronousEvents,
          generateMask: opts.generateMask,
          maxBufferedChunks: opts.maxBufferedChunks,
          maxFragments: opts.maxFragments,
          maxPayload: opts.maxPayload,
          skipUTF8Validation: opts.skipUTF8Validation
        });
      });
      if (opts.finishRequest) {
        opts.finishRequest(req, websocket);
      } else {
        req.end();
      }
    }
    function emitErrorAndClose(websocket, err) {
      websocket._readyState = WebSocket2.CLOSING;
      websocket._errorEmitted = true;
      websocket.emit("error", err);
      websocket.emitClose();
    }
    function netConnect(options) {
      options.path = options.socketPath;
      return net.connect(options);
    }
    function tlsConnect(options) {
      options.path = void 0;
      if (!options.servername && options.servername !== "") {
        options.servername = net.isIP(options.host) ? "" : options.host;
      }
      return tls.connect(options);
    }
    function abortHandshake(websocket, stream, message) {
      websocket._readyState = WebSocket2.CLOSING;
      const err = new Error(message);
      Error.captureStackTrace(err, abortHandshake);
      if (stream.setHeader) {
        stream[kAborted] = true;
        stream.abort();
        if (stream.socket && !stream.socket.destroyed) {
          stream.socket.destroy();
        }
        process.nextTick(emitErrorAndClose, websocket, err);
      } else {
        stream.destroy(err);
        stream.once("error", websocket.emit.bind(websocket, "error"));
        stream.once("close", websocket.emitClose.bind(websocket));
      }
    }
    function sendAfterClose(websocket, data, cb) {
      if (data) {
        const length = isBlob(data) ? data.size : toBuffer(data).length;
        if (websocket._socket) websocket._sender._bufferedBytes += length;
        else websocket._bufferedAmount += length;
      }
      if (cb) {
        const err = new Error(
          `WebSocket is not open: readyState ${websocket.readyState} (${readyStates[websocket.readyState]})`
        );
        process.nextTick(cb, err);
      }
    }
    function receiverOnConclude(code, reason) {
      const websocket = this[kWebSocket];
      websocket._closeFrameReceived = true;
      websocket._closeMessage = reason;
      websocket._closeCode = code;
      if (websocket._socket[kWebSocket] === void 0) return;
      websocket._socket.removeListener("data", socketOnData);
      process.nextTick(resume, websocket._socket);
      if (code === 1005) websocket.close();
      else websocket.close(code, reason);
    }
    function receiverOnDrain() {
      const websocket = this[kWebSocket];
      if (!websocket.isPaused) websocket._socket.resume();
    }
    function receiverOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket._socket[kWebSocket] !== void 0) {
        websocket._socket.removeListener("data", socketOnData);
        process.nextTick(resume, websocket._socket);
        websocket.close(err[kStatusCode]);
      }
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function receiverOnFinish() {
      this[kWebSocket].emitClose();
    }
    function receiverOnMessage(data, isBinary) {
      this[kWebSocket].emit("message", data, isBinary);
    }
    function receiverOnPing(data) {
      const websocket = this[kWebSocket];
      if (websocket._autoPong) websocket.pong(data, !this._isServer, NOOP);
      websocket.emit("ping", data);
    }
    function receiverOnPong(data) {
      this[kWebSocket].emit("pong", data);
    }
    function resume(stream) {
      stream.resume();
    }
    function senderOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket.readyState === WebSocket2.CLOSED) return;
      if (websocket.readyState === WebSocket2.OPEN) {
        websocket._readyState = WebSocket2.CLOSING;
        setCloseTimer(websocket);
      }
      this._socket.end();
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function setCloseTimer(websocket) {
      websocket._closeTimer = setTimeout(
        websocket._socket.destroy.bind(websocket._socket),
        websocket._closeTimeout
      );
    }
    function socketOnClose() {
      const websocket = this[kWebSocket];
      this.removeListener("close", socketOnClose);
      this.removeListener("data", socketOnData);
      this.removeListener("end", socketOnEnd);
      websocket._readyState = WebSocket2.CLOSING;
      if (!this._readableState.endEmitted && !websocket._closeFrameReceived && !websocket._receiver._writableState.errorEmitted && this._readableState.length !== 0) {
        const chunk = this.read(this._readableState.length);
        websocket._receiver.write(chunk);
      }
      websocket._receiver.end();
      this[kWebSocket] = void 0;
      clearTimeout(websocket._closeTimer);
      if (websocket._receiver._writableState.finished || websocket._receiver._writableState.errorEmitted) {
        websocket.emitClose();
      } else {
        websocket._receiver.on("error", receiverOnFinish);
        websocket._receiver.on("finish", receiverOnFinish);
      }
    }
    function socketOnData(chunk) {
      if (!this[kWebSocket]._receiver.write(chunk)) {
        this.pause();
      }
    }
    function socketOnEnd() {
      const websocket = this[kWebSocket];
      websocket._readyState = WebSocket2.CLOSING;
      websocket._receiver.end();
      this.end();
    }
    function socketOnError() {
      const websocket = this[kWebSocket];
      this.removeListener("error", socketOnError);
      this.on("error", NOOP);
      if (websocket) {
        websocket._readyState = WebSocket2.CLOSING;
        this.destroy();
      }
    }
  }
});

// ../../node_modules/ws/lib/stream.js
var require_stream = __commonJS({
  "../../node_modules/ws/lib/stream.js"(exports, module) {
    "use strict";
    var WebSocket2 = require_websocket();
    var { Duplex } = __require("stream");
    function emitClose(stream) {
      stream.emit("close");
    }
    function duplexOnEnd() {
      if (!this.destroyed && this._writableState.finished) {
        this.destroy();
      }
    }
    function duplexOnError(err) {
      this.removeListener("error", duplexOnError);
      this.destroy();
      if (this.listenerCount("error") === 0) {
        this.emit("error", err);
      }
    }
    function createWebSocketStream2(ws, options) {
      let terminateOnDestroy = true;
      const duplex = new Duplex({
        ...options,
        autoDestroy: false,
        emitClose: false,
        objectMode: false,
        writableObjectMode: false
      });
      ws.on("message", function message(msg, isBinary) {
        const data = !isBinary && duplex._readableState.objectMode ? msg.toString() : msg;
        if (!duplex.push(data)) ws.pause();
      });
      ws.once("error", function error(err) {
        if (duplex.destroyed) return;
        terminateOnDestroy = false;
        duplex.destroy(err);
      });
      ws.once("close", function close() {
        if (duplex.destroyed) return;
        duplex.push(null);
      });
      duplex._destroy = function(err, callback) {
        if (ws.readyState === ws.CLOSED) {
          callback(err);
          process.nextTick(emitClose, duplex);
          return;
        }
        let called = false;
        ws.once("error", function error(err2) {
          called = true;
          callback(err2);
        });
        ws.once("close", function close() {
          if (!called) callback(err);
          process.nextTick(emitClose, duplex);
        });
        if (terminateOnDestroy) ws.terminate();
      };
      duplex._final = function(callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open() {
            duplex._final(callback);
          });
          return;
        }
        if (ws._socket === null) return;
        if (ws._socket._writableState.finished) {
          callback();
          if (duplex._readableState.endEmitted) duplex.destroy();
        } else {
          ws._socket.once("finish", function finish() {
            callback();
          });
          ws.close();
        }
      };
      duplex._read = function() {
        if (ws.isPaused) ws.resume();
      };
      duplex._write = function(chunk, encoding, callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open() {
            duplex._write(chunk, encoding, callback);
          });
          return;
        }
        ws.send(chunk, callback);
      };
      duplex.on("end", duplexOnEnd);
      duplex.on("error", duplexOnError);
      return duplex;
    }
    module.exports = createWebSocketStream2;
  }
});

// ../../node_modules/ws/lib/subprotocol.js
var require_subprotocol = __commonJS({
  "../../node_modules/ws/lib/subprotocol.js"(exports, module) {
    "use strict";
    var { tokenChars } = require_validation();
    function parse(header) {
      const protocols = /* @__PURE__ */ new Set();
      let start = -1;
      let end = -1;
      let i = 0;
      for (i; i < header.length; i++) {
        const code = header.charCodeAt(i);
        if (end === -1 && tokenChars[code] === 1) {
          if (start === -1) start = i;
        } else if (i !== 0 && (code === 32 || code === 9)) {
          if (end === -1 && start !== -1) end = i;
        } else if (code === 44) {
          if (start === -1) {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
          if (end === -1) end = i;
          const protocol2 = header.slice(start, end);
          if (protocols.has(protocol2)) {
            throw new SyntaxError(`The "${protocol2}" subprotocol is duplicated`);
          }
          protocols.add(protocol2);
          start = end = -1;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      }
      if (start === -1 || end !== -1) {
        throw new SyntaxError("Unexpected end of input");
      }
      const protocol = header.slice(start, i);
      if (protocols.has(protocol)) {
        throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
      }
      protocols.add(protocol);
      return protocols;
    }
    module.exports = { parse };
  }
});

// ../../node_modules/ws/lib/websocket-server.js
var require_websocket_server = __commonJS({
  "../../node_modules/ws/lib/websocket-server.js"(exports, module) {
    "use strict";
    var EventEmitter = __require("events");
    var http = __require("http");
    var { Duplex } = __require("stream");
    var { createHash: createHash2 } = __require("crypto");
    var extension2 = require_extension();
    var PerMessageDeflate2 = require_permessage_deflate();
    var subprotocol2 = require_subprotocol();
    var WebSocket2 = require_websocket();
    var { CLOSE_TIMEOUT, GUID, kWebSocket } = require_constants();
    var keyRegex = /^[+/0-9A-Za-z]{22}==$/;
    var RUNNING = 0;
    var CLOSING = 1;
    var CLOSED = 2;
    var WebSocketServer2 = class extends EventEmitter {
      /**
       * Create a `WebSocketServer` instance.
       *
       * @param {Object} options Configuration options
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Boolean} [options.autoPong=true] Specifies whether or not to
       *     automatically send a pong in response to a ping
       * @param {Number} [options.backlog=511] The maximum length of the queue of
       *     pending connections
       * @param {Boolean} [options.clientTracking=true] Specifies whether or not to
       *     track clients
       * @param {Number} [options.closeTimeout=30000] Duration in milliseconds to
       *     wait for the closing handshake to finish after `websocket.close()` is
       *     called
       * @param {Function} [options.handleProtocols] A hook to handle protocols
       * @param {String} [options.host] The hostname where to bind the server
       * @param {Number} [options.maxBufferedChunks=262144] The maximum number of
       *     buffered data chunks
       * @param {Number} [options.maxFragments=16384] The maximum number of message
       *     fragments
       * @param {Number} [options.maxPayload=104857600] The maximum allowed message
       *     size
       * @param {Boolean} [options.noServer=false] Enable no server mode
       * @param {String} [options.path] Accept only connections matching this path
       * @param {(Boolean|Object)} [options.perMessageDeflate=false] Enable/disable
       *     permessage-deflate
       * @param {Number} [options.port] The port where to bind the server
       * @param {(http.Server|https.Server)} [options.server] A pre-created HTTP/S
       *     server to use
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @param {Function} [options.verifyClient] A hook to reject connections
       * @param {Function} [options.WebSocket=WebSocket] Specifies the `WebSocket`
       *     class to use. It must be the `WebSocket` class or class that extends it
       * @param {Function} [callback] A listener for the `listening` event
       */
      constructor(options, callback) {
        super();
        options = {
          allowSynchronousEvents: true,
          autoPong: true,
          maxBufferedChunks: 256 * 1024,
          maxFragments: 16 * 1024,
          maxPayload: 100 * 1024 * 1024,
          skipUTF8Validation: false,
          perMessageDeflate: false,
          handleProtocols: null,
          clientTracking: true,
          closeTimeout: CLOSE_TIMEOUT,
          verifyClient: null,
          noServer: false,
          backlog: null,
          // use default (511 as implemented in net.js)
          server: null,
          host: null,
          path: null,
          port: null,
          WebSocket: WebSocket2,
          ...options
        };
        if (options.port == null && !options.server && !options.noServer || options.port != null && (options.server || options.noServer) || options.server && options.noServer) {
          throw new TypeError(
            'One and only one of the "port", "server", or "noServer" options must be specified'
          );
        }
        if (options.port != null) {
          this._server = http.createServer((req, res) => {
            const body = http.STATUS_CODES[426];
            res.writeHead(426, {
              "Content-Length": body.length,
              "Content-Type": "text/plain"
            });
            res.end(body);
          });
          this._server.listen(
            options.port,
            options.host,
            options.backlog,
            callback
          );
        } else if (options.server) {
          this._server = options.server;
        }
        if (this._server) {
          const emitConnection = this.emit.bind(this, "connection");
          this._removeListeners = addListeners(this._server, {
            listening: this.emit.bind(this, "listening"),
            error: this.emit.bind(this, "error"),
            upgrade: (req, socket, head) => {
              this.handleUpgrade(req, socket, head, emitConnection);
            }
          });
        }
        if (options.perMessageDeflate === true) options.perMessageDeflate = {};
        if (options.clientTracking) {
          this.clients = /* @__PURE__ */ new Set();
          this._shouldEmitClose = false;
        }
        this.options = options;
        this._state = RUNNING;
      }
      /**
       * Returns the bound address, the address family name, and port of the server
       * as reported by the operating system if listening on an IP socket.
       * If the server is listening on a pipe or UNIX domain socket, the name is
       * returned as a string.
       *
       * @return {(Object|String|null)} The address of the server
       * @public
       */
      address() {
        if (this.options.noServer) {
          throw new Error('The server is operating in "noServer" mode');
        }
        if (!this._server) return null;
        return this._server.address();
      }
      /**
       * Stop the server from accepting new connections and emit the `'close'` event
       * when all existing connections are closed.
       *
       * @param {Function} [cb] A one-time listener for the `'close'` event
       * @public
       */
      close(cb) {
        if (this._state === CLOSED) {
          if (cb) {
            this.once("close", () => {
              cb(new Error("The server is not running"));
            });
          }
          process.nextTick(emitClose, this);
          return;
        }
        if (cb) this.once("close", cb);
        if (this._state === CLOSING) return;
        this._state = CLOSING;
        if (this.options.noServer || this.options.server) {
          if (this._server) {
            this._removeListeners();
            this._removeListeners = this._server = null;
          }
          if (this.clients) {
            if (!this.clients.size) {
              process.nextTick(emitClose, this);
            } else {
              this._shouldEmitClose = true;
            }
          } else {
            process.nextTick(emitClose, this);
          }
        } else {
          const server2 = this._server;
          this._removeListeners();
          this._removeListeners = this._server = null;
          server2.close(() => {
            emitClose(this);
          });
        }
      }
      /**
       * See if a given request should be handled by this server instance.
       *
       * @param {http.IncomingMessage} req Request object to inspect
       * @return {Boolean} `true` if the request is valid, else `false`
       * @public
       */
      shouldHandle(req) {
        if (this.options.path) {
          const index = req.url.indexOf("?");
          const pathname = index !== -1 ? req.url.slice(0, index) : req.url;
          if (pathname !== this.options.path) return false;
        }
        return true;
      }
      /**
       * Handle a HTTP Upgrade request.
       *
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @public
       */
      handleUpgrade(req, socket, head, cb) {
        socket.on("error", socketOnError);
        const key = req.headers["sec-websocket-key"];
        const upgrade = req.headers.upgrade;
        const version = +req.headers["sec-websocket-version"];
        if (req.method !== "GET") {
          const message = "Invalid HTTP method";
          abortHandshakeOrEmitwsClientError(this, req, socket, 405, message);
          return;
        }
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          const message = "Invalid Upgrade header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (key === void 0 || !keyRegex.test(key)) {
          const message = "Missing or invalid Sec-WebSocket-Key header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (version !== 13 && version !== 8) {
          const message = "Missing or invalid Sec-WebSocket-Version header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message, {
            "Sec-WebSocket-Version": "13, 8"
          });
          return;
        }
        if (!this.shouldHandle(req)) {
          abortHandshake(socket, 400);
          return;
        }
        const secWebSocketProtocol = req.headers["sec-websocket-protocol"];
        let protocols = /* @__PURE__ */ new Set();
        if (secWebSocketProtocol !== void 0) {
          try {
            protocols = subprotocol2.parse(secWebSocketProtocol);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Protocol header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        const secWebSocketExtensions = req.headers["sec-websocket-extensions"];
        const extensions = {};
        if (this.options.perMessageDeflate && secWebSocketExtensions !== void 0) {
          const perMessageDeflate = new PerMessageDeflate2({
            ...this.options.perMessageDeflate,
            isServer: true,
            maxPayload: this.options.maxPayload
          });
          try {
            const offers = extension2.parse(secWebSocketExtensions);
            if (offers[PerMessageDeflate2.extensionName]) {
              perMessageDeflate.accept(offers[PerMessageDeflate2.extensionName]);
              extensions[PerMessageDeflate2.extensionName] = perMessageDeflate;
            }
          } catch (err) {
            const message = "Invalid or unacceptable Sec-WebSocket-Extensions header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        if (this.options.verifyClient) {
          const info = {
            origin: req.headers[`${version === 8 ? "sec-websocket-origin" : "origin"}`],
            secure: !!(req.socket.authorized || req.socket.encrypted),
            req
          };
          if (this.options.verifyClient.length === 2) {
            this.options.verifyClient(info, (verified, code, message, headers) => {
              if (!verified) {
                return abortHandshake(socket, code || 401, message, headers);
              }
              this.completeUpgrade(
                extensions,
                key,
                protocols,
                req,
                socket,
                head,
                cb
              );
            });
            return;
          }
          if (!this.options.verifyClient(info)) return abortHandshake(socket, 401);
        }
        this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
      }
      /**
       * Upgrade the connection to WebSocket.
       *
       * @param {Object} extensions The accepted extensions
       * @param {String} key The value of the `Sec-WebSocket-Key` header
       * @param {Set} protocols The subprotocols
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @throws {Error} If called more than once with the same socket
       * @private
       */
      completeUpgrade(extensions, key, protocols, req, socket, head, cb) {
        if (!socket.readable || !socket.writable) return socket.destroy();
        if (socket[kWebSocket]) {
          throw new Error(
            "server.handleUpgrade() was called more than once with the same socket, possibly due to a misconfiguration"
          );
        }
        if (this._state > RUNNING) return abortHandshake(socket, 503);
        const digest = createHash2("sha1").update(key + GUID).digest("base64");
        const headers = [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${digest}`
        ];
        const ws = new this.options.WebSocket(null, void 0, this.options);
        if (protocols.size) {
          const protocol = this.options.handleProtocols ? this.options.handleProtocols(protocols, req) : protocols.values().next().value;
          if (protocol) {
            headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
            ws._protocol = protocol;
          }
        }
        if (extensions[PerMessageDeflate2.extensionName]) {
          const params = extensions[PerMessageDeflate2.extensionName].params;
          const value = extension2.format({
            [PerMessageDeflate2.extensionName]: [params]
          });
          headers.push(`Sec-WebSocket-Extensions: ${value}`);
          ws._extensions = extensions;
        }
        this.emit("headers", headers, req);
        socket.write(headers.concat("\r\n").join("\r\n"));
        socket.removeListener("error", socketOnError);
        ws.setSocket(socket, head, {
          allowSynchronousEvents: this.options.allowSynchronousEvents,
          maxBufferedChunks: this.options.maxBufferedChunks,
          maxFragments: this.options.maxFragments,
          maxPayload: this.options.maxPayload,
          skipUTF8Validation: this.options.skipUTF8Validation
        });
        if (this.clients) {
          this.clients.add(ws);
          ws.on("close", () => {
            this.clients.delete(ws);
            if (this._shouldEmitClose && !this.clients.size) {
              process.nextTick(emitClose, this);
            }
          });
        }
        cb(ws, req);
      }
    };
    module.exports = WebSocketServer2;
    function addListeners(server2, map) {
      for (const event of Object.keys(map)) server2.on(event, map[event]);
      return function removeListeners() {
        for (const event of Object.keys(map)) {
          server2.removeListener(event, map[event]);
        }
      };
    }
    function emitClose(server2) {
      server2._state = CLOSED;
      server2.emit("close");
    }
    function socketOnError() {
      this.destroy();
    }
    function abortHandshake(socket, code, message, headers) {
      message = message || http.STATUS_CODES[code];
      headers = {
        Connection: "close",
        "Content-Type": "text/html",
        "Content-Length": Buffer.byteLength(message),
        ...headers
      };
      socket.once("finish", socket.destroy);
      socket.end(
        `HTTP/1.1 ${code} ${http.STATUS_CODES[code]}\r
` + Object.keys(headers).map((h) => `${h}: ${headers[h]}`).join("\r\n") + "\r\n\r\n" + message
      );
    }
    function abortHandshakeOrEmitwsClientError(server2, req, socket, code, message, headers) {
      if (server2.listenerCount("wsClientError")) {
        const err = new Error(message);
        Error.captureStackTrace(err, abortHandshakeOrEmitwsClientError);
        server2.emit("wsClientError", err, socket, req);
      } else {
        abortHandshake(socket, code, message, headers);
      }
    }
  }
});

// ../../src/bridge/server.mjs
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join as join2 } from "node:path";

// ../../src/bridge/platform.mjs
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
var CDP_HOST = "127.0.0.1";
var DEFAULT_CDP_PORT = 9222;
var CDP_ARGUMENTS = Object.freeze([
  `--remote-debugging-address=${CDP_HOST}`,
  `--remote-debugging-port=${DEFAULT_CDP_PORT}`,
  `--remote-allow-origins=http://${CDP_HOST}:${DEFAULT_CDP_PORT}`
]);
var WINDOWS_PROCESS_COMMAND = String.raw`
$ErrorActionPreference = 'Stop'
$listenerOwners = @{}
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalAddress -eq '127.0.0.1' } |
  ForEach-Object { $listenerOwners[('{0}:{1}' -f $_.LocalPort, $_.OwningProcess)] = $true }
$rows = Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like '*--remote-debugging-address=127.0.0.1*' } |
  ForEach-Object {
    $portMatch = [regex]::Match([string]$_.CommandLine, '--remote-debugging-port(?:=|\s+)(\d+)')
    $debugPort = if ($portMatch.Success) { [int]$portMatch.Groups[1].Value } else { 0 }
    [pscustomobject]@{
      processId = [int]$_.ProcessId
      executable = [string]$_.ExecutablePath
      commandLine = [string]$_.CommandLine
      ownsDebugPort = $debugPort -gt 0 -and $listenerOwners.ContainsKey(('{0}:{1}' -f $debugPort, $_.ProcessId))
    }
  }
@($rows) | ConvertTo-Json -Compress
`;
var WINDOWS_PACKAGE_COMMAND = String.raw`
$ErrorActionPreference = 'Stop'
$rows = foreach ($name in @('OpenAI.Codex', 'OpenAI.CodexBeta')) {
  $package = Get-AppxPackage -Name $name | Sort-Object Version -Descending | Select-Object -First 1
  if (-not $package) { continue }
  $app = Join-Path $package.InstallLocation 'app'
  $names = if ($name -eq 'OpenAI.CodexBeta') {
    @('ChatGPT (Beta).exe', 'Codex (Beta).exe', 'ChatGPT.exe')
  } else {
    @('ChatGPT.exe', 'Codex.exe')
  }
  foreach ($file in $names) {
    $candidate = Join-Path $app $file
    if (Test-Path -LiteralPath $candidate) {
      [pscustomobject]@{
        channel = if ($name -eq 'OpenAI.CodexBeta') { 'beta' } else { 'stable' }
        packageName = $name
        packageFullName = $package.PackageFullName
        executable = $candidate
      }
      break
    }
  }
}
@($rows) | ConvertTo-Json -Compress
`;
var WINDOWS_STOP_EXECUTABLE_COMMAND = String.raw`
$ErrorActionPreference = 'Stop'
$target = $env:CODEX_BRIDGE_TARGET_EXECUTABLE
$processes = @(Get-CimInstance Win32_Process |
  Where-Object {
    $_.ExecutablePath -eq $target -and
    $_.CommandLine -notlike '*--type=*' -and
    $_.CommandLine -notlike '*crashpad-handler*'
  })
foreach ($process in $processes) { Stop-Process -Id $process.ProcessId -ErrorAction Stop }
foreach ($process in $processes) { Wait-Process -Id $process.ProcessId -Timeout 8 -ErrorAction SilentlyContinue }
`;
function powershellArgs(command, extra = []) {
  return [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-WindowStyle",
    "Hidden",
    "-Command",
    command,
    ...extra
  ];
}
function powershellOptions(options = {}) {
  return { ...options, windowsHide: true };
}
function processChannel(executable, commandLine) {
  const identity = `${executable || ""} ${commandLine || ""}`.toLowerCase();
  return /codexbeta|chatgpt\s*\(beta\)|codex\s*\(beta\)/.test(identity) ? "beta" : "stable";
}
function debugProcessesFromCommandLines(text) {
  const source = String(text || "").trim();
  let rows = [];
  if (source.startsWith("[") || source.startsWith("{")) {
    try {
      const parsed = JSON.parse(source);
      rows = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
    }
  }
  if (rows.length === 0) {
    rows = source.split(/\r?\n/).filter(Boolean).map((commandLine) => ({ commandLine }));
  }
  return rows.flatMap((row) => {
    const commandLine = String(row?.commandLine || "");
    if (!commandLine.includes("--remote-debugging-address=127.0.0.1")) return [];
    if (commandLine.includes("--type=")) return [];
    const port = Number(commandLine.match(/--remote-debugging-port(?:=|\s+)(\d+)/)?.[1]);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return [];
    const processId = Number(row?.processId);
    const executable = typeof row?.executable === "string" ? row.executable : null;
    return [{
      port,
      processId: Number.isInteger(processId) && processId > 0 ? processId : null,
      executable,
      channel: processChannel(executable, commandLine),
      ownsDebugPort: row?.ownsDebugPort === true
    }];
  });
}
async function fetchJson(url, timeout = 1200, fetchImpl = fetch) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}
async function processCommandLines(platform, execute) {
  if (platform === "win32") {
    return (await execute(
      "powershell.exe",
      powershellArgs(WINDOWS_PROCESS_COMMAND),
      powershellOptions({ timeout: 4e3 })
    )).stdout;
  }
  if (platform === "darwin") {
    return (await execute("/bin/ps", ["-axo", "command="], { timeout: 4e3 })).stdout;
  }
  return "";
}
async function discoverDebugEndpoint({
  platform = process.platform,
  execute = execFileAsync,
  fetchImpl = fetch,
  preferredPort = DEFAULT_CDP_PORT
} = {}) {
  let processes = [];
  try {
    processes = debugProcessesFromCommandLines(await processCommandLines(platform, execute));
  } catch {
  }
  const candidates = [preferredPort, ...processes.map((item) => item.port)];
  for (const port of [...new Set(candidates)]) {
    try {
      await fetchJson(`http://${CDP_HOST}:${port}/json/version`, 500, fetchImpl);
      const process2 = processes.find((item) => item.port === port && item.ownsDebugPort) ?? processes.find((item) => item.port === port);
      return {
        port,
        processId: process2?.processId ?? null,
        executable: process2?.executable ?? null,
        channel: process2?.channel ?? null
      };
    } catch {
    }
  }
  throw new Error("Codex is not running with the local debug bridge");
}
async function focusCodex({
  platform = process.platform,
  execute = execFileAsync,
  processId = null,
  activateWindows = null
} = {}) {
  if (platform === "win32") {
    const activate = activateWindows ?? (await Promise.resolve().then(() => (init_windows_focus(), windows_focus_exports))).activateWindowsProcess;
    return activate(processId);
  }
  if (platform === "darwin") {
    await execute("/usr/bin/open", ["-b", "com.openai.codex"], { timeout: 3e3 });
    return;
  }
  throw new Error(`Codex Desktop focus is not supported on ${platform}`);
}

// ../../node_modules/ws/wrapper.mjs
var import_stream = __toESM(require_stream(), 1);
var import_extension = __toESM(require_extension(), 1);
var import_permessage_deflate = __toESM(require_permessage_deflate(), 1);
var import_receiver = __toESM(require_receiver(), 1);
var import_sender = __toESM(require_sender(), 1);
var import_subprotocol = __toESM(require_subprotocol(), 1);
var import_websocket = __toESM(require_websocket(), 1);
var import_websocket_server = __toESM(require_websocket_server(), 1);
var wrapper_default = import_websocket.default;

// ../../src/bridge/thread-key.mjs
var UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
var THREAD_KEY_PATTERN = new RegExp(
  `^(?:${UUID_PATTERN}|client-new-thread:${UUID_PATTERN})$`,
  "i"
);
function validateThreadId(value) {
  const normalized = String(value ?? "").replace(/^local:/, "");
  if (!THREAD_KEY_PATTERN.test(normalized)) {
    throw new Error("Invalid Codex thread id");
  }
  return normalized;
}
function decodeThreadPathSegment(segment) {
  let decoded;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    throw new Error("Invalid encoded Codex thread id");
  }
  return validateThreadId(decoded);
}
function localThreadKey(value) {
  return `local:${validateThreadId(value)}`;
}

// ../../src/bridge/codex-cdp.mjs
var USAGE_REFRESH_MS = Math.max(
  15e3,
  Number(process.env.CODEX_KEYBOARD_USAGE_REFRESH_SECONDS || 600) * 1e3
);
var DEVICE_STATE = {
  type: "codex-micro-device-state-changed",
  state: { status: "connected", error: null, battery: { percentage: 100, isCharging: true } }
};
var MICRO_ACTION_KEYS = Object.freeze({
  fast: "ACT06",
  approve: "ACT07",
  reject: "ACT08",
  fork: "ACT09",
  mic: "ACT10",
  submit: "ACT12"
});
var MODEL_PRESETS = Object.freeze({
  "model-sol-high": Object.freeze({ model: "gpt-5.6-sol", displayName: "5.6 Sol", effort: "high" }),
  "model-luna-max": Object.freeze({ model: "gpt-5.6-luna", displayName: "5.6 Luna", effort: "max" }),
  "model-sol-medium": Object.freeze({ model: "gpt-5.6-sol", displayName: "5.6 Sol", effort: "medium" })
});
var RENDERER_ACTIONS = /* @__PURE__ */ new Set(["pin", "new", ...Object.keys(MODEL_PRESETS)]);
var PIN_ACTION_LABELS = Object.freeze([
  "Pin chat",
  "Unpin chat",
  "\u7F6E\u9876\u804A\u5929",
  "\u53D6\u6D88\u7F6E\u9876\u804A\u5929",
  "\u91D8\u9078\u804A\u5929",
  "\u53D6\u6D88\u91D8\u9078\u804A\u5929"
]);
var NEW_ACTION_LABELS = Object.freeze([
  "New task",
  "New chat",
  "New conversation",
  "\u65B0\u5BF9\u8BDD",
  "\u65B0\u5C0D\u8A71",
  "\u65B0\u5EFA\u4EFB\u52A1",
  "\u65B0\u5EFA\u804A\u5929",
  "\u65B0\u589E\u4EFB\u52D9",
  "\u65B0\u589E\u804A\u5929"
]);
var STEER_ACTION_LABELS = Object.freeze([
  "Steer",
  "\u8C03\u6574\u65B9\u5411",
  "\u8ABF\u6574\u65B9\u5411",
  "\u5F15\u5C0E"
]);
function rendererActionExpression(action) {
  return `(() => {
    const action = ${JSON.stringify(action)};
    const visible = (element) => element && element.offsetParent !== null;
    let target = null;
    if (action === "pin") {
      const active = document.querySelector(
        "[data-app-action-sidebar-thread-active=true]"
      ) ?? document.querySelector(
        "[data-app-action-sidebar-thread-id][aria-current=page]"
      );
      const labels = new Set(${JSON.stringify(PIN_ACTION_LABELS)});
      target = active && [...active.querySelectorAll("button")].find(
        (button) => visible(button) && labels.has(button.getAttribute("aria-label"))
      );
    } else if (action === "new") {
      const sidebarAnchor = document.querySelector(
        "[data-app-action-sidebar-project-create]"
      ) ?? document.querySelector("[data-app-action-sidebar-thread-id]");
      const sidebar = sidebarAnchor?.closest("nav");
      const structuralCandidates = [...(
        sidebar?.querySelectorAll(
          ".sidebar-item.relative > button.sidebar-item"
        ) ?? []
      )].filter(visible);
      if (structuralCandidates.length === 1) {
        target = structuralCandidates[0];
      } else {
        const labels = new Set(${JSON.stringify(NEW_ACTION_LABELS)});
        const buttons = [...document.querySelectorAll("button")].filter(visible);
        target = buttons.find((button) => [
          button.getAttribute("aria-label"),
          button.getAttribute("title"),
          (button.innerText || "").trim()
        ].some((label) => labels.has(label)));
      }
    }
    if (!target) return false;
    target.click();
    return true;
  })()`;
}
function composerSteerExpression() {
  return `(() => {
    const editor = [...document.querySelectorAll('[contenteditable="true"][role="textbox"]')]
      .find((element) => element.offsetParent !== null);
    if (!editor) throw new Error("Codex composer is not available");
    editor.focus();
    const labels = new Set(${JSON.stringify(STEER_ACTION_LABELS)});
    const steer = [...document.querySelectorAll('button')]
      .find((element) =>
        element.offsetParent !== null && [
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          (element.innerText || "").trim()
        ].some((label) => labels.has(label))
      );
    if (!steer) return false;
    steer.click();
    return true;
  })()`;
}
var ENABLE_EXPRESSION = `(async () => {
  const gateName = "3207467860";
  const statsig = globalThis.__STATSIG__;
  const clients = [...new Set([statsig?.firstInstance, ...Object.values(statsig?.instances ?? {})].filter(Boolean))];
  for (const client of clients) {
    if (client.overrideAdapter?.__codexKeyboardGate !== gateName) {
      const original = client.overrideAdapter ?? {};
      client.overrideAdapter = new Proxy(original, {
        get(target, property) {
          if (property === "__codexKeyboardGate") return gateName;
          if (property === "getGateOverride") return (gate, user, options) => {
            if (gate?.name === gateName) return { ...gate, value: true };
            const fallback = Reflect.get(target, property, target);
            return typeof fallback === "function" ? fallback.call(target, gate, user, options) : gate;
          };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
    }
    client._memoCache = {};
    client.$emt?.({ name: "values_updated" });
  }
  const urls = [...new Set([
    ...[...document.querySelectorAll("link[href],script[src]")].map((el) => el.href || el.src),
    ...performance.getEntriesByType("resource").map((entry) => entry.name)
  ])].filter((url) => url.includes("/assets/") && url.endsWith(".js"));
  for (const url of urls.filter((url) => /vscode-api|codex-micro|app-initial/.test(url)).slice(0, 120)) {
    try {
      const namespace = await import(url);
      const bus = Object.values(namespace).find((candidate) =>
        candidate && typeof candidate === "object" &&
        candidate.handlers instanceof Map &&
        (typeof candidate.dispatchHostMessage === "function" || typeof candidate.dispatchMessage === "function")
      );
      if (!bus) continue;
      globalThis[Symbol.for("codex-keyboard-micro-bus")] = bus;
      const dispatch = bus.dispatchHostMessage ?? bus.dispatchMessage;
      dispatch.call(bus, ${JSON.stringify(DEVICE_STATE)});
      return { ready: true, clients: clients.length };
    } catch {}
  }
  return { ready: clients.length > 0, clients: clients.length };
})()`;
var SNAPSHOT_EXPRESSION = `(async () => {
  const startedAt = performance.now();
  const root = document.getElementById("root");
  const reactKey = root && Object.getOwnPropertyNames(root).find((key) => key.startsWith("__reactContainer$"));
  if (!root || !reactKey) throw new Error("Codex React root was not found");
  const sourceKey = Symbol.for("codex-keyboard-micro-snapshot-source");
  const validSlots = (slots) =>
    Array.isArray(slots) && slots.length === 6 &&
    slots.every((slot, index) => slot?.id === index);
  const readSource = (source) => {
    if (!source || source.root !== root || !source.node?.store) {
      throw new Error("Cached Codex Micro source is stale");
    }
    const slots = source.node.store.get(
      source.resolver.resolve(source.node, source.contextMap)
    );
    if (!validSlots(slots)) throw new Error("Cached Codex Micro slots are stale");
    return slots;
  };

  let source = globalThis[sourceKey];
  let found = null;
  let queryClients = new Set();
  let cacheHit = false;
  if (source) {
    try {
      found = readSource(source);
      queryClients = new Set(source.queryClients ?? []);
      cacheHit = true;
    } catch {
      delete globalThis[sourceKey];
      source = null;
    }
  }

  if (!found) {
    const urls = [...new Set([
      ...[...document.querySelectorAll("link[href],script[src]")].map((el) => el.href || el.src),
      ...performance.getEntriesByType("resource").map((entry) => entry.name)
    ])].filter((url) => url.includes("/assets/") && url.endsWith(".js"));
    const slotSignalsUrl = urls.find((url) => url.includes("/assets/codex-micro-slot-signals-"));
    if (!slotSignalsUrl) throw new Error("Codex Micro slot signals are not loaded");

    const namespaces = [];
    for (const url of urls) {
      try { namespaces.push(await import(url)); } catch {}
    }
    const exportedValues = namespaces.flatMap((namespace) => Object.values(namespace));
    const bus = exportedValues.find((candidate) =>
      candidate && typeof candidate === "object" && candidate.handlers instanceof Map &&
      (typeof candidate.dispatchHostMessage === "function" || typeof candidate.dispatchMessage === "function")
    );
    if (bus) {
      globalThis[Symbol.for("codex-keyboard-micro-bus")] = bus;
      if ((bus.handlers.get("codex-micro-hid-event")?.size ?? 0) === 0) {
        (bus.dispatchHostMessage ?? bus.dispatchMessage).call(bus, ${JSON.stringify(DEVICE_STATE)});
      }
    }

    const signals = await import(slotSignalsUrl);
    const resolvers = Object.values(signals).filter((candidate) =>
      candidate && typeof candidate === "object" &&
      typeof candidate.resolve === "function" && typeof candidate.createSubscriberAtom === "function"
    );
    const queue = [root[reactKey]];
    const seen = new Set();
    queryClients = new Set();
    while (queue.length && seen.size < 30000 && !found) {
      const fiber = queue.pop();
      if (!fiber || seen.has(fiber)) continue;
      seen.add(fiber);
      const values = [fiber.memoizedProps?.value];
      let dependency = fiber.dependencies?.firstContext;
      while (dependency) { values.push(dependency.memoizedValue); dependency = dependency.next; }
      for (const value of values) {
        if (
          value && typeof value.getQueryCache === "function" &&
          typeof value.getQueryData === "function"
        ) queryClients.add(value);
        if (!(value instanceof Map)) continue;
        for (const node of value.values()) {
          if (!node?.store || typeof node.store.get !== "function") continue;
          for (const resolver of resolvers) {
            try {
              const slots = node.store.get(resolver.resolve(node, value));
              if (validSlots(slots)) {
                found = slots;
                source = {
                  root,
                  node,
                  resolver,
                  contextMap: value,
                  queryClients: [...queryClients]
                };
                globalThis[sourceKey] = source;
                break;
              }
            } catch {}
          }
          if (found) break;
        }
        if (found) break;
      }
      queue.push(fiber.child, fiber.sibling);
    }
    if (!found) throw new Error("Codex Micro slot store was not found");
  }
  let usage = null;
  for (const queryClient of queryClients) {
    try {
      const query = queryClient.getQueryCache().getAll().find((candidate) =>
        JSON.stringify(candidate.queryKey) === '["rate-limit-status"]'
      );
      const now = Date.now();
      const updatedAt = Number(query?.state?.dataUpdatedAt) || 0;
      const refreshKey = Symbol.for("codex-keyboard-rate-limit-refresh-at");
      const lastAttempt = Number(globalThis[refreshKey]) || 0;
      if (
        query && typeof query.fetch === "function" &&
        now - updatedAt >= ${USAGE_REFRESH_MS} && now - lastAttempt >= ${USAGE_REFRESH_MS}
      ) {
        globalThis[refreshKey] = now;
        try { Promise.resolve(query.fetch()).catch(() => {}); } catch {}
      }
      const data = query?.state?.data;
      const rateLimit = data?.rate_limit;
      if (!rateLimit || typeof rateLimit !== "object") continue;
      const normalizeWindow = (window, role) => {
        if (!window || typeof window !== "object") return null;
        const usedPercent = Number(window.used_percent);
        if (!Number.isFinite(usedPercent)) return null;
        const seconds = Number(window.limit_window_seconds);
        const minutes = Number.isFinite(seconds) && seconds > 0 ? seconds / 60 : null;
        const kind = minutes != null && Math.abs(minutes - 300) <= 1 ? "five-hour"
          : minutes != null && Math.abs(minutes - 10080) <= 1 ? "weekly"
            : "other";
        const used = Math.min(100, Math.max(0, usedPercent));
        return {
          id: kind === "other" ? role : kind,
          kind,
          usedPercent: used,
          remainingPercent: 100 - used,
          resetsAt: Number(window.reset_at) || null
        };
      };
      usage = {
        windows: [
          normalizeWindow(rateLimit.primary_window, "primary"),
          normalizeWindow(rateLimit.secondary_window, "secondary")
        ].filter(Boolean),
        observedAt: updatedAt || now
      };
      break;
    } catch {}
  }
  const active = document.querySelector("[data-app-action-sidebar-thread-id][data-app-action-sidebar-thread-active=true]")
    ?? document.querySelector("[data-app-action-sidebar-thread-id][aria-current=page]");
  const activeThreadKey = document.querySelector("[data-above-composer-conversation-id]")
    ?.getAttribute("data-above-composer-conversation-id")
    ?? active?.getAttribute("data-app-action-sidebar-thread-id")
    ?? null;
  const normalizeThreadKey = (value) => String(value ?? "").replace(/^local:/, "");
  return {
    activeThreadKey,
    slots: found.map((slot) => ({
      id: slot.id,
      threadKey: slot.threadKey ?? null,
      title: slot.title ?? slot.thread?.title ?? slot.task?.title ?? null,
      status: slot.status ?? "idle",
      selected: Boolean(slot.selected) || Boolean(
        activeThreadKey && normalizeThreadKey(slot.threadKey) === normalizeThreadKey(activeThreadKey)
      )
    })),
    usage,
    bridgeSnapshot: {
      source: cacheHit ? "cache" : "discovery",
      durationMs: performance.now() - startedAt
    }
  };
})()`;
function selectMainTarget(targets) {
  const pages = targets.filter(
    (target) => target.type === "page" && target.webSocketDebuggerUrl && target.url?.startsWith("app://")
  );
  return pages.find((target) => {
    try {
      return new URL(target.url).pathname === "/index.html" && !new URL(target.url).search;
    } catch {
      return false;
    }
  }) ?? pages.find((target) => !/avatar-overlay|composition-surface/i.test(target.url || ""));
}
function traceErrorCategory(error) {
  const name = String(error?.name || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  if (name.includes("timeout") || message.includes("timed out") || message.includes("timeout")) return "timeout";
  if (message.includes("disconnected") || message.includes("not running")) return "cdp-unavailable";
  if (message.includes("window")) return "focus-failed";
  if (message.includes("menu") || message.includes("model") || message.includes("reasoning")) return "renderer-state";
  return "cdp-operation";
}
async function runTraceStage(trace, stage, operation, fields = {}) {
  const startedAt = performance.now();
  trace?.record("cdp.stage", { stage, outcome: "started", ...fields });
  try {
    const result = await operation();
    trace?.record("cdp.stage", {
      stage,
      outcome: "succeeded",
      durationMs: Math.round(performance.now() - startedAt),
      ...fields
    });
    return result;
  } catch (error) {
    trace?.record("cdp.stage", {
      stage,
      outcome: "failed",
      category: traceErrorCategory(error),
      durationMs: Math.round(performance.now() - startedAt),
      ...fields
    });
    throw error;
  }
}
var CodexCdpClient = class {
  socket = null;
  connectPromise = null;
  connectionGeneration = 0;
  nextId = 0;
  pending = /* @__PURE__ */ new Map();
  lastSnapshot = null;
  connectionIdentity = null;
  modelActionQueue = Promise.resolve();
  modelPickerLayout = null;
  constructor({
    discoverPort = discoverDebugEndpoint,
    fetchTargets = fetchJson,
    createSocket = (url) => new wrapper_default(url)
  } = {}) {
    this.discoverPort = discoverPort;
    this.fetchTargets = fetchTargets;
    this.createSocket = createSocket;
  }
  async connect() {
    if (this.socket?.readyState === wrapper_default.OPEN) return;
    if (this.connectPromise) return this.connectPromise;
    const generation = ++this.connectionGeneration;
    const operation = this.openConnection(generation);
    this.connectPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.connectPromise === operation) this.connectPromise = null;
    }
  }
  async openConnection(generation) {
    const discovery = await this.discoverPort();
    const identity = Number.isInteger(discovery) ? { port: discovery, processId: null, executable: null, channel: null } : discovery;
    const port = Number(identity?.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error("Codex debug endpoint identity was invalid");
    }
    const target = selectMainTarget(await this.fetchTargets(`http://127.0.0.1:${port}/json/list`));
    if (!target?.webSocketDebuggerUrl) throw new Error("Codex main renderer was not found");
    if (generation !== this.connectionGeneration) throw new Error("Codex bridge connection was cancelled");
    const socket = this.createSocket(target.webSocketDebuggerUrl);
    this.socket = socket;
    this.connectionIdentity = {
      port,
      processId: Number.isInteger(identity?.processId) ? identity.processId : null,
      executable: typeof identity?.executable === "string" ? identity.executable : null,
      channel: ["stable", "beta"].includes(identity?.channel) ? identity.channel : null
    };
    try {
      await new Promise((resolve, reject) => {
        const timer2 = setTimeout(() => {
          cleanup();
          reject(new Error("Timed out connecting to Codex"));
        }, 3e3);
        const cleanup = () => {
          clearTimeout(timer2);
          socket.off("open", onOpen);
          socket.off("error", onError);
        };
        const onOpen = () => {
          cleanup();
          resolve();
        };
        const onError = (error) => {
          cleanup();
          reject(error);
        };
        socket.once("open", onOpen);
        socket.once("error", onError);
      });
      if (generation !== this.connectionGeneration || this.socket !== socket) {
        throw new Error("Codex bridge connection was cancelled");
      }
      socket.on("message", (raw) => this.handleMessage(String(raw)));
      socket.on("close", () => {
        if (this.socket === socket) this.disconnect();
      });
      socket.on("error", () => {
        if (this.socket === socket) this.disconnect();
      });
      await this.evaluate(ENABLE_EXPRESSION);
    } catch (error) {
      if (this.socket === socket) this.disconnect();
      throw error;
    }
  }
  async snapshot() {
    await this.connect();
    try {
      this.lastSnapshot = await this.evaluate(SNAPSHOT_EXPRESSION);
      return this.lastSnapshot;
    } catch (error) {
      this.disconnect();
      throw error;
    }
  }
  async clickAgent(slot) {
    await this.connect();
    const snapshot = this.lastSnapshot ?? await this.snapshot();
    const agent = snapshot.slots[slot];
    if (!agent?.threadKey) throw new Error(`Agent slot ${slot + 1} is empty`);
    return this.clickThreadKey(agent.threadKey, slot);
  }
  async clickThread(threadId, slot = 0, trace = null) {
    await runTraceStage(trace, "task.connect", () => this.connect(), { slot: slot + 1 });
    return this.clickThreadKey(localThreadKey(threadId), slot, trace);
  }
  async clickThreadKey(threadKey, slot, trace = null) {
    try {
      await runTraceStage(
        trace,
        "task.native-act1",
        () => this.dispatchAgent(slot, threadKey, 1),
        { slot: slot + 1 }
      );
      const finishBackground = trace?.defer?.();
      trace?.record("task.background", { stage: "scheduled", background: true, slot: slot + 1 });
      void (async () => {
        await new Promise((resolve) => setTimeout(resolve, 35));
        await runTraceStage(
          trace,
          "task.native-act0",
          () => this.dispatchAgent(slot, threadKey, 0),
          { background: true, slot: slot + 1 }
        );
        await runTraceStage(
          trace,
          "task.dom-activate",
          () => this.activateThread(threadKey),
          { background: true, slot: slot + 1 }
        );
      })().catch((error) => {
        trace?.record("task.background", {
          stage: "complete",
          background: true,
          outcome: "failed",
          category: traceErrorCategory(error),
          slot: slot + 1
        });
      }).finally(() => finishBackground?.());
    } catch (error) {
      trace?.record("task.fallback", {
        outcome: "started",
        category: traceErrorCategory(error),
        slot: slot + 1
      });
      await runTraceStage(
        trace,
        "task.dom-activate-fallback",
        () => this.activateThread(threadKey),
        { slot: slot + 1 }
      );
    }
  }
  async dispatchAgent(slot, threadKey, act) {
    return this.dispatchMicroMessage({
      type: "codex-micro-hid-event",
      event: { key: `AG0${slot}`, act, slot, threadKey }
    }, "codex-micro-hid-event");
  }
  async dispatchAction(key, act) {
    return this.dispatchMicroMessage({
      type: "codex-micro-hid-event",
      event: { key, act, slot: null, threadKey: null }
    }, "codex-micro-hid-event");
  }
  async dispatchNamedAction(action, pressed, trace = null) {
    const key = MICRO_ACTION_KEYS[action];
    if (key) return this.dispatchAction(key, pressed ? 1 : 0);
    if (!RENDERER_ACTIONS.has(action)) {
      throw new Error(`Unsupported Codex bridge action: ${action}`);
    }
    if (!pressed) return true;
    return this.dispatchRendererAction(action, trace);
  }
  async dispatchRendererAction(action, trace = null) {
    if (MODEL_PRESETS[action]) {
      const operation = this.modelActionQueue.then(async () => {
        await runTraceStage(trace, "model.connect", () => this.connect(), { action });
        return this.dispatchModelPreset(action, trace);
      });
      this.modelActionQueue = operation.catch(() => {
      });
      await operation;
      return true;
    }
    await runTraceStage(trace, "model.connect", () => this.connect(), { action });
    const invoked = await this.evaluate(rendererActionExpression(action));
    if (!invoked) throw new Error(`Codex ${action} action is not available`);
    return true;
  }
  async dispatchModelPreset(action, trace = null) {
    const preset = MODEL_PRESETS[action];
    if (!preset) throw new Error(`Unknown Codex model preset: ${action}`);
    const presetStartedAt = performance.now();
    trace?.record("model.preset", {
      action,
      stage: "start",
      outcome: "started",
      targetEffort: preset.effort
    });
    const effortOrder = ["low", "medium", "high", "xhigh", "max"];
    const targetEffortIndex = effortOrder.indexOf(preset.effort);
    const readState = async () => {
      const state = await runTraceStage(trace, "model.read-state", () => this.evaluate(`(() => {
        const visible = (element) => {
          const rect = element?.getBoundingClientRect?.();
          return element && (element.offsetParent !== null || (rect?.width > 0 && rect?.height > 0));
        };
        const triggers = [...document.querySelectorAll("[data-codex-intelligence-trigger]")].filter(visible);
        if (triggers.length !== 1) return { error: \`Expected one visible intelligence trigger, found \${triggers.length}\` };
        return {
          text: String(triggers[0].textContent ?? "").replace(/\\s+/g, " ").trim(),
          effort: triggers[0].getAttribute("data-selected-reasoning-effort"),
          expanded: triggers[0].getAttribute("aria-expanded") === "true"
        };
      })()`));
      if (state?.error) throw new Error(state.error);
      trace?.record("model.state", {
        currentEffort: state.effort || "unknown",
        effortMatched: state.effort === preset.effort,
        modelMatched: state.text.includes(preset.displayName)
      });
      return state;
    };
    const closeMenus = async () => {
      let attempts = 0;
      for (; attempts < 3 && (await readState()).expanded; attempts += 1) {
        await this.pressRendererEscape(trace, "model.close-menu");
      }
      if ((await readState()).expanded) throw new Error("Codex intelligence menu did not close");
      trace?.record("model.menu-close", { attempts, outcome: "succeeded" });
    };
    const openMain = async () => {
      if (!(await readState()).expanded) {
        await this.clickRendererCandidates(
          '[...document.querySelectorAll("[data-codex-intelligence-trigger]")]',
          "Codex intelligence trigger",
          trace,
          "model.open-trigger"
        );
      }
      await this.waitForRenderer(`(() => {
        const visible = (element) => {
          const rect = element?.getBoundingClientRect?.();
          return element && (element.offsetParent !== null || (rect?.width > 0 && rect?.height > 0));
        };
        return [...document.querySelectorAll('[role="menu"][data-state="open"]')].filter(
          (menu) => visible(menu) && (
            menu.querySelector("[data-model-picker-view-toggle]") ||
            menu.querySelector("[data-reasoning-slider]")
          )
        ).length === 1;
      })()`, "Codex intelligence menu", trace, "model.wait-main-menu");
      const toggleState = await runTraceStage(trace, "model.read-menu-shape", () => this.evaluate(`(() => {
        const menus = [...document.querySelectorAll('[role="menu"][data-state="open"]')].filter(
          (menu) => menu.querySelector("[data-model-picker-view-toggle]") || menu.querySelector("[data-reasoning-slider]")
        );
        const toggles = menus.length === 1
          ? [...menus[0].querySelectorAll("[data-model-picker-view-toggle]")]
          : [];
        return {
          count: toggles.length,
          expanded: toggles[0]?.getAttribute("aria-expanded") === "true",
          rowCount: menus[0]?.querySelectorAll('[role="menuitem"][aria-haspopup="menu"]').length ?? 0
        };
      })()`));
      trace?.record("model.menu-shape", {
        rowCount: toggleState.rowCount,
        outcome: toggleState.expanded ? "expanded" : "collapsed"
      });
      if (toggleState.count === 0 && toggleState.rowCount === 2) return;
      if (toggleState.count !== 1) {
        throw new Error(`Expected one model picker view toggle, found ${toggleState.count}`);
      }
      if (!toggleState.expanded) {
        await this.clickRendererCandidates(
          `(() => {
            const menu = [...document.querySelectorAll('[role="menu"][data-state="open"]')].find(
              (candidate) => candidate.querySelector("[data-model-picker-view-toggle]") || candidate.querySelector("[data-reasoning-slider]")
            );
            return menu ? [...menu.querySelectorAll("[data-model-picker-view-toggle]")] : [];
          })()`,
          "model picker view toggle",
          trace,
          "model.open-picker-view"
        );
        await this.waitForRenderer(`(() => {
          const menu = [...document.querySelectorAll('[role="menu"][data-state="open"]')].find(
            (candidate) => candidate.querySelector("[data-model-picker-view-toggle]") || candidate.querySelector("[data-reasoning-slider]")
          );
          return menu?.querySelectorAll('[role="menuitem"][aria-haspopup="menu"]').length === 2;
        })()`, "expanded Codex model picker", trace, "model.wait-picker-view");
      }
    };
    const rowExpression = (rowIndex) => `(() => {
      const menu = [...document.querySelectorAll('[role="menu"][data-state="open"]')].find(
        (candidate) => candidate.querySelector("[data-model-picker-view-toggle]") || candidate.querySelector("[data-reasoning-slider]")
      );
      const rows = menu ? [...menu.querySelectorAll('[role="menuitem"][aria-haspopup="menu"]')] : [];
      return rows[${rowIndex}] ? [rows[${rowIndex}]] : [];
    })()`;
    const submenuInfo = async (rowIndex) => this.waitForRenderer(`(() => {
      const menu = [...document.querySelectorAll('[role="menu"][data-state="open"]')].find(
        (candidate) => candidate.querySelector("[data-model-picker-view-toggle]") || candidate.querySelector("[data-reasoning-slider]")
      );
      const rows = menu ? [...menu.querySelectorAll('[role="menuitem"][aria-haspopup="menu"]')] : [];
      if (rows.length !== 2 || !rows[${rowIndex}]) return null;
      const submenu = document.getElementById(rows[${rowIndex}].getAttribute("aria-controls"));
      if (!submenu || submenu.getAttribute("data-state") !== "open") return null;
      return [...submenu.querySelectorAll('[role="menuitem"]')].map((item) => ({
        text: String(item.textContent ?? "").replace(/\\s+/g, " ").trim(),
        checked: Boolean(item.querySelector("svg"))
      }));
    })()`, "Codex model picker submenu", trace, `model.wait-submenu-${rowIndex + 1}`);
    const identifyRows = async () => {
      if (this.modelPickerLayout?.connectionGeneration === this.connectionGeneration) {
        trace?.record("model.rows-identified", {
          rowCount: 2,
          source: "cache",
          outcome: "succeeded"
        });
        return this.modelPickerLayout;
      }
      this.modelPickerLayout = null;
      const rowCount = await runTraceStage(trace, "model.read-row-count", () => this.evaluate(`(() => {
        const menu = [...document.querySelectorAll('[role="menu"][data-state="open"]')].find(
          (candidate) => candidate.querySelector("[data-model-picker-view-toggle]") || candidate.querySelector("[data-reasoning-slider]")
        );
        return menu?.querySelectorAll('[role="menuitem"][aria-haspopup="menu"]').length ?? 0;
      })()`));
      if (rowCount !== 2) throw new Error(`Expected two Codex model picker rows, found ${rowCount}`);
      let modelRowIndex = -1;
      for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
        await openMain();
        await this.clickRendererCandidates(
          rowExpression(rowIndex),
          `model picker row ${rowIndex + 1}`,
          trace,
          `model.open-row-${rowIndex + 1}`
        );
        const items = await submenuInfo(rowIndex);
        if (items.filter((item) => item.text === preset.displayName).length === 1) {
          modelRowIndex = rowIndex;
        }
        await this.pressRendererEscape(trace, `model.close-row-${rowIndex + 1}`);
      }
      if (modelRowIndex < 0) throw new Error(`Codex model ${preset.displayName} is not available`);
      const result = {
        connectionGeneration: this.connectionGeneration,
        modelRowIndex,
        effortRowIndex: modelRowIndex === 0 ? 1 : 0
      };
      this.modelPickerLayout = result;
      trace?.record("model.rows-identified", {
        rowCount,
        source: "probe",
        outcome: "succeeded"
      });
      return result;
    };
    const selectEffort = async () => {
      const current = await readState();
      if (current.effort === preset.effort) {
        trace?.record("model.effort", {
          currentEffort: current.effort,
          targetEffort: preset.effort,
          outcome: "skipped"
        });
        return;
      }
      trace?.record("model.effort", {
        currentEffort: current.effort || "unknown",
        targetEffort: preset.effort,
        outcome: "changing"
      });
      const currentEffortIndex = effortOrder.indexOf(current.effort);
      if (currentEffortIndex < 0 || targetEffortIndex < 0) {
        throw new Error(`Unsupported Codex reasoning effort transition: ${current.effort} -> ${preset.effort}`);
      }
      await openMain();
      const { effortRowIndex } = await identifyRows();
      await openMain();
      await this.clickRendererCandidates(
        rowExpression(effortRowIndex),
        "reasoning effort row",
        trace,
        "model.open-effort-row"
      );
      const items = await submenuInfo(effortRowIndex);
      const checkedIndexes = items.flatMap((item, index) => item.checked ? [index] : []);
      if (items.length !== effortOrder.length || checkedIndexes.length !== 1 || checkedIndexes[0] !== currentEffortIndex) {
        throw new Error("Codex reasoning effort order or selected state changed");
      }
      await this.clickRendererCandidates(`(() => {
        const menu = [...document.querySelectorAll('[role="menu"][data-state="open"]')].find(
          (candidate) => candidate.querySelector("[data-model-picker-view-toggle]") || candidate.querySelector("[data-reasoning-slider]")
        );
        const rows = menu ? [...menu.querySelectorAll('[role="menuitem"][aria-haspopup="menu"]')] : [];
        const submenu = rows[${effortRowIndex}]
          ? document.getElementById(rows[${effortRowIndex}].getAttribute("aria-controls"))
          : null;
        const items = submenu ? [...submenu.querySelectorAll('[role="menuitem"]')] : [];
        return items[${targetEffortIndex}] ? [items[${targetEffortIndex}]] : [];
      })()`, `reasoning effort ${preset.effort}`, trace, "model.select-effort-option");
      await this.waitForRenderer(
        `document.querySelector("[data-codex-intelligence-trigger]")?.getAttribute("data-selected-reasoning-effort") === ${JSON.stringify(preset.effort)}`,
        `reasoning effort ${preset.effort}`,
        trace,
        "model.wait-effort-selected"
      );
      trace?.record("model.effort", {
        targetEffort: preset.effort,
        outcome: "succeeded"
      });
    };
    const selectModel = async () => {
      if ((await readState()).text.includes(preset.displayName)) {
        trace?.record("model.model", { modelMatched: true, outcome: "skipped" });
        return;
      }
      trace?.record("model.model", { modelMatched: false, outcome: "changing" });
      await openMain();
      const { modelRowIndex } = await identifyRows();
      await openMain();
      await this.clickRendererCandidates(
        rowExpression(modelRowIndex),
        "model row",
        trace,
        "model.open-model-row"
      );
      const items = await submenuInfo(modelRowIndex);
      if (items.filter((item) => item.text === preset.displayName).length !== 1) {
        throw new Error(`Expected one available ${preset.displayName} model option`);
      }
      await this.clickRendererCandidates(`(() => {
        const menu = [...document.querySelectorAll('[role="menu"][data-state="open"]')].find(
          (candidate) => candidate.querySelector("[data-model-picker-view-toggle]") || candidate.querySelector("[data-reasoning-slider]")
        );
        const rows = menu ? [...menu.querySelectorAll('[role="menuitem"][aria-haspopup="menu"]')] : [];
        const submenu = rows[${modelRowIndex}]
          ? document.getElementById(rows[${modelRowIndex}].getAttribute("aria-controls"))
          : null;
        return submenu
          ? [...submenu.querySelectorAll('[role="menuitem"]')].filter(
              (item) => String(item.textContent ?? "").replace(/\\s+/g, " ").trim() === ${JSON.stringify(preset.displayName)}
            )
          : [];
      })()`, `model ${preset.displayName}`, trace, "model.select-model-option");
      await this.waitForRenderer(
        `String(document.querySelector("[data-codex-intelligence-trigger]")?.textContent ?? "").includes(${JSON.stringify(preset.displayName)})`,
        `model ${preset.displayName}`,
        trace,
        "model.wait-model-selected"
      );
      trace?.record("model.model", { modelMatched: true, outcome: "succeeded" });
    };
    try {
      await runTraceStage(trace, "model.select-model", selectModel, { action });
      await runTraceStage(trace, "model.select-effort", selectEffort, { targetEffort: preset.effort });
      const selected = await runTraceStage(trace, "model.validate", readState, { action });
      if (!selected.text.includes(preset.displayName) || selected.effort !== preset.effort) {
        throw new Error(`Codex did not select ${preset.displayName} / ${preset.effort}`);
      }
      await runTraceStage(trace, "model.close-menus", closeMenus, { action });
      trace?.record("model.preset", {
        action,
        stage: "complete",
        outcome: "succeeded",
        targetEffort: preset.effort,
        durationMs: Math.round(performance.now() - presetStartedAt)
      });
      return { model: preset.model, effort: preset.effort };
    } catch (error) {
      this.modelPickerLayout = null;
      trace?.record("model.preset", {
        action,
        stage: "complete",
        outcome: "failed",
        category: traceErrorCategory(error),
        targetEffort: preset.effort,
        durationMs: Math.round(performance.now() - presetStartedAt)
      });
      try {
        await runTraceStage(trace, "model.cleanup-menus", closeMenus, { action });
      } catch {
      }
      throw error;
    }
  }
  async dispatchComposerSteer() {
    await this.connect();
    const clicked = await this.evaluate(composerSteerExpression());
    if (!clicked) throw new Error("Codex Steer action is not available");
  }
  async dispatchJoystick(direction, distance) {
    const angle = { up: 0.75, right: 0, down: 0.25, left: 0.5 }[direction];
    if (angle === void 0) throw new Error(`Unknown joystick direction: ${direction}`);
    return this.dispatchMicroMessage({
      type: "codex-micro-joystick-event",
      event: { angle, distance }
    }, "codex-micro-joystick-event");
  }
  async dispatchMicroMessage(message, requiredHandler) {
    return this.evaluate(`(async () => {
      const cacheKey = Symbol.for("codex-keyboard-micro-bus");
      const isMicroBus = (candidate) =>
        candidate && candidate.handlers instanceof Map &&
        (
          candidate.handlers.has(${JSON.stringify(requiredHandler)}) ||
          [...candidate.handlers.keys()].some((key) => String(key).startsWith("codex-micro-"))
        ) &&
        (
          typeof candidate.dispatchHostMessage === "function" ||
          typeof candidate.dispatchMessage === "function"
        );
      let bus = globalThis[cacheKey];
      if (!isMicroBus(bus)) {
        const urls = [...new Set([
          ...[...document.querySelectorAll("link[href],script[src]")].map((element) => element.href || element.src),
          ...performance.getEntriesByType("resource").map((entry) => entry.name)
        ])]
          .filter((url) => url.includes("/assets/") && url.endsWith(".js"));
        bus = null;
        for (const url of urls) {
          try {
            const namespace = await import(url);
            bus = Object.values(namespace).find(isMicroBus);
            if (bus) {
              globalThis[cacheKey] = bus;
              break;
            }
          } catch {}
        }
      }
      if (!bus) throw new Error("Codex Micro event bus was not found");
      const dispatch = bus.dispatchHostMessage ?? bus.dispatchMessage;
      if ((bus.handlers.get(${JSON.stringify(requiredHandler)})?.size ?? 0) === 0) {
        dispatch.call(bus, ${JSON.stringify(DEVICE_STATE)});
      }
      // Never put Micro handler discovery on the physical key hot path. The
      // native event is dispatched immediately; clickAgent keeps a DOM
      // activation fallback in the background in case Codex has not installed
      // its handler yet.
      dispatch.call(bus, ${JSON.stringify(message)});
      return true;
    })()`);
  }
  async activateThread(threadKey) {
    return this.evaluate(`(async () => {
      const key = ${JSON.stringify(threadKey)};
      const normalize = (value) => String(value ?? "").replace(/^local:/, "");
      const current = () => document.querySelector("[data-above-composer-conversation-id]")
        ?.getAttribute("data-above-composer-conversation-id")
        ?? document.querySelector("[data-app-action-sidebar-thread-id][data-app-action-sidebar-thread-active=true]")
          ?.getAttribute("data-app-action-sidebar-thread-id");
      if (normalize(current()) === normalize(key)) return true;
      const item = [...document.querySelectorAll("[data-app-action-sidebar-thread-id]")]
        .find((el) => normalize(el.getAttribute("data-app-action-sidebar-thread-id")) === normalize(key));
      if (!item) throw new Error("Task is not loaded in the Codex sidebar");
      (item.querySelector("button,a,[role=button],[role=link]") ?? item).click();
      return true;
    })()`);
  }
  sendCommand(method, params, returnValue = false) {
    if (!this.socket || this.socket.readyState !== wrapper_default.OPEN) {
      return Promise.reject(new Error("Codex bridge is disconnected"));
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer2 = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Codex runtime response timed out"));
      }, 7e3);
      this.pending.set(id, { resolve, reject, timer: timer2, returnValue });
      this.socket.send(JSON.stringify({
        id,
        method,
        params
      }));
    });
  }
  evaluate(expression) {
    return this.sendCommand("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    }, true);
  }
  async clickRendererCandidates(candidatesExpression, description, trace = null, stage = "renderer.click") {
    await runTraceStage(trace, stage, () => this.evaluate(`(() => {
      const visible = (element) => {
        const rect = element?.getBoundingClientRect?.();
        return element && (element.offsetParent !== null || (rect?.width > 0 && rect?.height > 0));
      };
      const candidates = [...(${candidatesExpression})].filter(visible);
      if (candidates.length !== 1) {
        throw new Error(\`Expected one ${description}, found \${candidates.length}\`);
      }
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        const EventType = type.startsWith("pointer") ? PointerEvent : MouseEvent;
        candidates[0].dispatchEvent(new EventType(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: type.endsWith("down") ? 1 : 0,
          view: window
        }));
      }
      return true;
    })()`));
  }
  async pressRendererEscape(trace = null, stage = "renderer.escape") {
    await runTraceStage(trace, stage, () => this.evaluate(`(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape", code: "Escape", bubbles: true, cancelable: true
      }));
      return true;
    })()`));
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  async waitForRenderer(expression, description, trace = null, stage = "renderer.wait") {
    const startedAt = performance.now();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const result = await this.evaluate(expression);
      if (result) {
        trace?.record("renderer.poll", {
          stage,
          outcome: "succeeded",
          attempts: attempt + 1,
          durationMs: Math.round(performance.now() - startedAt)
        });
        return result;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    trace?.record("renderer.poll", {
      stage,
      outcome: "failed",
      category: "timeout",
      attempts: 20,
      durationMs: Math.round(performance.now() - startedAt)
    });
    throw new Error(`Timed out waiting for ${description}`);
  }
  handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) return pending.reject(new Error(message.error.message));
    if (message.result?.exceptionDetails) {
      return pending.reject(new Error(
        message.result.exceptionDetails.exception?.description ?? message.result.exceptionDetails.text ?? "Codex evaluation failed"
      ));
    }
    pending.resolve(
      pending.returnValue ? message.result?.result?.value : message.result
    );
  }
  disconnect() {
    this.connectionGeneration += 1;
    this.connectPromise = null;
    this.modelPickerLayout = null;
    this.connectionIdentity = null;
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState !== wrapper_default.CLOSED) {
      try {
        socket.close();
      } catch {
        socket.terminate?.();
      }
    }
    for (const { reject, timer: timer2 } of this.pending.values()) {
      clearTimeout(timer2);
      reject(new Error("Codex bridge disconnected"));
    }
    this.pending.clear();
  }
};

// ../../src/bridge/auth.mjs
import { timingSafeEqual } from "node:crypto";
function bridgeRequestAuthorized(token, authorizationHeader) {
  if (!token) return false;
  const candidate = String(authorizationHeader || "").replace(/^Bearer\s+/i, "");
  const actual = Buffer.from(token);
  const supplied = Buffer.from(candidate);
  return actual.length === supplied.length && timingSafeEqual(actual, supplied);
}

// ../../src/bridge/navigation.mjs
async function navigateAndFocus(navigate, focus) {
  const [navigation, activation] = await Promise.allSettled([navigate(), focus()]);
  if (navigation.status === "rejected") throw navigation.reason;
  return { focusOk: activation.status === "fulfilled" };
}

// ../../src/bridge/server.mjs
var HOST = "127.0.0.1";
var PORT = Number(process.env.CODEX_KEYBOARD_PORT || 17373);
var BRIDGE_VERSION = false ? null : "0.6.1";
var RUNTIME_HASH = (() => {
  try {
    return createHash("sha256").update(readFileSync(process.argv[1])).digest("hex");
  } catch {
    return null;
  }
})();
var NATIVE_RUNTIME_HASH = /^[a-f0-9]{64}$/.test(String(process.env.CODEX_BRIDGE_NATIVE_HASH || "")) ? process.env.CODEX_BRIDGE_NATIVE_HASH : null;
var configuredRefreshMs = Number(process.env.CODEX_KEYBOARD_REFRESH_MS || 500);
var REFRESH_MS = Number.isFinite(configuredRefreshMs) ? Math.max(250, configuredRefreshMs) : 500;
var client = new CodexCdpClient();
var dataRoot = process.env.CODEX_BRIDGE_DATA_ROOT || (process.platform === "win32" ? join2(process.env.LOCALAPPDATA || join2(homedir(), "AppData", "Local"), "OpenCodexMicro") : join2(homedir(), "Library", "Application Support", "OpenCodexMicro"));
var bridgeToken = process.env.CODEX_BRIDGE_TOKEN || (() => {
  try {
    return readFileSync(join2(dataRoot, "bridge-token"), "utf8").trim();
  } catch {
    return "";
  }
})();
var cached = {
  connected: false,
  slots: Array.from({ length: 6 }, (_, id) => ({
    id,
    threadKey: null,
    title: null,
    status: "off",
    selected: false
  })),
  error: "Waiting for Codex",
  updatedAt: Date.now()
};
var refreshPromise = null;
var nextReconnectAt = 0;
var hasRefreshed = false;
var traceBuffer = /* @__PURE__ */ new Map();
var TRACE_TTL_MS = 3e4;
var TRACE_LIMIT = 32;
var TRACE_EVENT_LIMIT = 160;
function diagnosticErrorCategory(error) {
  const name = String(error?.name || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  if (name.includes("timeout") || message.includes("timed out") || message.includes("timeout")) return "timeout";
  if (message.includes("disconnected") || message.includes("not running")) return "cdp-unavailable";
  if (message.includes("window")) return "focus-failed";
  if (message.includes("menu") || message.includes("model") || message.includes("reasoning")) return "renderer-state";
  return "bridge-operation";
}
function traceIdFrom(request) {
  const value = String(request.headers["x-codex-trace-id"] || "");
  return /^[a-f0-9-]{36}$/.test(value) ? value : null;
}
function safeTraceFields(fields) {
  return Object.fromEntries(Object.entries(fields || {}).flatMap(([key, value]) => {
    if (typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) {
      return [[key, value]];
    }
    const normalized = String(value || "");
    return /^[a-zA-Z0-9_.:-]{1,80}$/.test(normalized) ? [[key, normalized]] : [];
  }));
}
function startTrace(request, route, fields = {}) {
  const traceId = traceIdFrom(request);
  if (!traceId) return null;
  const startedAt = performance.now();
  const trace = {
    traceId,
    startedAt,
    events: [],
    pending: 0,
    completionRequested: false,
    complete: false,
    record(event, details = {}) {
      if (!/^[a-z0-9.-]{1,80}$/.test(event) || this.events.length >= TRACE_EVENT_LIMIT) return;
      this.events.push({
        event,
        offsetMs: Math.round(performance.now() - startedAt),
        ...safeTraceFields(details)
      });
    },
    defer() {
      this.pending += 1;
      let settled = false;
      return () => {
        if (settled) return;
        settled = true;
        this.pending = Math.max(0, this.pending - 1);
        if (this.completionRequested && this.pending === 0) this.complete = true;
      };
    },
    finish() {
      this.completionRequested = true;
      if (this.pending === 0) this.complete = true;
    }
  };
  trace.record("server.request", { route, ...fields });
  traceBuffer.set(traceId, trace);
  while (traceBuffer.size > TRACE_LIMIT) traceBuffer.delete(traceBuffer.keys().next().value);
  const cleanup = setTimeout(() => traceBuffer.delete(traceId), TRACE_TTL_MS);
  cleanup.unref?.();
  return trace;
}
function traceSnapshot(traceId) {
  const trace = traceBuffer.get(traceId);
  if (!trace) return null;
  return {
    traceId,
    complete: trace.complete,
    events: trace.events.map((event) => ({ ...event }))
  };
}
async function focusCodexDesktop(trace = null) {
  const startedAt = performance.now();
  const path = process.platform === "win32" ? "win32-native" : "platform-adapter";
  trace?.record("focus.start", { platform: process.platform, path });
  try {
    let identity = null;
    if (process.platform === "win32") {
      const connection = client.socket?.readyState === 1 ? "reused" : "open";
      await client.connect();
      identity = client.connectionIdentity;
      trace?.record("focus.target", {
        connection,
        channel: identity?.channel || "unknown",
        outcome: "succeeded"
      });
    }
    const result = await focusCodex({ processId: identity?.processId ?? null });
    trace?.record("focus.native", {
      outcome: "succeeded",
      channel: identity?.channel || "unknown",
      reused: Boolean(result?.alreadyForeground && result?.alreadyMaximized)
    });
    trace?.record("focus.complete", {
      platform: process.platform,
      path,
      outcome: "succeeded",
      durationMs: Math.round(performance.now() - startedAt)
    });
    console.log("Codex Desktop window maximized and focused through the native desktop adapter");
  } catch (error) {
    trace?.record("focus.complete", {
      platform: process.platform,
      path,
      outcome: "failed",
      category: diagnosticErrorCategory(error),
      durationMs: Math.round(performance.now() - startedAt)
    });
    throw error;
  }
}
function authorized(request) {
  return bridgeRequestAuthorized(bridgeToken, request.headers.authorization);
}
async function refresh(force = false) {
  if (refreshPromise) return refreshPromise;
  if (!force && Date.now() < nextReconnectAt) return;
  refreshPromise = (async () => {
    try {
      const snapshot = await client.snapshot();
      cached = { connected: true, ...snapshot, error: null, updatedAt: Date.now() };
      nextReconnectAt = 0;
    } catch (error) {
      cached = { ...cached, connected: false, error: error.message, updatedAt: Date.now() };
      nextReconnectAt = Date.now() + 2e3;
    }
  })();
  try {
    await refreshPromise;
  } finally {
    hasRefreshed = true;
    refreshPromise = null;
  }
}
function json(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "http://127.0.0.1"
  });
  response.end(`${JSON.stringify(body)}
`);
}
var server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${HOST}:${PORT}`);
  if (request.method === "POST" && !authorized(request)) {
    return json(response, 401, { ok: false, error: "Bridge authorization required" });
  }
  if (request.method === "GET" && url.pathname === "/health") {
    if (!hasRefreshed || Date.now() - cached.updatedAt >= REFRESH_MS * 2) {
      await refresh(true);
    }
    return json(response, 200, {
      ok: true,
      bridgeVersion: BRIDGE_VERSION,
      runtimeHash: RUNTIME_HASH,
      nativeRuntimeHash: NATIVE_RUNTIME_HASH,
      codexConnected: cached.connected,
      updatedAt: cached.updatedAt
    });
  }
  if (request.method === "GET" && url.pathname === "/state") {
    return json(response, 200, cached);
  }
  if (request.method === "POST" && url.pathname === "/diagnostics/trace") {
    const traceId = traceIdFrom(request);
    const diagnostics = traceId ? traceSnapshot(traceId) : null;
    return json(response, diagnostics ? 200 : 404, diagnostics ? { ok: true, diagnostics } : { ok: false, error: "Trace diagnostics are unavailable" });
  }
  if (request.method === "POST" && url.pathname === "/focus") {
    try {
      await focusCodexDesktop();
      return json(response, 200, { ok: true });
    } catch (error) {
      return json(response, 503, { ok: false, error: error.message });
    }
  }
  const match = request.method === "POST" && url.pathname.match(/^\/agent\/([0-5])\/click$/);
  if (match) {
    try {
      const result = await navigateAndFocus(
        () => client.clickAgent(Number(match[1])),
        () => focusCodexDesktop()
      );
      return json(response, 200, { ok: true, ...result });
    } catch (error) {
      return json(response, 503, { ok: false, error: error.message });
    }
  }
  const threadMatch = request.method === "POST" && url.pathname.match(
    /^\/thread\/([^/]+)\/click$/
  );
  if (threadMatch) {
    let trace = null;
    try {
      const threadId = decodeThreadPathSegment(threadMatch[1]);
      const slot = Number(url.searchParams.get("slot") || 0);
      if (!Number.isInteger(slot) || slot < 0 || slot > 5) {
        throw new Error("Invalid Codex Micro slot");
      }
      trace = startTrace(request, "thread-click", { slot: slot + 1 });
      const result = await navigateAndFocus(
        () => client.clickThread(threadId, slot, trace),
        () => focusCodexDesktop(trace)
      );
      trace?.record("server.response", {
        outcome: "succeeded",
        route: "thread-click",
        focusOk: result.focusOk
      });
      return json(response, 200, { ok: true, bridge: true, ...result });
    } catch (error) {
      trace?.record("server.response", {
        outcome: "failed",
        route: "thread-click",
        category: diagnosticErrorCategory(error)
      });
      return json(response, 503, {
        ok: false,
        bridge: false,
        error: error.message
      });
    } finally {
      trace?.finish();
    }
  }
  const action = request.method === "POST" && url.pathname.match(
    /^\/action\/(fast|approve|reject|pin|new|fork|mic|steer|submit|model-sol-high|model-luna-max|model-sol-medium)\/(down|up)$/
  );
  if (action) {
    const trace = startTrace(request, "action", { action: action[1], phase: action[2] });
    try {
      if (action[1] === "steer") {
        if (action[2] === "down") {
          await focusCodexDesktop();
          await client.dispatchComposerSteer();
        }
        return json(response, 200, { ok: true });
      }
      await client.dispatchNamedAction(action[1], action[2] === "down", trace);
      trace?.record("server.response", { outcome: "succeeded", route: "action" });
      return json(response, 200, { ok: true, bridge: true });
    } catch (error) {
      trace?.record("server.response", {
        outcome: "failed",
        route: "action",
        category: diagnosticErrorCategory(error)
      });
      return json(response, 503, { ok: false, error: error.message });
    } finally {
      trace?.finish();
    }
  }
  const joystick = request.method === "POST" && url.pathname.match(
    /^\/joystick\/(up|right|down|left)\/(down|up)$/
  );
  if (joystick) {
    try {
      await client.dispatchJoystick(joystick[1], joystick[2] === "down" ? 1 : 0);
      return json(response, 200, { ok: true });
    } catch (error) {
      return json(response, 503, { ok: false, error: error.message });
    }
  }
  return json(response, 404, { ok: false, error: "Not found" });
});
server.listen(PORT, HOST, () => {
  console.log(`Codex Keyboard bridge ${BRIDGE_VERSION || "unversioned"} listening on http://${HOST}:${PORT}`);
  void refresh();
});
var timer = setInterval(() => void refresh(), REFRESH_MS);
timer.unref();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    clearInterval(timer);
    client.disconnect();
    server.close(() => process.exit(0));
  });
}
