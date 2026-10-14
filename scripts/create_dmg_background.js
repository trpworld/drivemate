const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

// Dimensions: 660 x 400
const WIDTH = 660;
const HEIGHT = 400;

const buffer = Buffer.alloc(WIDTH * HEIGHT * 4);

function setPixel(x, y, r, g, b, a = 255) {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
  const idx = (Math.floor(y) * WIDTH + Math.floor(x)) * 4;
  const srcA = a / 255;
  const dstA = buffer[idx + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA > 0) {
    buffer[idx] = Math.round((r * srcA + buffer[idx] * dstA * (1 - srcA)) / outA);
    buffer[idx + 1] = Math.round((g * srcA + buffer[idx + 1] * dstA * (1 - srcA)) / outA);
    buffer[idx + 2] = Math.round((b * srcA + buffer[idx + 2] * dstA * (1 - srcA)) / outA);
    buffer[idx + 3] = Math.round(outA * 255);
  }
}

// 1. Fill Radial Background Gradient
for (let y = 0; y < HEIGHT; y++) {
  for (let x = 0; x < WIDTH; x++) {
    const dx = (x - WIDTH / 2) / (WIDTH / 2);
    const dy = (y - 140) / (HEIGHT / 2);
    const dist = Math.min(1.0, Math.sqrt(dx * dx + dy * dy));

    // Dark sleek gradient (#162033 at center to #070a10 at edges)
    const r = Math.round(22 * (1 - dist) + 7 * dist);
    const g = Math.round(32 * (1 - dist) + 10 * dist);
    const b = Math.round(51 * (1 - dist) + 16 * dist);

    // Subtle grid lines (every 24px)
    let gridExtra = 0;
    if (x % 24 === 0 || y % 24 === 0) {
      gridExtra = 4;
    }

    setPixel(x, y, Math.min(255, r + gridExtra), Math.min(255, g + gridExtra), Math.min(255, b + gridExtra), 255);
  }
}

// 2. Ambient Glows
function addGlow(cx, cy, radius, r, g, b, maxAlpha) {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (d < radius) {
        const factor = (1 - d / radius) ** 2;
        setPixel(x, y, r, g, b, Math.round(maxAlpha * factor));
      }
    }
  }
}

// Cyan glow on left (180, 170)
addGlow(180, 170, 110, 56, 189, 248, 45);
// Indigo glow on right (480, 170)
addGlow(480, 170, 110, 99, 102, 241, 45);

// 3. Rounded Rect Target Guides (Dashed)
function drawRoundedRectDashed(cx, cy, size, radius, r, g, b, a) {
  const half = size / 2;
  const left = cx - half;
  const right = cx + half;
  const top = cy - half;
  const bottom = cy + half;

  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      // Check if near border
      let isBorder = false;
      let distCorner = 0;

      const inCornerTL = x < left + radius && y < top + radius;
      const inCornerTR = x > right - radius && y < top + radius;
      const inCornerBL = x < left + radius && y > bottom - radius;
      const inCornerBR = x > right - radius && y > bottom - radius;

      if (inCornerTL) {
        const d = Math.sqrt((x - (left + radius)) ** 2 + (y - (top + radius)) ** 2);
        if (Math.abs(d - radius) <= 1.0) isBorder = true;
      } else if (inCornerTR) {
        const d = Math.sqrt((x - (right - radius)) ** 2 + (y - (top + radius)) ** 2);
        if (Math.abs(d - radius) <= 1.0) isBorder = true;
      } else if (inCornerBL) {
        const d = Math.sqrt((x - (left + radius)) ** 2 + (y - (bottom - radius)) ** 2);
        if (Math.abs(d - radius) <= 1.0) isBorder = true;
      } else if (inCornerBR) {
        const d = Math.sqrt((x - (right - radius)) ** 2 + (y - (bottom - radius)) ** 2);
        if (Math.abs(d - radius) <= 1.0) isBorder = true;
      } else {
        if (Math.abs(x - left) <= 1.0 || Math.abs(x - right) <= 1.0 ||
            Math.abs(y - top) <= 1.0 || Math.abs(y - bottom) <= 1.0) {
          isBorder = true;
        }
      }

      if (isBorder) {
        // Dash pattern: 6px on, 4px off
        const perimeterDist = (x + y);
        if (perimeterDist % 12 < 7) {
          setPixel(x, y, r, g, b, a);
        }
      }
    }
  }
}

