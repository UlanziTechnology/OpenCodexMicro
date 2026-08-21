var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
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

// ../../node_modules/ws/lib/constants.js
var require_constants = __commonJS({
  "../../node_modules/ws/lib/constants.js"(exports2, module2) {
    "use strict";
    var BINARY_TYPES = ["nodebuffer", "arraybuffer", "fragments"];
    var hasBlob = typeof Blob !== "undefined";
    if (hasBlob) BINARY_TYPES.push("blob");
    module2.exports = {
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
  "../../node_modules/ws/lib/buffer-util.js"(exports2, module2) {
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
    module2.exports = {
      concat,
      mask: _mask,
      toArrayBuffer,
      toBuffer,
      unmask: _unmask
    };
    if (!process.env.WS_NO_BUFFER_UTIL) {
      try {
        const bufferUtil = require("bufferutil");
        module2.exports.mask = function(source, mask, output, offset, length) {
          if (length < 48) _mask(source, mask, output, offset, length);
          else bufferUtil.mask(source, mask, output, offset, length);
        };
        module2.exports.unmask = function(buffer, mask) {
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
  "../../node_modules/ws/lib/limiter.js"(exports2, module2) {
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
    module2.exports = Limiter;
  }
});

// ../../node_modules/ws/lib/permessage-deflate.js
var require_permessage_deflate = __commonJS({
  "../../node_modules/ws/lib/permessage-deflate.js"(exports2, module2) {
    "use strict";
    var zlib = require("zlib");
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
    module2.exports = PerMessageDeflate2;
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
  "../../node_modules/ws/lib/validation.js"(exports2, module2) {
    "use strict";
    var { isUtf8 } = require("buffer");
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
    module2.exports = {
      isBlob,
      isValidStatusCode,
      isValidUTF8: _isValidUTF8,
      tokenChars
    };
    if (isUtf8) {
      module2.exports.isValidUTF8 = function(buf) {
        return buf.length < 24 ? _isValidUTF8(buf) : isUtf8(buf);
      };
    } else if (!process.env.WS_NO_UTF_8_VALIDATE) {
      try {
        const isValidUTF8 = require("utf-8-validate");
        module2.exports.isValidUTF8 = function(buf) {
          return buf.length < 32 ? _isValidUTF8(buf) : isValidUTF8(buf);
        };
      } catch (e) {
      }
    }
  }
});

// ../../node_modules/ws/lib/receiver.js
var require_receiver = __commonJS({
  "../../node_modules/ws/lib/receiver.js"(exports2, module2) {
    "use strict";
    var { Writable } = require("stream");
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
    module2.exports = Receiver2;
  }
});

// ../../node_modules/ws/lib/sender.js
var require_sender = __commonJS({
  "../../node_modules/ws/lib/sender.js"(exports2, module2) {
    "use strict";
    var { Duplex } = require("stream");
    var { randomFillSync } = require("crypto");
    var {
      types: { isUint8Array }
    } = require("util");
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
      constructor(socket2, extensions, generateMask) {
        this._extensions = extensions || {};
        if (generateMask) {
          this._generateMask = generateMask;
          this._maskBuffer = Buffer.alloc(4);
        }
        this._socket = socket2;
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
    module2.exports = Sender2;
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
  "../../node_modules/ws/lib/event-target.js"(exports2, module2) {
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
    module2.exports = {
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
  "../../node_modules/ws/lib/extension.js"(exports2, module2) {
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
    module2.exports = { format, parse };
  }
});

// ../../node_modules/ws/lib/websocket.js
var require_websocket = __commonJS({
  "../../node_modules/ws/lib/websocket.js"(exports2, module2) {
    "use strict";
    var EventEmitter = require("events");
    var https = require("https");
    var http = require("http");
    var net = require("net");
    var tls = require("tls");
    var { randomBytes: randomBytes2, createHash: createHash2 } = require("crypto");
    var { Duplex, Readable } = require("stream");
    var { URL } = require("url");
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
      constructor(address2, protocols, options) {
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
        if (address2 !== null) {
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
          initAsClient(this, address2, protocols, options);
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
      setSocket(socket2, head, options) {
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
        const sender = new Sender2(socket2, this._extensions, options.generateMask);
        this._receiver = receiver;
        this._sender = sender;
        this._socket = socket2;
        receiver[kWebSocket] = this;
        sender[kWebSocket] = this;
        socket2[kWebSocket] = this;
        receiver.on("conclude", receiverOnConclude);
        receiver.on("drain", receiverOnDrain);
        receiver.on("error", receiverOnError);
        receiver.on("message", receiverOnMessage);
        receiver.on("ping", receiverOnPing);
        receiver.on("pong", receiverOnPong);
        sender.onerror = senderOnError;
        if (socket2.setTimeout) socket2.setTimeout(0);
        if (socket2.setNoDelay) socket2.setNoDelay();
        if (head.length > 0) socket2.unshift(head);
        socket2.on("close", socketOnClose);
        socket2.on("data", socketOnData);
        socket2.on("end", socketOnEnd);
        socket2.on("error", socketOnError);
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
    module2.exports = WebSocket2;
    function initAsClient(websocket, address2, protocols, options) {
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
      if (address2 instanceof URL) {
        parsedUrl = address2;
      } else {
        try {
          parsedUrl = new URL(address2);
        } catch {
          throw new SyntaxError(`Invalid URL: ${address2}`);
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
      const key = randomBytes2(16).toString("base64");
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
            addr = new URL(location, address2);
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
      req.on("upgrade", (res, socket2, head) => {
        websocket.emit("upgrade", res);
        if (websocket.readyState !== WebSocket2.CONNECTING) return;
        req = websocket._req = null;
        const upgrade = res.headers.upgrade;
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          abortHandshake(websocket, socket2, "Invalid Upgrade header");
          return;
        }
        const digest = createHash2("sha1").update(key + GUID).digest("base64");
        if (res.headers["sec-websocket-accept"] !== digest) {
          abortHandshake(websocket, socket2, "Invalid Sec-WebSocket-Accept header");
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
          abortHandshake(websocket, socket2, protError);
          return;
        }
        if (serverProt) websocket._protocol = serverProt;
        const secWebSocketExtensions = res.headers["sec-websocket-extensions"];
        if (secWebSocketExtensions !== void 0) {
          if (!perMessageDeflate) {
            const message = "Server sent a Sec-WebSocket-Extensions header but no extension was requested";
            abortHandshake(websocket, socket2, message);
            return;
          }
          let extensions;
          try {
            extensions = parse(secWebSocketExtensions);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket2, message);
            return;
          }
          const extensionNames = Object.keys(extensions);
          if (extensionNames.length !== 1 || extensionNames[0] !== PerMessageDeflate2.extensionName) {
            const message = "Server indicated an extension that was not requested";
            abortHandshake(websocket, socket2, message);
            return;
          }
          try {
            perMessageDeflate.accept(extensions[PerMessageDeflate2.extensionName]);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket2, message);
            return;
          }
          websocket._extensions[PerMessageDeflate2.extensionName] = perMessageDeflate;
        }
        websocket.setSocket(socket2, head, {
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
  "../../node_modules/ws/lib/stream.js"(exports2, module2) {
    "use strict";
    var WebSocket2 = require_websocket();
    var { Duplex } = require("stream");
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
    module2.exports = createWebSocketStream2;
  }
});

// ../../node_modules/ws/lib/subprotocol.js
var require_subprotocol = __commonJS({
  "../../node_modules/ws/lib/subprotocol.js"(exports2, module2) {
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
    module2.exports = { parse };
  }
});

// ../../node_modules/ws/lib/websocket-server.js
var require_websocket_server = __commonJS({
  "../../node_modules/ws/lib/websocket-server.js"(exports2, module2) {
    "use strict";
    var EventEmitter = require("events");
    var http = require("http");
    var { Duplex } = require("stream");
    var { createHash: createHash2 } = require("crypto");
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
            upgrade: (req, socket2, head) => {
              this.handleUpgrade(req, socket2, head, emitConnection);
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
          const server = this._server;
          this._removeListeners();
          this._removeListeners = this._server = null;
          server.close(() => {
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
      handleUpgrade(req, socket2, head, cb) {
        socket2.on("error", socketOnError);
        const key = req.headers["sec-websocket-key"];
        const upgrade = req.headers.upgrade;
        const version = +req.headers["sec-websocket-version"];
        if (req.method !== "GET") {
          const message = "Invalid HTTP method";
          abortHandshakeOrEmitwsClientError(this, req, socket2, 405, message);
          return;
        }
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          const message = "Invalid Upgrade header";
          abortHandshakeOrEmitwsClientError(this, req, socket2, 400, message);
          return;
        }
        if (key === void 0 || !keyRegex.test(key)) {
          const message = "Missing or invalid Sec-WebSocket-Key header";
          abortHandshakeOrEmitwsClientError(this, req, socket2, 400, message);
          return;
        }
        if (version !== 13 && version !== 8) {
          const message = "Missing or invalid Sec-WebSocket-Version header";
          abortHandshakeOrEmitwsClientError(this, req, socket2, 400, message, {
            "Sec-WebSocket-Version": "13, 8"
          });
          return;
        }
        if (!this.shouldHandle(req)) {
          abortHandshake(socket2, 400);
          return;
        }
        const secWebSocketProtocol = req.headers["sec-websocket-protocol"];
        let protocols = /* @__PURE__ */ new Set();
        if (secWebSocketProtocol !== void 0) {
          try {
            protocols = subprotocol2.parse(secWebSocketProtocol);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Protocol header";
            abortHandshakeOrEmitwsClientError(this, req, socket2, 400, message);
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
            abortHandshakeOrEmitwsClientError(this, req, socket2, 400, message);
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
                return abortHandshake(socket2, code || 401, message, headers);
              }
              this.completeUpgrade(
                extensions,
                key,
                protocols,
                req,
                socket2,
                head,
                cb
              );
            });
            return;
          }
          if (!this.options.verifyClient(info)) return abortHandshake(socket2, 401);
        }
        this.completeUpgrade(extensions, key, protocols, req, socket2, head, cb);
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
      completeUpgrade(extensions, key, protocols, req, socket2, head, cb) {
        if (!socket2.readable || !socket2.writable) return socket2.destroy();
        if (socket2[kWebSocket]) {
          throw new Error(
            "server.handleUpgrade() was called more than once with the same socket, possibly due to a misconfiguration"
          );
        }
        if (this._state > RUNNING) return abortHandshake(socket2, 503);
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
        socket2.write(headers.concat("\r\n").join("\r\n"));
        socket2.removeListener("error", socketOnError);
        ws.setSocket(socket2, head, {
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
    module2.exports = WebSocketServer2;
    function addListeners(server, map) {
      for (const event of Object.keys(map)) server.on(event, map[event]);
      return function removeListeners() {
        for (const event of Object.keys(map)) {
          server.removeListener(event, map[event]);
        }
      };
    }
    function emitClose(server) {
      server._state = CLOSED;
      server.emit("close");
    }
    function socketOnError() {
      this.destroy();
    }
    function abortHandshake(socket2, code, message, headers) {
      message = message || http.STATUS_CODES[code];
      headers = {
        Connection: "close",
        "Content-Type": "text/html",
        "Content-Length": Buffer.byteLength(message),
        ...headers
      };
      socket2.once("finish", socket2.destroy);
      socket2.end(
        `HTTP/1.1 ${code} ${http.STATUS_CODES[code]}\r
` + Object.keys(headers).map((h) => `${h}: ${headers[h]}`).join("\r\n") + "\r\n\r\n" + message
      );
    }
    function abortHandshakeOrEmitwsClientError(server, req, socket2, code, message, headers) {
      if (server.listenerCount("wsClientError")) {
        const err = new Error(message);
        Error.captureStackTrace(err, abortHandshakeOrEmitwsClientError);
        server.emit("wsClientError", err, socket2, req);
      } else {
        abortHandshake(socket2, code, message, headers);
      }
    }
  }
});

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

// plugin/app.js
var import_node_crypto2 = require("node:crypto");
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");

// plugin/bridge-installer.js
var import_node_fs = require("node:fs");
var import_promises = require("node:fs/promises");
var import_node_child_process2 = require("node:child_process");
var import_node_crypto = require("node:crypto");
var import_node_util2 = require("node:util");
var import_node_os = require("node:os");
var import_node_path = require("node:path");

// ../../src/bridge/platform.mjs
var import_node_child_process = require("node:child_process");
var import_node_util = require("node:util");
var execFileAsync = (0, import_node_util.promisify)(import_node_child_process.execFile);
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
    const port2 = Number(commandLine.match(/--remote-debugging-port(?:=|\s+)(\d+)/)?.[1]);
    if (!Number.isInteger(port2) || port2 <= 0 || port2 > 65535) return [];
    const processId = Number(row?.processId);
    const executable = typeof row?.executable === "string" ? row.executable : null;
    return [{
      port: port2,
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
  for (const port2 of [...new Set(candidates)]) {
    try {
      await fetchJson(`http://${CDP_HOST}:${port2}/json/version`, 500, fetchImpl);
      const process2 = processes.find((item) => item.port === port2 && item.ownsDebugPort) ?? processes.find((item) => item.port === port2);
      return {
        port: port2,
        processId: process2?.processId ?? null,
        executable: process2?.executable ?? null,
        channel: process2?.channel ?? null
      };
    } catch {
    }
  }
  throw new Error("Codex is not running with the local debug bridge");
}
async function discoverWindowsCodexExecutables({ execute = execFileAsync } = {}) {
  const { stdout = "" } = await execute(
    "powershell.exe",
    powershellArgs(WINDOWS_PACKAGE_COMMAND),
    powershellOptions({ timeout: 8e3 })
  );
  if (!String(stdout).trim()) return [];
  const parsed = JSON.parse(String(stdout));
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.filter(
    (row) => ["stable", "beta"].includes(row?.channel) && typeof row?.executable === "string" && row.executable.toLowerCase().endsWith(".exe")
  );
}
async function launchWindowsCodex({
  channel = "stable",
  execute = execFileAsync,
  spawnProcess = import_node_child_process.spawn
} = {}) {
  const installations = await discoverWindowsCodexExecutables({ execute });
  const selected = installations.find((item) => item.channel === channel) ?? installations.find((item) => item.channel === "stable") ?? installations[0];
  if (!selected) {
    throw new Error("Codex Desktop Stable or Beta was not found in the current Windows account.");
  }
  await execute(
    "powershell.exe",
    powershellArgs(WINDOWS_STOP_EXECUTABLE_COMMAND),
    powershellOptions({
      timeout: 1e4,
      env: { ...process.env, CODEX_BRIDGE_TARGET_EXECUTABLE: selected.executable }
    })
  );
  const child = spawnProcess(selected.executable, [...CDP_ARGUMENTS], {
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  child.unref?.();
  return selected;
}

// plugin/bridge-installer.js
var execFileAsync2 = (0, import_node_util2.promisify)(import_node_child_process2.execFile);
function xml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
async function exists(path, mode = import_node_fs.constants.F_OK) {
  try {
    await (0, import_promises.access)(path, mode);
    return true;
  } catch {
    return false;
  }
}
async function readJson(path) {
  try {
    return JSON.parse(await (0, import_promises.readFile)(path, "utf8"));
  } catch {
    return null;
  }
}
async function fileSha256(path) {
  try {
    return (0, import_node_crypto.createHash)("sha256").update(await (0, import_promises.readFile)(path)).digest("hex");
  } catch {
    return null;
  }
}
async function verifiedNativeRuntimeHash(root) {
  const manifest = await readJson((0, import_node_path.join)(root, "native-runtime.json"));
  if (manifest?.version !== 1 || !/^[a-f0-9]{64}$/.test(String(manifest?.runtimeHash || "")) || !Array.isArray(manifest?.files)) {
    return null;
  }
  const verified = [];
  for (const file of manifest.files) {
    const relative = String(file?.path || "").replaceAll("\\", "/");
    if (!relative || relative.startsWith("/") || relative.split("/").includes("..")) return null;
    const sha256 = await fileSha256((0, import_node_path.join)(root, ...relative.split("/")));
    if (!sha256 || sha256 !== file.sha256) return null;
    verified.push({ path: relative, sha256 });
  }
  const computed = (0, import_node_crypto.createHash)("sha256").update(verified.map((file) => `${file.path}:${file.sha256}`).join("\n")).digest("hex");
  return computed === manifest.runtimeHash ? computed : null;
}
function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}
async function acquireFilesystemLock({
  lockPath,
  timeoutMs = 15e3,
  staleMs = 3e5,
  wait = (milliseconds) => new Promise((resolve3) => setTimeout(resolve3, milliseconds))
}) {
  const ownerToken = (0, import_node_crypto.randomBytes)(24).toString("base64url");
  await (0, import_promises.mkdir)((0, import_node_path.dirname)(lockPath), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await (0, import_promises.mkdir)(lockPath, { mode: 448 });
      await (0, import_promises.writeFile)((0, import_node_path.join)(lockPath, "owner.json"), `${JSON.stringify({
        pid: process.pid,
        ownerToken,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      })}
`);
      return async () => {
        const owner = await readJson((0, import_node_path.join)(lockPath, "owner.json"));
        if (owner?.ownerToken === ownerToken) {
          await (0, import_promises.rm)(lockPath, { recursive: true, force: true });
        }
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const [lockInfo, owner] = await Promise.all([
        (0, import_promises.stat)(lockPath).catch(() => null),
        readJson((0, import_node_path.join)(lockPath, "owner.json"))
      ]);
      if (lockInfo && Date.now() - lockInfo.mtimeMs > staleMs && !processIsAlive(Number(owner?.pid))) {
        const abandonedLock = `${lockPath}.abandoned-${process.pid}-${ownerToken}`;
        try {
          await (0, import_promises.rename)(lockPath, abandonedLock);
          await (0, import_promises.rm)(abandonedLock, { recursive: true, force: true });
        } catch (recoveryError) {
          if (!await exists(lockPath)) continue;
          if (!["ENOENT", "EEXIST", "EPERM", "EACCES"].includes(recoveryError?.code)) throw recoveryError;
        }
        continue;
      }
      await wait(100);
    }
  }
  throw new Error("Another lifecycle operation is still running.");
}
async function nodeVersion(executable, execute) {
  try {
    const { stdout = "" } = await execute(executable, ["--version"]);
    const match = String(stdout).trim().match(/^v?(\d+)(?:\.(\d+))?/);
    if (!match) return null;
    return { text: String(stdout).trim().replace(/^v/, ""), major: Number(match[1]) };
  } catch {
    return null;
  }
}
function bridgeDataRoot({
  platform = process.platform,
  home = (0, import_node_os.homedir)(),
  localAppData = process.env.LOCALAPPDATA
} = {}) {
  if (platform === "win32") {
    return (0, import_node_path.join)(localAppData || (0, import_node_path.join)(home, "AppData", "Local"), "OpenCodexMicro");
  }
  return (0, import_node_path.join)(home, "Library", "Application Support", "OpenCodexMicro");
}
async function selectBridgeNodeRuntime({
  home = (0, import_node_os.homedir)(),
  fallbackNodeExecutable = process.execPath,
  environmentPath = process.env.PATH || "",
  platform = process.platform,
  execute = execFileAsync2
} = {}) {
  const candidates = [];
  if (platform === "darwin" && await exists("/bin/zsh", import_node_fs.constants.X_OK)) {
    try {
      const { stdout = "" } = await execute("/bin/zsh", ["-lic", "node -p process.execPath"]);
      const discovered = String(stdout).split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith("/") && line.split("/").at(-1) === "node");
      if (discovered) candidates.push(await (0, import_promises.realpath)(discovered));
    } catch {
    }
  }
  const nodeName = platform === "win32" ? "node.exe" : "node";
  for (const directory of environmentPath.split(import_node_path.delimiter).filter(Boolean)) {
    candidates.push((0, import_node_path.join)(directory, nodeName));
  }
  if (platform === "darwin") {
    candidates.push(
      "/opt/homebrew/bin/node",
      "/usr/local/bin/node",
      "/usr/bin/node",
      (0, import_node_path.join)(home, ".local", "bin", "node")
    );
  }
  let resolvedFallback = fallbackNodeExecutable;
  try {
    resolvedFallback = await (0, import_promises.realpath)(fallbackNodeExecutable);
  } catch {
  }
  for (const executable of [...new Set(candidates)]) {
    if (!(0, import_node_path.isAbsolute)(executable)) continue;
    if (!await exists(executable, platform === "win32" ? import_node_fs.constants.F_OK : import_node_fs.constants.X_OK)) continue;
    const resolvedExecutable = await (0, import_promises.realpath)(executable);
    if (resolvedExecutable === resolvedFallback) continue;
    const candidateVersion = await nodeVersion(resolvedExecutable, execute);
    if (candidateVersion?.major >= 20) {
      return { executable: resolvedExecutable, version: candidateVersion.text, source: "system" };
    }
  }
  if (await exists(resolvedFallback, platform === "win32" ? import_node_fs.constants.F_OK : import_node_fs.constants.X_OK)) {
    const fallbackVersion = await nodeVersion(resolvedFallback, execute);
    if (fallbackVersion?.major >= 20) {
      return { executable: resolvedFallback, version: fallbackVersion.text, source: "ulanzi" };
    }
  }
  throw new Error("No compatible Node.js 20 or later runtime was found.");
}
function createBridgeInstaller({
  pluginRoot,
  bridgeUrl,
  version,
  home = (0, import_node_os.homedir)(),
  localAppData = process.env.LOCALAPPDATA,
  uid = process.getuid?.(),
  platform = process.platform,
  nodeExecutable = process.execPath,
  environmentPath = process.env.PATH || "",
  codexChannel = process.env.CODEX_DESKTOP_CHANNEL || "stable",
  execute = execFileAsync2,
  spawnProcess = import_node_child_process2.spawn,
  fetchImpl = fetch,
  serviceStartTimeoutMs = 8e3,
  wait = (milliseconds) => new Promise((resolve3) => setTimeout(resolve3, milliseconds))
}) {
  const appRoot = bridgeDataRoot({ platform, home, localAppData });
  const bridgeRuntime = (0, import_node_path.join)(appRoot, "bridge.mjs");
  const tokenPath = (0, import_node_path.join)(appRoot, "bridge-token");
  const pidPath = (0, import_node_path.join)(appRoot, "bridge.pid");
  const installMetadata = (0, import_node_path.join)(appRoot, "install.json");
  const lifecycleLock = (0, import_node_path.join)((0, import_node_path.dirname)(appRoot), ".OpenCodexMicro.lifecycle.lock");
  const installerRoot = (0, import_node_path.resolve)(pluginRoot, "installer");
  const bundledRuntime = (0, import_node_path.join)(installerRoot, "bridge.mjs");
  const bundledIcon = (0, import_node_path.join)(installerRoot, "CodexBridge.png");
  const bundledNativeRuntime = (0, import_node_path.join)(installerRoot, "native-runtime");
  const nativeRuntimesRoot = (0, import_node_path.join)(appRoot, "native-runtimes");
  const runtimeBackup = (0, import_node_path.join)(appRoot, ".bridge.mjs.previous");
  const metadataBackup = (0, import_node_path.join)(appRoot, ".install.json.previous");
  const userApplications = (0, import_node_path.join)(home, "Applications");
  const bridgeApp = (0, import_node_path.join)(userApplications, "Codex Bridge.app");
  const bridgeContents = (0, import_node_path.join)(bridgeApp, "Contents");
  const bridgeMacOS = (0, import_node_path.join)(bridgeContents, "MacOS");
  const bridgeResources = (0, import_node_path.join)(bridgeContents, "Resources");
  const bridgeLicenses = (0, import_node_path.join)(bridgeResources, "licenses");
  const bridgeExecutable = (0, import_node_path.join)(bridgeMacOS, "Codex Bridge");
  const bridgeIcon = (0, import_node_path.join)(bridgeResources, "CodexBridge.icns");
  const agentsRoot = (0, import_node_path.join)(home, "Library", "LaunchAgents");
  const bridgeAgent = (0, import_node_path.join)(agentsRoot, "io.opencodexmicro.bridge.plist");
  let lastWindowsServiceStart = 0;
  let authorizationCache = null;
  let authorizationPromise = null;
  let authorizationGeneration = 0;
  let lifecycleOperation = null;
  function resetAuthorizationCache() {
    authorizationGeneration += 1;
    authorizationCache = null;
    authorizationPromise = null;
  }
  async function authorizationHeaders() {
    if (authorizationCache) return authorizationCache;
    if (authorizationPromise) return authorizationPromise;
    const generation = authorizationGeneration;
    const operation = (async () => {
      try {
        const token = (await (0, import_promises.readFile)(tokenPath, "utf8")).trim();
        const headers = token ? Object.freeze({ Authorization: `Bearer ${token}` }) : {};
        if (token && generation === authorizationGeneration) authorizationCache = headers;
        return headers;
      } catch {
        return {};
      }
    })();
    authorizationPromise = operation;
    try {
      return await operation;
    } finally {
      if (authorizationPromise === operation) authorizationPromise = null;
    }
  }
  async function probeBridge() {
    try {
      const response = await fetchImpl(`${bridgeUrl}/health`, {
        headers: await authorizationHeaders(),
        signal: AbortSignal.timeout(1200)
      });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) throw new Error(payload.error || `Bridge HTTP ${response.status}`);
      return {
        serviceOnline: true,
        cdpConnected: Boolean(payload.codexConnected),
        serviceVersion: typeof payload.bridgeVersion === "string" ? payload.bridgeVersion : null,
        serviceRuntimeHash: typeof payload.runtimeHash === "string" ? payload.runtimeHash : null,
        serviceNativeRuntimeHash: typeof payload.nativeRuntimeHash === "string" ? payload.nativeRuntimeHash : null,
        serviceError: null
      };
    } catch (error) {
      return {
        serviceOnline: false,
        cdpConnected: false,
        serviceVersion: null,
        serviceRuntimeHash: null,
        serviceNativeRuntimeHash: null,
        serviceError: error.message
      };
    }
  }
  async function status() {
    const [runtimeInstalled, tokenInstalled, metadata, probe, bundledRuntimeHash, installedRuntimeHash] = await Promise.all([
      exists(bridgeRuntime),
      exists(tokenPath),
      readJson(installMetadata),
      probeBridge(),
      fileSha256(bundledRuntime),
      fileSha256(bridgeRuntime)
    ]);
    const bundledNativeRuntimeHash = platform === "win32" ? await verifiedNativeRuntimeHash(bundledNativeRuntime) : null;
    const installedNativeRuntimeHash = platform === "win32" && metadata?.nativeRuntimeHash ? await verifiedNativeRuntimeHash((0, import_node_path.join)(nativeRuntimesRoot, metadata.nativeRuntimeHash)) : null;
    const nativeRuntimeInstalled = platform !== "win32" || Boolean(
      bundledNativeRuntimeHash && installedNativeRuntimeHash === bundledNativeRuntimeHash && metadata?.nativeRuntimeHash === bundledNativeRuntimeHash
    );
    const macAppInstalled = platform === "darwin" ? await exists(bridgeExecutable, import_node_fs.constants.X_OK) : runtimeInstalled;
    const agentInstalled = platform === "darwin" ? await exists(bridgeAgent) : true;
    const installed = macAppInstalled && runtimeInstalled && tokenInstalled && agentInstalled && nativeRuntimeInstalled;
    const installationDetected = Boolean(
      runtimeInstalled || tokenInstalled || metadata || probe.serviceOnline || platform === "darwin" && (macAppInstalled || agentInstalled)
    );
    const metadataMatchesBundle = Boolean(
      bundledRuntimeHash && metadata?.version === version && metadata?.runtimeHash === bundledRuntimeHash && installedRuntimeHash === bundledRuntimeHash && nativeRuntimeInstalled
    );
    const runningMatchesBundle = !probe.serviceOnline || Boolean(
      bundledRuntimeHash && probe.serviceVersion === version && probe.serviceRuntimeHash === bundledRuntimeHash && (platform !== "win32" || probe.serviceNativeRuntimeHash === bundledNativeRuntimeHash)
    );
    return {
      supported: platform === "win32" || platform === "darwin" && Number.isInteger(uid),
      platform,
      installed,
      installationDetected,
      appInstalled: macAppInstalled,
      serviceInstalled: runtimeInstalled && tokenInstalled && agentInstalled,
      installedVersion: metadata?.version || null,
      bundledVersion: version,
      bundledRuntimeHash,
      installedRuntimeHash,
      bundledNativeRuntimeHash,
      installedNativeRuntimeHash,
      needsUpdate: !installed || !metadataMatchesBundle || !runningMatchesBundle,
      appPath: platform === "darwin" ? bridgeApp : appRoot,
      nodeExecutable: metadata?.nodeExecutable || null,
      nodeVersion: metadata?.nodeVersion || null,
      nodeSource: metadata?.nodeSource || null,
      codexChannel: metadata?.codexChannel || codexChannel,
      ...probe
    };
  }
  async function buildMacIcon() {
    const iconset = (0, import_node_path.join)(appRoot, "CodexBridge.iconset");
    await (0, import_promises.rm)(iconset, { recursive: true, force: true });
    await (0, import_promises.mkdir)(iconset, { recursive: true });
    try {
      for (const [name, size] of [
        ["icon_16x16.png", 16],
        ["icon_16x16@2x.png", 32],
        ["icon_32x32.png", 32],
        ["icon_32x32@2x.png", 64],
        ["icon_128x128.png", 128],
        ["icon_128x128@2x.png", 256],
        ["icon_256x256.png", 256],
        ["icon_256x256@2x.png", 512],
        ["icon_512x512.png", 512],
        ["icon_512x512@2x.png", 1024]
      ]) {
        await execute("/usr/bin/sips", ["-z", String(size), String(size), bundledIcon, "--out", (0, import_node_path.join)(iconset, name)]);
      }
      await execute("/usr/bin/iconutil", ["-c", "icns", iconset, "-o", bridgeIcon]);
    } finally {
      await (0, import_promises.rm)(iconset, { recursive: true, force: true });
    }
  }
  async function installMac(nodeRuntime, appVersion = version) {
    await (0, import_promises.mkdir)(userApplications, { recursive: true });
    await (0, import_promises.mkdir)(agentsRoot, { recursive: true });
    await (0, import_promises.rm)(bridgeApp, { recursive: true, force: true });
    await (0, import_promises.mkdir)(bridgeMacOS, { recursive: true });
    await (0, import_promises.mkdir)(bridgeLicenses, { recursive: true });
    for (const notice of ["LICENSE", "NOTICE.md", "THIRD_PARTY_NOTICES.md"]) {
      await (0, import_promises.copyFile)((0, import_node_path.join)(installerRoot, notice), (0, import_node_path.join)(bridgeLicenses, notice));
    }
    await buildMacIcon();
    await (0, import_promises.writeFile)((0, import_node_path.join)(bridgeContents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleDisplayName</key><string>Codex Bridge</string>
  <key>CFBundleExecutable</key><string>Codex Bridge</string>
  <key>CFBundleIconFile</key><string>CodexBridge</string>
  <key>CFBundleIdentifier</key><string>io.opencodexmicro.bridge</string>
  <key>CFBundleName</key><string>Codex Bridge</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${xml(appVersion)}</string>
  <key>CFBundleVersion</key><string>${xml(appVersion)}</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
`);
    await (0, import_promises.writeFile)(bridgeExecutable, `#!/bin/zsh
set -u
codex_binary="/Applications/ChatGPT.app/Contents/MacOS/ChatGPT"
if [[ ! -x "$codex_binary" ]]; then exit 1; fi
if /usr/bin/pgrep -x ChatGPT >/dev/null 2>&1; then
  /usr/bin/osascript -e 'tell application id "com.openai.codex" to quit'
  for attempt in {1..80}; do /usr/bin/pgrep -x ChatGPT >/dev/null 2>&1 || break; /bin/sleep 0.1; done
fi
if /usr/bin/pgrep -x ChatGPT >/dev/null 2>&1; then exit 1; fi
/usr/bin/nohup "$codex_binary" ${["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=9222", "--remote-allow-origins=http://127.0.0.1:9222"].join(" ")} >/dev/null 2>&1 &
`, { mode: 493 });
    await (0, import_promises.chmod)(bridgeExecutable, 493);
    await execute("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", bridgeApp]);
    await (0, import_promises.writeFile)(bridgeAgent, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>io.opencodexmicro.bridge</string>
  <key>ProgramArguments</key><array><string>${xml(nodeRuntime.executable)}</string><string>${xml(bridgeRuntime)}</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>CODEX_BRIDGE_DATA_ROOT</key><string>${xml(appRoot)}</string>
  </dict>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string><key>ThrottleInterval</key><integer>2</integer>
  <key>StandardOutPath</key><string>${xml((0, import_node_path.join)(appRoot, "bridge.log"))}</string>
  <key>StandardErrorPath</key><string>${xml((0, import_node_path.join)(appRoot, "bridge-error.log"))}</string>
</dict></plist>
`, { mode: 420 });
    await execute("/bin/launchctl", ["bootstrap", `gui/${uid}`, bridgeAgent]);
  }
  async function acquireLifecycleLock() {
    await (0, import_promises.mkdir)(appRoot, { recursive: true, mode: 448 });
    return acquireFilesystemLock({ lockPath: lifecycleLock, wait });
  }
  function serializeLifecycle(operation) {
    if (lifecycleOperation) return lifecycleOperation;
    const running = (async () => {
      const release = await acquireLifecycleLock();
      try {
        if (!await exists(bridgeRuntime) && await exists(runtimeBackup)) {
          await (0, import_promises.rename)(runtimeBackup, bridgeRuntime);
        }
        if (!await exists(installMetadata) && await exists(metadataBackup)) {
          await (0, import_promises.rename)(metadataBackup, installMetadata);
        }
        return await operation();
      } finally {
        await release();
      }
    })();
    lifecycleOperation = running;
    return running.finally(() => {
      if (lifecycleOperation === running) lifecycleOperation = null;
    });
  }
  async function stopWindowsService() {
    const recordedPid = Number((await (0, import_promises.readFile)(pidPath, "utf8").catch(() => "")).trim());
    const stopScript = `$target=$env:CODEX_BRIDGE_TARGET_RUNTIME; $targetPid=0; [void][int]::TryParse($env:CODEX_BRIDGE_TARGET_PID, [ref]$targetPid); $candidates=@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.Name -like 'node*' -and $_.CommandLine -and ($_.CommandLine.TrimEnd().EndsWith($target, [System.StringComparison]::OrdinalIgnoreCase) -or $_.CommandLine.TrimEnd().EndsWith(('"' + $target + '"'), [System.StringComparison]::OrdinalIgnoreCase)) }); $processes=if ($targetPid -gt 0) { @($candidates | Where-Object { $_.ProcessId -eq $targetPid }) } else { $candidates }; $processes | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; $processes | ForEach-Object { try { Wait-Process -Id $_.ProcessId -Timeout 5 -ErrorAction Stop } catch {} }`;
    await execute("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", stopScript], {
      timeout: 7e3,
      windowsHide: true,
      env: {
        ...process.env,
        CODEX_BRIDGE_TARGET_RUNTIME: bridgeRuntime,
        CODEX_BRIDGE_TARGET_PID: Number.isInteger(recordedPid) && recordedPid > 0 ? String(recordedPid) : ""
      }
    });
    await (0, import_promises.rm)(pidPath, { force: true });
    lastWindowsServiceStart = 0;
  }
  async function waitForServiceOffline() {
    const deadline = Date.now() + Math.min(serviceStartTimeoutMs, 5e3);
    do {
      if (!(await probeBridge()).serviceOnline) return;
      await wait(100);
    } while (Date.now() < deadline);
    throw new Error("The managed Codex Bridge process did not stop before replacement.");
  }
  async function stopService() {
    if (platform === "darwin") {
      const wasOnline = (await probeBridge()).serviceOnline;
      if (await exists(bridgeAgent)) {
        try {
          await execute("/bin/launchctl", ["bootout", `gui/${uid}`, bridgeAgent]);
        } catch (error) {
          if (wasOnline) throw new Error(`Codex Bridge LaunchAgent could not be stopped: ${error.message}`);
        }
      }
      if (wasOnline) await waitForServiceOffline();
      return;
    }
    if (platform === "win32") await stopWindowsService();
  }
  async function commitRuntime(stagedRuntime) {
    await (0, import_promises.rm)(runtimeBackup, { force: true });
    if (await exists(bridgeRuntime)) await (0, import_promises.rename)(bridgeRuntime, runtimeBackup);
    try {
      await (0, import_promises.rename)(stagedRuntime, bridgeRuntime);
    } catch (error) {
      if (!await exists(bridgeRuntime) && await exists(runtimeBackup)) {
        await (0, import_promises.rename)(runtimeBackup, bridgeRuntime);
      }
      throw error;
    }
  }
  async function restorePreviousRuntime(previousRuntime) {
    await (0, import_promises.rm)(bridgeRuntime, { force: true });
    if (await exists(runtimeBackup)) {
      await (0, import_promises.rename)(runtimeBackup, bridgeRuntime);
      return;
    }
    if (previousRuntime) {
      const rollbackRuntime = (0, import_node_path.join)(appRoot, `.bridge.mjs.rollback-${process.pid}`);
      await (0, import_promises.writeFile)(rollbackRuntime, previousRuntime);
      await (0, import_promises.rename)(rollbackRuntime, bridgeRuntime);
    }
  }
  async function commitMetadata(metadataText) {
    const stagedMetadata = (0, import_node_path.join)(appRoot, `.install.json.installing-${process.pid}`);
    await (0, import_promises.writeFile)(stagedMetadata, metadataText, { mode: 384 });
    await (0, import_promises.rm)(metadataBackup, { force: true });
    if (await exists(installMetadata)) await (0, import_promises.rename)(installMetadata, metadataBackup);
    try {
      await (0, import_promises.rename)(stagedMetadata, installMetadata);
    } catch (error) {
      if (!await exists(installMetadata) && await exists(metadataBackup)) {
        await (0, import_promises.rename)(metadataBackup, installMetadata);
      }
      throw error;
    }
  }
  async function restorePreviousMetadata(previousMetadataText, useBackup = true) {
    await (0, import_promises.rm)(installMetadata, { force: true });
    if (useBackup && await exists(metadataBackup)) {
      await (0, import_promises.rename)(metadataBackup, installMetadata);
      return;
    }
    await (0, import_promises.rm)(metadataBackup, { force: true });
    if (previousMetadataText) {
      await (0, import_promises.writeFile)(installMetadata, previousMetadataText, { mode: 384 });
    }
  }
  async function discardTransactionBackups() {
    await Promise.all([
      (0, import_promises.rm)(runtimeBackup, { force: true }),
      (0, import_promises.rm)(metadataBackup, { force: true })
    ]);
  }
  async function startInstalledService(metadata) {
    if (!metadata?.nodeExecutable) {
      throw new Error("Codex Bridge runtime metadata is missing its Node.js executable.");
    }
    if (platform === "darwin") {
      await installMac({
        executable: metadata.nodeExecutable,
        version: metadata.nodeVersion || "unknown",
        source: metadata.nodeSource || "unknown"
      }, metadata.version || "0.0.0");
    }
    if (platform === "win32") await ensureServiceUnlocked();
  }
  async function waitForAnyService() {
    const deadline = Date.now() + serviceStartTimeoutMs;
    do {
      const probe = await probeBridge();
      if (probe.serviceOnline) return probe;
      await wait(100);
    } while (Date.now() < deadline);
    throw new Error("The restored Codex Bridge service did not become reachable.");
  }
  async function rollbackInterruptedUpdate() {
    const hasRuntimeBackup = await exists(runtimeBackup);
    const hasMetadataBackup = await exists(metadataBackup);
    if (!hasRuntimeBackup && !hasMetadataBackup) return false;
    await stopService();
    if (hasRuntimeBackup) {
      await (0, import_promises.rm)(bridgeRuntime, { force: true });
      await (0, import_promises.rename)(runtimeBackup, bridgeRuntime);
    }
    if (hasMetadataBackup) {
      await (0, import_promises.rm)(installMetadata, { force: true });
      await (0, import_promises.rename)(metadataBackup, installMetadata);
    }
    resetAuthorizationCache();
    const restoredMetadata = await readJson(installMetadata);
    await startInstalledService(restoredMetadata);
    await waitForAnyService();
    return true;
  }
  async function waitForExpectedService(expectedRuntimeHash, expectedVersion = version, expectedNativeRuntimeHash = null) {
    const deadline = Date.now() + serviceStartTimeoutMs;
    let lastProbe = null;
    do {
      lastProbe = await probeBridge();
      if (lastProbe.serviceOnline && lastProbe.serviceVersion === expectedVersion && lastProbe.serviceRuntimeHash === expectedRuntimeHash && (platform !== "win32" || lastProbe.serviceNativeRuntimeHash === expectedNativeRuntimeHash)) {
        return lastProbe;
      }
      await wait(100);
    } while (Date.now() < deadline);
    const detail = lastProbe?.serviceOnline ? "the running process reported a different build" : "the restarted service did not become reachable";
    throw new Error(`Codex Bridge ${expectedVersion} restart failed: ${detail}.`);
  }
  async function installUnlocked() {
    if (!(platform === "win32" || platform === "darwin" && Number.isInteger(uid))) {
      throw new Error("Codex Bridge installation is supported on Windows and macOS only.");
    }
    if (!await exists(bundledRuntime) || !await exists(bundledIcon) || platform === "win32" && !await verifiedNativeRuntimeHash(bundledNativeRuntime)) {
      throw new Error("The plugin does not contain the Codex Bridge installation resources.");
    }
    const nodeRuntime = await selectBridgeNodeRuntime({
      home,
      fallbackNodeExecutable: nodeExecutable,
      environmentPath,
      platform,
      execute
    });
    const previousStatus = await status();
    const previousRuntime = await (0, import_promises.readFile)(bridgeRuntime).catch(() => null);
    const previousRuntimeHash = previousRuntime ? (0, import_node_crypto.createHash)("sha256").update(previousRuntime).digest("hex") : null;
    const previousMetadataText = await (0, import_promises.readFile)(installMetadata, "utf8").catch(() => null);
    const previousMetadata = await readJson(installMetadata);
    const nativeRuntimeHash = platform === "win32" ? previousStatus.bundledNativeRuntimeHash : null;
    const nativeRuntime = nativeRuntimeHash ? (0, import_node_path.join)(nativeRuntimesRoot, nativeRuntimeHash) : null;
    let createdNativeRuntime = false;
    if (nativeRuntimeHash && await verifiedNativeRuntimeHash(nativeRuntime) !== nativeRuntimeHash) {
      const stagedNativeRuntime = (0, import_node_path.join)(appRoot, `.native-runtime.installing-${process.pid}`);
      await (0, import_promises.rm)(stagedNativeRuntime, { recursive: true, force: true });
      await (0, import_promises.cp)(bundledNativeRuntime, stagedNativeRuntime, { recursive: true });
      if (await verifiedNativeRuntimeHash(stagedNativeRuntime) !== nativeRuntimeHash) {
        await (0, import_promises.rm)(stagedNativeRuntime, { recursive: true, force: true });
        throw new Error("The bundled native focus runtime could not be verified.");
      }
      await (0, import_promises.mkdir)(nativeRuntimesRoot, { recursive: true });
      await (0, import_promises.rm)(nativeRuntime, { recursive: true, force: true });
      await (0, import_promises.rename)(stagedNativeRuntime, nativeRuntime);
      createdNativeRuntime = true;
    }
    const stagedRuntime = (0, import_node_path.join)(appRoot, `.bridge.mjs.installing-${process.pid}`);
    await (0, import_promises.mkdir)(appRoot, { recursive: true, mode: 448 });
    if (platform !== "win32") await (0, import_promises.chmod)(appRoot, 448);
    await (0, import_promises.rm)(stagedRuntime, { force: true });
    await (0, import_promises.copyFile)(bundledRuntime, stagedRuntime);
    const runtimeHash = await fileSha256(stagedRuntime);
    if (!runtimeHash) throw new Error("The bundled Codex Bridge runtime could not be verified.");
    console.log(`[Codex Bridge] ${previousStatus.installed ? "Updating" : "Installing"} ${version}; stopping only the managed Bridge process.`);
    try {
      await stopService();
      await commitRuntime(stagedRuntime);
      for (const notice of ["LICENSE", "NOTICE.md", "THIRD_PARTY_NOTICES.md"]) {
        await (0, import_promises.copyFile)((0, import_node_path.join)(installerRoot, notice), (0, import_node_path.join)(appRoot, notice));
      }
      if (!await exists(tokenPath)) {
        await (0, import_promises.writeFile)(tokenPath, `${(0, import_node_crypto.randomBytes)(32).toString("base64url")}
`, { mode: 384 });
      }
      resetAuthorizationCache();
      await commitMetadata(`${JSON.stringify({
        version,
        runtimeHash,
        nativeRuntimeHash,
        platform,
        codexChannel,
        nodeExecutable: nodeRuntime.executable,
        nodeVersion: nodeRuntime.version,
        nodeSource: nodeRuntime.source,
        installedAt: (/* @__PURE__ */ new Date()).toISOString()
      }, null, 2)}
`);
      if (platform === "darwin") await installMac(nodeRuntime);
      if (platform === "win32") await ensureServiceUnlocked();
      await waitForExpectedService(runtimeHash, version, nativeRuntimeHash);
      const installed = await status();
      if (installed.needsUpdate) throw new Error("The restarted Codex Bridge did not match the bundled runtime.");
      await discardTransactionBackups();
      console.log(`[Codex Bridge] ${version} is installed and the restarted process reported the expected build.`);
      return installed;
    } catch (error) {
      console.error(`[Codex Bridge] ${version} update failed; restoring the previous managed runtime.`);
      let rollbackError = null;
      try {
        await stopService();
        if (previousRuntime) {
          await restorePreviousRuntime(previousRuntime);
          const recoveryVersion = previousMetadata?.version || previousStatus.serviceVersion || "0.0.0";
          const recoveryMetadataText = previousMetadata ? previousMetadataText : `${JSON.stringify({
            version: recoveryVersion,
            runtimeHash: previousRuntimeHash,
            nativeRuntimeHash: previousMetadata?.nativeRuntimeHash || null,
            platform,
            codexChannel: previousStatus.codexChannel || codexChannel,
            nodeExecutable: nodeRuntime.executable,
            nodeVersion: nodeRuntime.version,
            nodeSource: nodeRuntime.source,
            installedAt: (/* @__PURE__ */ new Date()).toISOString(),
            recovered: true
          }, null, 2)}
`;
          await restorePreviousMetadata(recoveryMetadataText, Boolean(previousMetadata));
          resetAuthorizationCache();
          const restoredMetadata = await readJson(installMetadata);
          if (restoredMetadata?.nodeExecutable) {
            const previousNodeRuntime = {
              executable: restoredMetadata.nodeExecutable,
              version: restoredMetadata.nodeVersion || "unknown",
              source: restoredMetadata.nodeSource || "unknown"
            };
            if (platform === "darwin") await installMac(previousNodeRuntime, restoredMetadata.version || "0.0.0");
            if (platform === "win32") await ensureServiceUnlocked();
          }
        } else {
          if (platform === "darwin") {
            await (0, import_promises.rm)(bridgeAgent, { force: true });
            await (0, import_promises.rm)(bridgeApp, { recursive: true, force: true });
          }
          await (0, import_promises.rm)(appRoot, { recursive: true, force: true });
          resetAuthorizationCache();
        }
        if (createdNativeRuntime && nativeRuntime && previousMetadata?.nativeRuntimeHash !== nativeRuntimeHash) {
          await (0, import_promises.rm)(nativeRuntime, { recursive: true, force: true });
        }
      } catch (rollbackFailure) {
        rollbackError = rollbackFailure;
      }
      const rollbackDetail = rollbackError ? ` Rollback also failed: ${rollbackError.message}` : " Previous runtime restored.";
      throw new Error(`Codex Bridge installation failed: ${error.message}${rollbackDetail}`);
    } finally {
      await (0, import_promises.rm)(stagedRuntime, { force: true });
    }
  }
  async function install() {
    return serializeLifecycle(installUnlocked);
  }
  async function ensureServiceUnlocked() {
    if (platform !== "win32") return status();
    const probe = await probeBridge();
    if (probe.serviceOnline || Date.now() - lastWindowsServiceStart < 2e3) return { ...await status(), ...probe };
    const metadata = await readJson(installMetadata);
    const nativeRuntimeValid = !metadata?.nativeRuntimeHash || await verifiedNativeRuntimeHash((0, import_node_path.join)(nativeRuntimesRoot, metadata.nativeRuntimeHash)) === metadata.nativeRuntimeHash;
    if (!metadata?.nodeExecutable || !await exists(bridgeRuntime) || !await exists(tokenPath) || !nativeRuntimeValid) {
      throw new Error("Codex Bridge is not installed. Use Install / Repair first.");
    }
    const token = (await (0, import_promises.readFile)(tokenPath, "utf8")).trim();
    const child = spawnProcess(metadata.nodeExecutable, [bridgeRuntime], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: {
        ...process.env,
        CODEX_BRIDGE_DATA_ROOT: appRoot,
        CODEX_BRIDGE_TOKEN: token,
        ...metadata.nativeRuntimeHash ? {
          CODEX_BRIDGE_NATIVE_ROOT: (0, import_node_path.join)(nativeRuntimesRoot, metadata.nativeRuntimeHash),
          CODEX_BRIDGE_NATIVE_HASH: metadata.nativeRuntimeHash
        } : {}
      }
    });
    if (Number.isInteger(child.pid) && child.pid > 0) {
      await (0, import_promises.writeFile)(pidPath, `${child.pid}
`, { mode: 384 });
    } else {
      await (0, import_promises.rm)(pidPath, { force: true });
    }
    child.unref?.();
    lastWindowsServiceStart = Date.now();
    return status();
  }
  async function ensureService() {
    return serializeLifecycle(ensureServiceUnlocked);
  }
  async function ensureCurrent() {
    return serializeLifecycle(async () => {
      const current = await status();
      if (!current.installationDetected) return current;
      const interruptedUpdate = await exists(runtimeBackup) || await exists(metadataBackup);
      if (interruptedUpdate && current.needsUpdate) {
        await rollbackInterruptedUpdate();
        console.log("[Codex Bridge] Interrupted update rolled back; retrying the bundled update in the same lifecycle operation.");
        return installUnlocked();
      }
      if (!current.installed || current.needsUpdate) {
        console.log(`[Codex Bridge] Installed or running build differs from bundled ${version}; starting automatic update.`);
        return installUnlocked();
      }
      if (!current.serviceOnline) {
        try {
          await startInstalledService(await readJson(installMetadata));
          await waitForExpectedService(
            current.bundledRuntimeHash,
            version,
            current.bundledNativeRuntimeHash
          );
          const ready = await status();
          await discardTransactionBackups();
          return ready;
        } catch (error) {
          if (interruptedUpdate && await rollbackInterruptedUpdate()) {
            console.log("[Codex Bridge] Interrupted restart rolled back; retrying the bundled update once.");
            return installUnlocked();
          }
          throw error;
        }
      }
      await discardTransactionBackups();
      return current;
    });
  }
  async function launch() {
    const current = await ensureCurrent();
    if (!current.installed) throw new Error("Codex Bridge is not installed. Use Install / Repair first.");
    if (platform === "darwin") {
      await execute("/usr/bin/open", [bridgeApp]);
      return status();
    }
    if (platform === "win32") {
      await ensureService();
      try {
        await discoverDebugEndpoint({ platform, execute, fetchImpl });
        const response = await fetchImpl(`${bridgeUrl}/focus`, {
          method: "POST",
          headers: await authorizationHeaders(),
          signal: AbortSignal.timeout(1200)
        });
        const payload = await response.json();
        if (!response.ok || payload?.ok !== true) {
          throw new Error(payload?.error || "Codex focus request failed");
        }
      } catch (error) {
        if (!/local debug bridge/.test(error.message)) throw error;
        await launchWindowsCodex({ channel: codexChannel, execute, spawnProcess });
      }
      return status();
    }
    throw new Error(`Codex Bridge launch is not supported on ${platform}.`);
  }
  async function uninstallUnlocked() {
    if (!(platform === "win32" || platform === "darwin" && Number.isInteger(uid))) {
      throw new Error("Codex Bridge uninstallation is supported on Windows and macOS only.");
    }
    if (platform === "darwin") {
      await stopService();
      await (0, import_promises.rm)(bridgeAgent, { force: true });
      await (0, import_promises.rm)(bridgeApp, { recursive: true, force: true });
    } else {
      try {
        await stopService();
      } catch {
      }
    }
    await (0, import_promises.rm)(appRoot, { recursive: true, force: true });
    resetAuthorizationCache();
    return status();
  }
  async function uninstall() {
    return serializeLifecycle(uninstallUnlocked);
  }
  return { status, install, launch, uninstall, ensureService, ensureCurrent, authorizationHeaders };
}

// plugin/app.js
var PLUGIN_UUID = "com.ulanzi.ulanzistudio.codexmicro";
var BRIDGE_URL = process.env.CODEX_BRIDGE_URL || "http://127.0.0.1:17373";
var [address = "127.0.0.1", port = "3906"] = process.argv.slice(2);
var HOST_URL = `ws://${address}:${port}`;
var instances = /* @__PURE__ */ new Map();
var PLUGIN_ROOT = (0, import_node_path2.resolve)((0, import_node_path2.dirname)((0, import_node_path2.resolve)(process.argv[1])), "..");
var MANIFEST = JSON.parse((0, import_node_fs2.readFileSync)((0, import_node_path2.resolve)(PLUGIN_ROOT, "manifest.json"), "utf8"));
var bridgeSetup = createBridgeInstaller({
  pluginRoot: PLUGIN_ROOT,
  bridgeUrl: BRIDGE_URL,
  version: MANIFEST.Version
});
var bridgeReconcilePromise = null;
var bridgeReconcileRetryTimer = null;
var bridgeReconcileFailures = 0;
function scheduleBridgeReconcileRetry() {
  if (bridgeReconcileRetryTimer || bridgeReconcileFailures >= 3) return;
  const delay = Math.min(1e4, 2e3 * 2 ** bridgeReconcileFailures);
  bridgeReconcileFailures += 1;
  bridgeReconcileRetryTimer = setTimeout(() => {
    bridgeReconcileRetryTimer = null;
    void ensureBundledBridgeCurrent().catch((error) => {
      console.error(`[Codex Micro] Bridge reconciliation retry failed: ${error.message}`);
    });
  }, delay);
  bridgeReconcileRetryTimer.unref?.();
}
function ensureBundledBridgeCurrent() {
  if (!bridgeReconcilePromise) {
    const running = (async () => {
      const before = await bridgeSetup.status();
      if (!before.installationDetected) return before;
      if (before.needsUpdate) {
        console.log(`[Codex Micro] Updating the installed Bridge to bundled version ${before.bundledVersion}.`);
      }
      const after = await bridgeSetup.ensureCurrent();
      if (before.needsUpdate) {
        console.log(`[Codex Micro] Bridge ${after.installedVersion} restarted with the bundled runtime.`);
      }
      return after;
    })();
    bridgeReconcilePromise = running;
    void running.then(() => {
      bridgeReconcileFailures = 0;
      if (bridgeReconcileRetryTimer) clearTimeout(bridgeReconcileRetryTimer);
      bridgeReconcileRetryTimer = null;
    }, () => {
      if (bridgeReconcilePromise === running) bridgeReconcilePromise = null;
      scheduleBridgeReconcileRetry();
    });
  }
  return bridgeReconcilePromise;
}
var USAGE_BASE64 = (0, import_node_fs2.readFileSync)(
  (0, import_node_path2.resolve)(PLUGIN_ROOT, "assets/icons/usage-base.png")
).toString("base64");
var ACTION_LABELS = Object.freeze({
  fast: "FAST",
  usage: "USAGE",
  pin: "PIN",
  new: "NEW",
  navigate: "LATEST",
  fork: "FORK",
  steer: "STEER",
  mic: "MIC",
  submit: "SUBMIT",
  "model-sol-high": "SOL HIGH",
  "model-luna-max": "LUNA MAX",
  "model-sol-medium": "SOL MED"
});
var DEBUG_MODEL_PRESETS = Object.freeze({
  "model-sol-high": Object.freeze({ model: "gpt-5.6-sol", effort: "high" }),
  "model-luna-max": Object.freeze({ model: "gpt-5.6-luna", effort: "max" }),
  "model-sol-medium": Object.freeze({ model: "gpt-5.6-sol", effort: "medium" })
});
var TASK_STATUS_PALETTES = Object.freeze({
  idle: { frame: "#475467", accent: "#98a2b3" },
  working: { frame: "#0b5fcc", accent: "#2589f5" },
  complete: { frame: "#087443", accent: "#28b875" },
  attention: { frame: "#9a6700", accent: "#ed9f20" },
  error: { frame: "#b42318", accent: "#e34d62" }
});
var TASK_COMPLETE_FLASH_PALETTE = Object.freeze({ frame: "#12b76a", accent: "#6ce9a6" });
var TASK_TITLE_MAX_UNITS = 10;
var TASK_TITLE_MAX_LINES = 4;
var TASK_TITLE_SEGMENTER = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(void 0, { granularity: "grapheme" }) : null;
var socket;
var reconnectTimer;
var pollTimer;
var pollInFlight = false;
var latestState = null;
var setupOperation = null;
var completeFlashOn = false;
var shortcutInvocationSequence = 0;
var forwardedTraceEvents = /* @__PURE__ */ new Map();
function contextOf(message) {
  return String(message.actionid || `${message.uuid}___${message.key}`);
}
function taskSlot(uuid) {
  const match = String(uuid || "").match(/\.task([1-5])$/);
  return match ? Number(match[1]) - 1 : null;
}
function actionName(uuid) {
  const name = String(uuid || "").split(".").at(-1);
  return Object.hasOwn(ACTION_LABELS, name) ? name : null;
}
function usageRemaining(usage) {
  const windows = Array.isArray(usage?.windows) ? usage.windows : [];
  const window = windows.find((item) => item?.kind === "weekly") ?? windows[0];
  const remaining = Number(window?.remainingPercent);
  return Number.isFinite(remaining) ? Math.max(0, Math.min(100, Math.round(remaining))) : null;
}
function usageIconData(usage) {
  const remaining = usageRemaining(usage);
  const progress = remaining === null ? "#858c8f" : remaining >= 50 ? "#2fbd7f" : remaining >= 20 ? "#e89b2d" : "#e45861";
  const circumference = 2 * Math.PI * 57;
  const filled = circumference * (remaining ?? 0) / 100;
  const value = remaining === null ? "\u2014" : String(remaining);
  const percent = remaining === null ? "" : "%";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="4.5" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <image width="196" height="196" href="data:image/png;base64,${USAGE_BASE64}" xlink:href="data:image/png;base64,${USAGE_BASE64}"/>
    <g fill="none" transform="rotate(-90 98 94)">
      <circle cx="98" cy="94" r="58.5" stroke="#ffffff" stroke-opacity=".57" stroke-width="2.4"/>
      <circle cx="98" cy="94" r="57" stroke="#5e6c68" stroke-opacity=".57" stroke-width="16"/>
      <circle cx="98" cy="94" r="57" stroke="#a0aca9" stroke-width="12"/>
      <circle cx="98" cy="94" r="57" stroke="#cdd6d3" stroke-width="6"/>
      ${remaining === null ? "" : `<circle cx="98" cy="94" r="57" stroke="${progress}" stroke-opacity=".5" stroke-width="18" stroke-linecap="butt" stroke-dasharray="${filled} ${circumference - filled}" filter="url(#glow)"/><circle cx="98" cy="94" r="57" stroke="${progress}" stroke-width="10" stroke-linecap="butt" stroke-dasharray="${filled} ${circumference - filled}"/>`}
    </g>
    <text x="98" y="105" fill="#303638" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="36" font-weight="700" text-anchor="middle">${value}${percent ? `<tspan dx="2" dy="-2" font-size="18">${percent}</tspan>` : ""}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
function send(message) {
  if (socket?.readyState === wrapper_default.OPEN) {
    socket.send(JSON.stringify(message));
  }
}
function ack(message) {
  send({
    code: 0,
    cmd: message.cmd,
    uuid: message.uuid,
    actionid: message.actionid,
    key: message.key,
    active: message.active,
    param: message.param || {}
  });
}
function sendToInspector(message, payload) {
  send({
    cmd: "sendToPropertyInspector",
    uuid: message.uuid,
    actionid: message.actionid,
    key: message.key,
    payload
  });
}
async function sendBridgeSetupStatus(message, extra = {}) {
  const status = await bridgeSetup.status();
  sendToInspector(message, {
    type: "bridgeSetupStatus",
    status,
    busy: Boolean(setupOperation),
    operation: setupOperation,
    ...extra
  });
}
async function handleBridgeSetupMessage(message) {
  const action = message.payload?.action;
  if (action === "openGuide") {
    send({
      cmd: "openurl",
      url: "https://github.com/UlanziTechnology/OpenCodexMicro#1-llm--agent-installation",
      local: false
    });
    await sendBridgeSetupStatus(message);
    return;
  }
  if (action === "status" || !action) {
    await sendBridgeSetupStatus(message);
    return;
  }
  if (!["install", "launch", "uninstall"].includes(action)) {
    await sendBridgeSetupStatus(message, { error: `Unknown setup action: ${action}` });
    return;
  }
  if (setupOperation) {
    await sendBridgeSetupStatus(message);
    return;
  }
  setupOperation = action;
  await sendBridgeSetupStatus(message);
  let result = null;
  let failure = null;
  try {
    if (action === "install") await bridgeSetup.install();
    if (action === "launch") await bridgeSetup.launch();
    if (action === "uninstall") await bridgeSetup.uninstall();
    result = action;
  } catch (error) {
    failure = error.message;
    send({
      cmd: "logMessage",
      uuid: message.uuid,
      actionid: message.actionid,
      key: message.key,
      level: "error",
      message: `Codex Bridge ${action} failed: ${error.message}`
    });
  } finally {
    setupOperation = null;
  }
  await sendBridgeSetupStatus(message, { result, error: failure });
}
function taskStatusKind(status) {
  const value = String(status || "").toLowerCase();
  if (["working", "thinking", "running", "in_progress"].includes(value)) return "working";
  if (["unread", "complete", "completed", "done", "success"].includes(value)) return "complete";
  if (["attention", "notification", "input", "approval", "waiting_input", "needs_input"].includes(value)) return "attention";
  if (["error", "failed", "failure"].includes(value)) return "error";
  return "idle";
}
function debugShortcut(uuid) {
  const slot = taskSlot(uuid);
  if (slot !== null) {
    return Object.freeze({ name: `task-${slot + 1}`, kind: "task", target: `slot-${slot + 1}` });
  }
  const action = actionName(uuid);
  const preset = DEBUG_MODEL_PRESETS[action];
  if (!preset) return null;
  return Object.freeze({
    name: action,
    kind: "model-preset",
    target: `model-${preset.model} effort-${preset.effort}`
  });
}
function shortcutErrorCategory(error) {
  const name = String(error?.name || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  if (name.includes("timeout") || message.includes("timeout")) return "bridge-timeout";
  if (message.includes("is empty")) return "empty-task-slot";
  if (message.includes("fetch failed") || message.includes("econnrefused")) return "bridge-unavailable";
  if (message.includes("authorization") || message.includes("unauthorized") || message.includes("forbidden")) {
    return "bridge-rejected";
  }
  return "bridge-error";
}
function logShortcut(instance, shortcut, level, event, fields = []) {
  const message = `[Codex Micro] shortcut event=${event} name=${shortcut.name} kind=${shortcut.kind} ${fields.join(" ")}`.trim();
  if (level === "error") console.error(message);
  else if (level === "warn") console.warn(message);
  else console.log(message);
  send({
    cmd: "logMessage",
    uuid: PLUGIN_UUID,
    actionid: "",
    key: "",
    level,
    message
  });
}
function safeDiagnosticFields(event) {
  const allowed = /* @__PURE__ */ new Set([
    "action",
    "attempts",
    "background",
    "category",
    "channel",
    "complete",
    "connection",
    "currentEffort",
    "durationMs",
    "effortMatched",
    "modelMatched",
    "outcome",
    "focusOk",
    "path",
    "phase",
    "platform",
    "reused",
    "route",
    "rowCount",
    "slot",
    "stage",
    "targetEffort"
  ]);
  return Object.entries(event || {}).flatMap(([key, value]) => {
    if (!allowed.has(key)) return [];
    if (typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) {
      return [`${key}=${value}`];
    }
    const normalized = String(value || "");
    return /^[a-zA-Z0-9_.:-]{1,80}$/.test(normalized) ? [`${key}=${normalized}`] : [];
  });
}
async function forwardBridgeDiagnostics(instance, shortcut, traceId) {
  try {
    if (forwardedTraceEvents.get(traceId) === Infinity) return true;
    const payload = await bridgeRequest("/diagnostics/trace", "POST", traceId);
    const diagnostics = payload?.diagnostics;
    if (!diagnostics || diagnostics.traceId !== traceId || !Array.isArray(diagnostics.events)) return false;
    const seen = forwardedTraceEvents.get(traceId) || 0;
    for (const event of diagnostics.events.slice(seen, 160)) {
      const eventName = String(event?.event || "");
      if (!/^[a-z0-9.-]{1,80}$/.test(eventName)) continue;
      logShortcut(instance, shortcut, event.outcome === "failed" ? "error" : "debug", "bridge-trace", [
        `trace=${traceId}`,
        `bridgeEvent=${eventName}`,
        `offsetMs=${Math.max(0, Math.round(Number(event.offsetMs) || 0))}`,
        ...safeDiagnosticFields(event)
      ]);
    }
    forwardedTraceEvents.set(traceId, diagnostics.events.length);
    if (diagnostics.complete) forwardedTraceEvents.set(traceId, Infinity);
    return Boolean(diagnostics.complete);
  } catch {
    return false;
  }
}
function collectBridgeDiagnostics(instance, shortcut, traceId) {
  const delays = [0, 400, 1200, 2600, 5200];
  for (const delay of delays) {
    const timer = setTimeout(() => void forwardBridgeDiagnostics(instance, shortcut, traceId), delay);
    timer.unref?.();
  }
  const cleanup = setTimeout(() => forwardedTraceEvents.delete(traceId), 1e4);
  cleanup.unref?.();
}
function titleGraphemes(value) {
  const title = String(value || "Untitled").replace(/\s+/g, " ").trim() || "Untitled";
  if (!TASK_TITLE_SEGMENTER) return Array.from(title);
  return Array.from(TASK_TITLE_SEGMENTER.segment(title), (item) => item.segment);
}
function graphemeUnits(value) {
  if (/^\s$/u.test(value)) return 0.55;
  if (new RegExp("^\\p{Mark}+$", "u").test(value)) return 0;
  if (new RegExp("\\p{Extended_Pictographic}", "u").test(value) || /[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff\ufe10-\ufe6f\uff01-\uff60\uffe0-\uffe6]/u.test(value)) return 2;
  if (/^[ilI1.,'`:;|!\[\](){}]$/u.test(value)) return 0.55;
  if (/^[mwMW@#%&]$/u.test(value)) return 1.35;
  return 1;
}
function lineUnits(values) {
  return values.reduce((total, value) => total + graphemeUnits(value), 0);
}
function trimLine(values) {
  const result = [...values];
  while (result[0] === " ") result.shift();
  while (result.at(-1) === " ") result.pop();
  return result;
}
function taskTitleLines(value) {
  let graphemes = titleGraphemes(value);
  const maxTotalUnits = TASK_TITLE_MAX_UNITS * TASK_TITLE_MAX_LINES;
  if (lineUnits(graphemes) > maxTotalUnits) {
    const ellipsisUnits = graphemeUnits("\u2026");
    const clipped = [];
    let used = 0;
    for (const grapheme of graphemes) {
      const units = graphemeUnits(grapheme);
      if (used + units + ellipsisUnits > maxTotalUnits) break;
      clipped.push(grapheme);
      used += units;
    }
    graphemes = trimLine(clipped);
    graphemes.push("\u2026");
  }
  const lines = [];
  while (graphemes.length && lines.length < TASK_TITLE_MAX_LINES) {
    const line = [];
    while (graphemes.length && lineUnits([...line, graphemes[0]]) <= TASK_TITLE_MAX_UNITS) {
      line.push(graphemes.shift());
    }
    if (!line.length) line.push(graphemes.shift());
    const trimmed = trimLine(line);
    if (trimmed.length) lines.push(trimmed.join(""));
    while (graphemes[0] === " ") graphemes.shift();
  }
  if (graphemes.length && lines.length === TASK_TITLE_MAX_LINES && !lines.at(-1).endsWith("\u2026")) {
    const lastLine = titleGraphemes(lines.at(-1));
    while (lastLine.length && lineUnits([...lastLine, "\u2026"]) > TASK_TITLE_MAX_UNITS) lastLine.pop();
    lines[lines.length - 1] = `${trimLine(lastLine).join("")}\u2026`;
  }
  return lines;
}
function taskIconData(kind, flashOn = false) {
  const palette = kind === "complete" && flashOn ? TASK_COMPLETE_FLASH_PALETTE : TASK_STATUS_PALETTES[kind];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <rect width="196" height="196" rx="30" fill="#07111f"/>
    <rect x="5" y="5" width="186" height="186" rx="27" fill="${palette.frame}"/>
    <rect data-role="title-surface" x="12" y="12" width="172" height="172" rx="22" fill="#0b1220" fill-opacity=".94"/>
    <rect x="12" y="12" width="172" height="9" rx="4.5" fill="${palette.accent}"/>
    <circle cx="170" cy="33" r="5" fill="${palette.accent}"/>
    <circle cx="154" cy="33" r="3" fill="${palette.accent}" fill-opacity=".35"/>
    <path d="M28 168H168" stroke="${palette.accent}" stroke-opacity=".45" stroke-width="3" stroke-linecap="round"/>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
function setDisplay(instance, state, text) {
  const digest = `${state}:${text}`;
  if (!instance.active || instance.lastDisplay === digest) return;
  instance.lastDisplay = digest;
  send({
    cmd: "state",
    param: {
      statelist: [{
        uuid: instance.uuid,
        actionid: instance.actionid,
        key: instance.key,
        type: 0,
        state,
        showtext: true,
        textdata: text
      }]
    }
  });
}
function setTaskDisplay(instance, status, title) {
  const kind = taskStatusKind(status);
  const lines = taskTitleLines(title);
  const displayTitle = lines.join("\n");
  const flashOn = kind === "complete" && completeFlashOn;
  const digest = `task:${kind}:${flashOn}:${displayTitle}`;
  if (!instance.active || instance.lastDisplay === digest) return;
  instance.lastDisplay = digest;
  send({
    cmd: "state",
    param: {
      statelist: [{
        uuid: instance.uuid,
        actionid: instance.actionid,
        key: instance.key,
        type: 1,
        data: taskIconData(kind, flashOn),
        showtext: true,
        textData: displayTitle,
        textdata: displayTitle
      }]
    }
  });
}
function setUsageDisplay(instance, usage) {
  const remaining = usageRemaining(usage);
  const digest = `usage:${remaining ?? "unknown"}`;
  if (!instance.active || instance.lastDisplay === digest) return;
  instance.lastDisplay = digest;
  send({
    cmd: "state",
    param: {
      statelist: [{
        uuid: instance.uuid,
        actionid: instance.actionid,
        key: instance.key,
        type: 1,
        data: usageIconData(usage),
        showtext: true,
        textdata: ACTION_LABELS.usage
      }]
    }
  });
}
function renderInstance(instance) {
  const slot = taskSlot(instance.uuid);
  if (slot === null) {
    const action = actionName(instance.uuid);
    if (!latestState?.connected) {
      if (action === "navigate") {
        setTaskDisplay(instance, "idle", "Bridge Offline");
      } else {
        setDisplay(instance, 0, "Bridge Offline");
      }
      return;
    }
    if (action === "usage") {
      setUsageDisplay(instance, latestState.usage);
      return;
    }
    if (action === "navigate") {
      const task2 = latestState.slots?.[0];
      if (!task2?.threadKey) {
        setTaskDisplay(instance, "idle", "Latest Task");
        return;
      }
      setTaskDisplay(instance, task2.status, task2.title);
      return;
    }
    setDisplay(instance, 0, ACTION_LABELS[action] || "CODEX");
    return;
  }
  if (!latestState?.connected) {
    setTaskDisplay(instance, "idle", "Bridge Offline");
    return;
  }
  const task = latestState.slots?.[slot];
  if (!task?.threadKey) {
    setTaskDisplay(instance, "idle", `Task ${slot + 1}`);
    return;
  }
  setTaskDisplay(instance, task.status, task.title);
}
function renderAll() {
  for (const instance of instances.values()) renderInstance(instance);
}
async function bridgeRequest(path, method = "GET", traceId = null) {
  const headers = { ...await bridgeSetup.authorizationHeaders() };
  if (traceId) headers["X-Codex-Trace-Id"] = traceId;
  const response = await fetch(`${BRIDGE_URL}${path}`, {
    method,
    headers,
    signal: AbortSignal.timeout(1200)
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Bridge HTTP ${response.status}`);
  }
  return payload;
}
async function openTaskSlot(slot, traceId) {
  const task = latestState?.slots?.[slot];
  if (!task?.threadKey) throw new Error(`Codex task slot ${slot + 1} is empty`);
  await bridgeRequest(`/thread/${encodeURIComponent(task.threadKey)}/click?slot=${slot}`, "POST", traceId);
}
async function pollBridge() {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    latestState = await bridgeRequest("/state");
  } catch (error) {
    latestState = { connected: false, error: error.message, slots: [] };
  } finally {
    pollInFlight = false;
    completeFlashOn = !completeFlashOn;
    renderAll();
  }
}
async function invoke(instance, pressed) {
  const slot = taskSlot(instance.uuid);
  const shortcut = debugShortcut(instance.uuid);
  const invocation = shortcut ? ++shortcutInvocationSequence : null;
  const traceId = shortcut ? (0, import_node_crypto2.randomUUID)() : null;
  const phase = pressed ? "down" : "up";
  const startedAt = Date.now();
  if (shortcut) {
    logShortcut(instance, shortcut, "debug", "received", [
      `invocation=${invocation}`,
      `trace=${traceId}`,
      `phase=${phase}`,
      `target=${shortcut.target}`
    ]);
  }
  try {
    if (slot !== null) {
      if (!pressed) {
        if (shortcut) {
          logShortcut(instance, shortcut, "debug", "ignored", [
            `invocation=${invocation}`,
            `phase=${phase}`,
            "reason=keydown-only"
          ]);
        }
        return;
      }
      if (shortcut) {
        logShortcut(instance, shortcut, "debug", "dispatching", [
          `invocation=${invocation}`,
          `phase=${phase}`,
          "transport=bridge-http"
        ]);
      }
      await openTaskSlot(slot, traceId);
      if (shortcut) {
        logShortcut(instance, shortcut, "info", "succeeded", [
          `invocation=${invocation}`,
          `phase=${phase}`,
          `durationMs=${Date.now() - startedAt}`
        ]);
      }
      return;
    }
    const action = actionName(instance.uuid);
    if (!action) throw new Error(`Unknown Codex action: ${instance.uuid}`);
    if (action === "usage") {
      if (pressed) await bridgeRequest("/focus", "POST");
      return;
    }
    if (shortcut) {
      logShortcut(instance, shortcut, "debug", "dispatching", [
        `invocation=${invocation}`,
        `phase=${phase}`,
        "transport=bridge-http"
      ]);
    }
    await bridgeRequest(`/action/${action}/${pressed ? "down" : "up"}`, "POST", traceId);
    if (shortcut) {
      logShortcut(instance, shortcut, "info", "succeeded", [
        `invocation=${invocation}`,
        `phase=${phase}`,
        `durationMs=${Date.now() - startedAt}`
      ]);
    }
  } catch (error) {
    if (shortcut) {
      logShortcut(instance, shortcut, "error", "failed", [
        `invocation=${invocation}`,
        `phase=${phase}`,
        `durationMs=${Date.now() - startedAt}`,
        `category=${shortcutErrorCategory(error)}`
      ]);
    } else {
      send({
        cmd: "logMessage",
        uuid: instance.uuid,
        actionid: instance.actionid,
        key: instance.key,
        level: "error",
        message: `[Codex Micro] action failed category=${shortcutErrorCategory(error)}`
      });
    }
    send({ cmd: "showAlert", uuid: instance.uuid, actionid: instance.actionid, key: instance.key });
  } finally {
    if (shortcut && pressed) collectBridgeDiagnostics(instance, shortcut, traceId);
  }
}
async function invokeEncoder(instance, message) {
  try {
    if (message.cmd === "dialdown") {
      await openTaskSlot(0);
      return;
    }
    if (message.cmd !== "dialrotate") return;
    const keylist = {
      left: "SCROLL UP",
      "hold-left": "SCROLL UP",
      right: "SCROLL DOWN",
      "hold-right": "SCROLL DOWN"
    }[message.rotateEvent];
    if (keylist) send({ cmd: "hotkey", keylist });
  } catch (error) {
    send({ cmd: "logMessage", uuid: instance.uuid, actionid: instance.actionid, key: instance.key, level: "error", message: error.message });
    send({ cmd: "showAlert", uuid: instance.uuid, actionid: instance.actionid, key: instance.key });
  }
}
function addInstance(message) {
  const context = contextOf(message);
  const existing = instances.get(context);
  const instance = existing || {
    uuid: message.uuid,
    actionid: message.actionid,
    key: message.key,
    active: true,
    lastDisplay: null
  };
  instance.active = true;
  instances.set(context, instance);
  renderInstance(instance);
  return instance;
}
function handleMessage(raw) {
  let message;
  try {
    message = JSON.parse(String(raw));
  } catch {
    return;
  }
  if (message.cmd === "add" || message.cmd === "paramfromapp") {
    addInstance(message);
    ack(message);
    return;
  }
  if (message.cmd === "setactive") {
    const instance = instances.get(contextOf(message)) || addInstance(message);
    instance.active = Boolean(message.active);
    if (instance.active) {
      instance.lastDisplay = null;
      renderInstance(instance);
    }
    ack(message);
    return;
  }
  if (message.cmd === "clear") {
    for (const item of message.param || []) instances.delete(contextOf(item));
    ack(message);
    return;
  }
  if (message.cmd === "sendToPlugin") {
    ack(message);
    if (message.payload?.type === "bridgeSetup") {
      void handleBridgeSetupMessage(message);
    }
    return;
  }
  if (message.cmd === "run") {
    ack(message);
    return;
  }
  if (["dialdown", "dialup", "dialrotate"].includes(message.cmd)) {
    const instance = instances.get(contextOf(message)) || addInstance(message);
    if (actionName(instance.uuid) === "navigate") void invokeEncoder(instance, message);
    ack(message);
    return;
  }
  if (["keydown", "keyup"].includes(message.cmd)) {
    const instance = instances.get(contextOf(message)) || addInstance(message);
    void invoke(instance, message.cmd !== "keyup");
    ack(message);
  }
}
function connect() {
  clearTimeout(reconnectTimer);
  socket = new wrapper_default(HOST_URL);
  socket.on("open", () => {
    send({ code: 0, cmd: "connected", uuid: PLUGIN_UUID });
    if (process.env.CODEX_BRIDGE_AUTOSTART !== "0") {
      void ensureBundledBridgeCurrent().catch((error) => {
        console.error(`[Codex Micro] Automatic Bridge reconciliation failed: ${error.message}`);
      });
    }
    clearInterval(pollTimer);
    pollTimer = setInterval(() => void pollBridge(), 500);
    pollTimer.unref();
    void pollBridge();
  });
  socket.on("message", handleMessage);
  socket.on("close", () => {
    clearInterval(pollTimer);
    reconnectTimer = setTimeout(connect, 1e3);
    reconnectTimer.unref();
  });
  socket.on("error", () => socket.close());
}
connect();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    clearTimeout(reconnectTimer);
    clearInterval(pollTimer);
    socket?.close();
    process.exit(0);
  });
}
