#!/usr/bin/env node
/**
 * PWA 图标资产生成脚本（纯 Node 实现，无第三方依赖）。
 *
 * 从 public/logo/novanovastudio.svg 内嵌的高清位图中提取品牌图形，
 * 生成 PWA 所需图标，输出到 public/pwa/：
 *   - icon-192.png / icon-512.png        purpose: any，保留透明背景
 *   - maskable-192.png / maskable-512.png 白色底，内容缩至 80% 安全区
 *   - apple-touch-icon.png               180×180 白色底
 *   - favicon-32.png                     32×32 透明背景
 *   - favicon.svg                        内嵌 128×128 PNG 的 SVG 包装
 *
 * 用法：node scripts/generate-pwa-icons.mjs
 */
import { deflateSync, inflateSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_SVG = path.join(webDir, "public/logo/novanovastudio.svg");
const OUT_DIR = path.join(webDir, "public/pwa");
const MASKABLE_BG = [255, 255, 255];
const MASKABLE_CONTENT_RATIO = 0.8;

/* ---------------------------------- PNG 解码 --------------------------------- */

/** 解析 PNG（仅支持 8bit RGBA），返回 { w, h, data } */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a png file");
  let pos = 8;
  let w;
  let h;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6) throw new Error("only 8-bit RGBA png supported");
    } else if (type === "IDAT") {
      idat.push(data);
    }
    pos += 12 + len;
    if (type === "IEND") break;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let prev = null;
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = x >= bpp && prev ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
    prev = cur;
  }
  return { w, h, data: out };
}

