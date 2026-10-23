import { deflateSync } from "node:zlib";

const FONT = Object.freeze({
  "0": ["11111", "10001", "10001", "10001", "10001", "10001", "11111"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["11110", "00001", "00001", "01110", "10000", "10000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["10010", "10010", "10010", "11111", "00010", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  "/": ["00001", "00010", "00100", "01000", "10000", "00000", "00000"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  "?": ["01110", "10001", "00001", "00110", "00100", "00000", "00100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"]
});

function rgba(value) {
  const match = String(value).match(/^#([0-9a-f]{6})$/i);
  if (!match) return [0, 0, 0, 255];
  const hex = match[1];
  return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16), 255];
}

export function fillRect(pixels, width, height, x, y, rectWidth, rectHeight, color) {
  const [red, green, blue, alpha] = rgba(color);
  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  const right = Math.min(width, Math.ceil(x + rectWidth));
  const bottom = Math.min(height, Math.ceil(y + rectHeight));
  for (let row = top; row < bottom; row += 1) {
    for (let column = left; column < right; column += 1) {
      const offset = (row * width + column) * 4;
      pixels[offset] = red;
      pixels[offset + 1] = green;
      pixels[offset + 2] = blue;
      pixels[offset + 3] = alpha;
    }
  }
}

function strokeRect(pixels, width, height, x, y, rectWidth, rectHeight, color) {
  fillRect(pixels, width, height, x, y, rectWidth, 1, color);
  fillRect(pixels, width, height, x, y + rectHeight - 1, rectWidth, 1, color);
  fillRect(pixels, width, height, x, y, 1, rectHeight, color);
  fillRect(pixels, width, height, x + rectWidth - 1, y, 1, rectHeight, color);
}

export function fillRoundedRect(pixels, width, height, x, y, rectWidth, rectHeight, radius, color) {
  for (let row = 0; row < rectHeight; row += 1) {
    const dy = Math.max(radius - row - 0.5, row + 0.5 - (rectHeight - radius), 0);
    const inset = dy ? radius - Math.sqrt(radius * radius - dy * dy) : 0;
    fillRect(pixels, width, height, x + Math.ceil(inset), y + row,
      rectWidth - 2 * Math.ceil(inset), 1, color);
  }
}

export function drawLine(pixels, width, height, x1, y1, x2, y2, color) {
  let startX = Math.round(x1);
  let startY = Math.round(y1);
  const endX = Math.round(x2);
  const endY = Math.round(y2);
  const deltaX = Math.abs(endX - startX);
  const stepX = startX < endX ? 1 : -1;
  const deltaY = -Math.abs(endY - startY);
  const stepY = startY < endY ? 1 : -1;
  let error = deltaX + deltaY;
  while (true) {
    fillRect(pixels, width, height, startX, startY, 2, 2, color);
    if (startX === endX && startY === endY) break;
    const twice = 2 * error;
    if (twice >= deltaY) {
      error += deltaY;
      startX += stepX;
    }
    if (twice <= deltaX) {
      error += deltaX;
      startY += stepY;
    }
  }
}

function fillCircle(pixels, width, height, centerX, centerY, radius, color) {
  const radiusSquared = radius * radius;
  for (let y = Math.floor(centerY - radius); y <= Math.ceil(centerY + radius); y += 1) {
    for (let x = Math.floor(centerX - radius); x <= Math.ceil(centerX + radius); x += 1) {
      if ((x - centerX) ** 2 + (y - centerY) ** 2 <= radiusSquared) {
        fillRect(pixels, width, height, x, y, 1, 1, color);
      }
    }
  }
}

export function drawText(pixels, width, height, value, x, y, scale, color, maxWidth, align = "start") {
  const text = String(value || "").toUpperCase().replace(/[^A-Z0-9 .+\-/]/g, "?");
  const advance = 6 * scale;
  const limit = Number.isFinite(maxWidth) ? Math.max(1, Math.floor(maxWidth / advance)) : text.length;
  const shown = text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}.`;
  const textWidth = shown.length * advance - scale;
  let cursor = align === "end" ? x - textWidth : align === "middle" ? x - textWidth / 2 : x;
  for (const character of shown) {
    const glyph = FONT[character] || FONT["?"];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] === "1") fillRect(pixels, width, height, cursor + column * scale, y + row * scale, scale, scale, color);
      }
    }
    cursor += advance;
  }
}

let crcTable;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = Array.from({ length: 256 }, (_, value) => {
      let remainder = value;
      for (let bit = 0; bit < 8; bit += 1) remainder = remainder & 1 ? 0xedb88320 ^ (remainder >>> 1) : remainder >>> 1;
      return remainder >>> 0;
    });
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (~crc) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const payload = Buffer.concat([typeBytes, data]);
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(payload));
  return Buffer.concat([length, payload, checksum]);
}

export function pngDataUrl(pixels, width, height) {
  const rowLength = width * 4;
  const scanlines = Buffer.alloc((rowLength + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const target = row * (rowLength + 1);
    scanlines[target] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + row * rowLength, rowLength).copy(scanlines, target + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}