drawRoundedRectDashed(180, 170, 134, 26, 56, 189, 248, 140);
drawRoundedRectDashed(480, 170, 134, 26, 99, 102, 241, 140);

// 4. Vibrant Arrow in Center (from x=270 to x=385 at y=170)
function drawThickLine(x0, y0, x1, y1, width, r, g, b, a) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy);
  const ux = dx / len;
  const uy = dy / len;
  const perpX = -uy;
  const perpY = ux;

  for (let l = 0; l <= len; l += 0.5) {
    const px = x0 + ux * l;
    const py = y0 + uy * l;
    for (let w = -width / 2; w <= width / 2; w += 0.5) {
      const qx = px + perpX * w;
      const qy = py + perpY * w;
      const edgeFactor = 1.0 - Math.abs(w) / (width / 2);
      setPixel(qx, qy, r, g, b, Math.round(a * Math.min(1.0, edgeFactor * 1.5)));
    }
  }
}

// Arrow Glow
for (let blur = 14; blur >= 2; blur -= 2) {
  const alpha = Math.round(18 * (1 - blur / 14));
  drawThickLine(275, 170, 375, 170, blur + 6, 56, 189, 248, alpha);
  drawThickLine(375, 170, 355, 150, blur + 6, 56, 189, 248, alpha);
  drawThickLine(375, 170, 355, 190, blur + 6, 56, 189, 248, alpha);
}

// Arrow Body (Vibrant gradient from cyan #38bdf8 to indigo #818cf8)
drawThickLine(275, 170, 375, 170, 6, 56, 189, 248, 240);
drawThickLine(375, 170, 355, 150, 6, 99, 102, 241, 240);
drawThickLine(375, 170, 355, 190, 6, 99, 102, 241, 240);

// Inner Highlight
drawThickLine(277, 170, 373, 170, 2.5, 255, 255, 255, 200);
drawThickLine(373, 170, 356, 152, 2.5, 255, 255, 255, 200);
drawThickLine(373, 170, 356, 188, 2.5, 255, 255, 255, 200);

// 5. Encode PNG using Node.js zlib
function createPNG(w, h, rgbaBuf) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // RGBA
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  function makeChunk(type, data) {
    const len = data.length;
    const buf = Buffer.alloc(4 + 4 + len + 4);
    buf.writeUInt32BE(len, 0);
    buf.write(type, 4, 4, 'ascii');
    data.copy(buf, 8);

    // CRC32
    let c = 0xffffffff;
    const chunkData = buf.subarray(4, 8 + len);
    for (let i = 0; i < chunkData.length; i++) {
      c ^= chunkData[i];
      for (let k = 0; k < 8; k++) {
        c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
      }
    }
    buf.writeUInt32BE((c ^ 0xffffffff) >>> 0, 8 + len);
    return buf;
  }

  // Scanlines with filter byte 0
  const scanlines = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    const lineStart = y * (w * 4 + 1);
    scanlines[lineStart] = 0; // Filter: None
    rgbaBuf.copy(scanlines, lineStart + 1, y * w * 4, (y + 1) * w * 4);
  }

  const compressed = zlib.deflateSync(scanlines, { level: 9 });

  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const outputPath = process.argv[2] || path.join(__dirname, '../desktop/dmg-background.png');
const pngBuffer = createPNG(WIDTH, HEIGHT, buffer);
fs.writeFileSync(outputPath, pngBuffer);
console.log(`✅ DMG Background rendered successfully: ${outputPath} (${WIDTH}x${HEIGHT}, ${pngBuffer.length} bytes)`);