/* ---------------------------------- PNG 编码 --------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** 将 RGBA 像素编码为 PNG（自适应滤波 + 最高压缩） */
function encodePng(w, h, rgba) {
  const bpp = 4;
  const stride = w * bpp;
  const filtered = Buffer.alloc((stride + 1) * h);
  const candidates = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride)];
  for (let y = 0; y < h; y++) {
    const cur = rgba.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? rgba.subarray((y - 1) * stride, y * stride) : null;
    let best = 0;
    let bestScore = Number.MAX_SAFE_INTEGER;
    for (let f = 0; f < 5; f++) {
      const buf = candidates[f];
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? cur[x - bpp] : 0;
        const b = prev ? prev[x] : 0;
        const c = x >= bpp && prev ? prev[x - bpp] : 0;
        let v = cur[x];
        if (f === 1) v = (v - a) & 0xff;
        else if (f === 2) v = (v - b) & 0xff;
        else if (f === 3) v = (v - ((a + b) >> 1)) & 0xff;
        else if (f === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = (v - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
        }
        buf[x] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    filtered[y * (stride + 1)] = best;
    candidates[best].copy(filtered, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(filtered, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/* --------------------------------- 图像处理工具 -------------------------------- */

/** 区域平均重采样（预乘 alpha，避免透明边缘出现色晕） */
function areaResample(src, sx, sy, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  const xRatio = sw / dw;
  const yRatio = sh / dh;
  for (let dy = 0; dy < dh; dy++) {
    const y0 = sy + dy * yRatio;
    const y1 = y0 + yRatio;
    const iy0 = Math.floor(y0);
    const iy1 = Math.min(Math.ceil(y1), sy + sh);
    for (let dx = 0; dx < dw; dx++) {
      const x0 = sx + dx * xRatio;
      const x1 = x0 + xRatio;
      const ix0 = Math.floor(x0);
      const ix1 = Math.min(Math.ceil(x1), sx + sw);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let weightSum = 0;
      for (let iy = iy0; iy < iy1; iy++) {
        const wy = Math.min(iy + 1, y1) - Math.max(iy, y0);
        if (wy <= 0) continue;
        const rowBase = iy * src.w * 4;
        for (let ix = ix0; ix < ix1; ix++) {
          const wx = Math.min(ix + 1, x1) - Math.max(ix, x0);
          if (wx <= 0) continue;
          const weight = wx * wy;
          const i = rowBase + ix * 4;
          const alpha = src.data[i + 3] / 255;
          r += src.data[i] * alpha * weight;
          g += src.data[i + 1] * alpha * weight;
          b += src.data[i + 2] * alpha * weight;
          a += alpha * weight;
          weightSum += weight;
        }
      }
      const o = (dy * dw + dx) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
        out[o + 3] = Math.round((a / weightSum) * 255);
      }
    }
  }
  return { w: dw, h: dh, data: out };
}

/** 把内容图 src-over 合成到纯色底画布中央，返回不透明 RGBA 画布 */
function compositeOnBackground(size, bg, content) {
  const canvas = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    canvas[i * 4] = bg[0];
    canvas[i * 4 + 1] = bg[1];
    canvas[i * 4 + 2] = bg[2];
    canvas[i * 4 + 3] = 255;
  }
  const ox = (size - content.w) >> 1;
  const oy = (size - content.h) >> 1;
  for (let y = 0; y < content.h; y++) {
    for (let x = 0; x < content.w; x++) {
      const ci = (y * content.w + x) * 4;
      const sa = content.data[ci + 3] / 255;
      if (sa <= 0) continue;
      const di = ((oy + y) * size + ox + x) * 4;
      canvas[di] = Math.round(content.data[ci] * sa + canvas[di] * (1 - sa));
      canvas[di + 1] = Math.round(content.data[ci + 1] * sa + canvas[di + 1] * (1 - sa));
      canvas[di + 2] = Math.round(content.data[ci + 2] * sa + canvas[di + 2] * (1 - sa));
      canvas[di + 3] = 255;
    }
  }
  return { w: size, h: size, data: canvas };
}

/* ---------------------------------- 主流程 ----------------------------------- */

/** 从品牌 SVG 中提取内嵌的高清 PNG 位图 */
function extractEmbeddedPng(svgPath) {
  const svg = fs.readFileSync(svgPath, "utf8");
  const match = svg.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);
  if (!match) throw new Error(`no embedded png found in ${svgPath}`);
  return Buffer.from(match[1], "base64");
}

/** 计算不透明内容的包围盒 */
function findContentBBox(src) {
  let minX = src.w;
  let minY = src.h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      if (src.data[(y * src.w + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error("source image is fully transparent");
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

const source = decodePng(extractEmbeddedPng(SOURCE_SVG));
const bbox = findContentBBox(source);
console.log(`source: ${source.w}x${source.h}, content bbox: ${bbox.w}x${bbox.h} at (${bbox.x},${bbox.y})`);

/** 生成白底图标（maskable / apple-touch）：内容缩至安全比例后居中 */
function buildBackgroundIcon(size) {
  const contentMax = Math.round(size * MASKABLE_CONTENT_RATIO);
  const cw = contentMax;
  const ch = Math.max(1, Math.round((contentMax * bbox.h) / bbox.w));
  const content = areaResample(source, bbox.x, bbox.y, bbox.w, bbox.h, cw, ch);
  return compositeOnBackground(size, MASKABLE_BG, content);
}

/** 生成透明背景图标（purpose: any）：整幅画布等比缩放 */
function buildTransparentIcon(size) {
  return areaResample(source, 0, 0, source.w, source.h, size, size);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const outputs = [
  ["icon-192.png", encodePng(192, 192, buildTransparentIcon(192).data)],
  ["icon-512.png", encodePng(512, 512, buildTransparentIcon(512).data)],
  ["maskable-192.png", encodePng(192, 192, buildBackgroundIcon(192).data)],
  ["maskable-512.png", encodePng(512, 512, buildBackgroundIcon(512).data)],
  ["apple-touch-icon.png", encodePng(180, 180, buildBackgroundIcon(180).data)],
  ["favicon-32.png", encodePng(32, 32, buildTransparentIcon(32).data)],
];

// favicon.svg：内嵌 128×128 PNG 的轻量 SVG 包装
const faviconPng = encodePng(128, 128, buildTransparentIcon(128).data);
outputs.push([
  "favicon.svg",
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><image width="128" height="128" href="data:image/png;base64,${faviconPng.toString("base64")}"/></svg>\n`,
  ),
]);

for (const [name, buf] of outputs) {
  fs.writeFileSync(path.join(OUT_DIR, name), buf);
  console.log(`  ${name}  ${(buf.length / 1024).toFixed(1)} KB`);
}
console.log(`done: ${outputs.length} assets written to ${path.relative(webDir, OUT_DIR)}/`);
