#!/usr/bin/env node
/**
 * PWA 产物生成脚本（Next.js 构建链路中 Vite 插件的等价实现：HTML 注入由根布局
 * generateMetadata 承担（仅生产），本脚本负责"产物生成"部分）。
 *
 * 在 `next build` 之后运行，向 public/ 输出三个文件：
 *   - manifest.webmanifest   Web App Manifest
 *   - novanova-offline.html  离线回退页（内联样式 + 构建期编译的双语字典）
 *   - novanova-sw.js         Service Worker（替换模板占位符 + 内容哈希版本号）
 *
 * 缓存版本号 = sha256(base + 构建产物代码内容 + 图标内容 + 离线页 + manifest + SW 模板)
 * 前 16 位，任何产物变化版本号必变，保证缓存精确失效。
 *
 * 用法：node scripts/generate-pwa.mjs
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = path.join(webDir, "public");
const NEXT_DIR = path.join(webDir, ".next");

/** 校验并返回部署 base：必须以 "/" 开头、不能以 "//" 开头、不含 ?#\\ 字符。 */
function resolveBase() {
    let base = "/";
    const configPath = path.join(webDir, "next.config.ts");
    if (fs.existsSync(configPath)) {
        const match = fs.readFileSync(configPath, "utf8").match(/basePath:\s*["']([^"']*)["']/);
        if (match) base = match[1] || "/";
    }
    if (!base.startsWith("/") || base.startsWith("//") || /[?#\\]/.test(base)) {
        throw new Error(`invalid PWA base path: ${JSON.stringify(base)}`);
    }
    return base.endsWith("/") ? base : `${base}/`;
}

/** 从品牌定义文件读取产品名。 */
function readBrandName() {
    const source = fs.readFileSync(path.join(webDir, "src/features/team/space-brand.ts"), "utf8");
    const match = source.match(/const platformBrand[^{]*\{[^}]*?name:\s*"([^"]+)"/s);
    if (!match) throw new Error("platformBrand name not found in space-brand.ts");
    return match[1];
}

/** 从设计 token 文件读取主题色（不写死）。返回按出现顺序的值数组：light 在前、dark 随后。 */
function readThemeTokens(name) {
    const source = fs.readFileSync(path.join(webDir, "src/app/globals.css"), "utf8");
    const values = [...source.matchAll(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`, "g"))].map((m) => m[1]);
    if (values.length === 0) throw new Error(`design token --${name} not found in globals.css`);
    return values;
}

/** 校验 viewport 主题色常量文件与 globals.css 设计 token 一致（漂移时构建报错）。 */
function verifyThemeColorConstants(bgTokens) {
    const source = fs.readFileSync(path.join(webDir, "src/features/pwa/pwa-theme-colors.ts"), "utf8");
    const read = (key) => {
        const match = source.match(new RegExp(`${key}:\\s*"(#[0-9a-fA-F]{3,8})"`));
        if (!match) throw new Error(`PWA_THEME_COLORS.${key} not found in pwa-theme-colors.ts`);
        return match[1].toLowerCase();
    };
    for (const [key, token] of [["light", bgTokens[0]], ["dark", bgTokens[1] || bgTokens[0]]]) {
        if (read(key) !== token.toLowerCase()) {
            throw new Error(`PWA_THEME_COLORS.${key} (${read(key)}) != --studio-bg (${token}): keep pwa-theme-colors.ts in sync with globals.css`);
        }
    }
}

/** 校验运行时常量（pwa-constants.ts）与部署 base 一致，避免 SW scope 错位。 */
function verifyRuntimeConstants(base) {
    const source = fs.readFileSync(path.join(webDir, "src/features/pwa/pwa-constants.ts"), "utf8");
    const read = (name) => {
        const match = source.match(new RegExp(`${name}\\s*=\\s*"([^"]+)"`));
        if (!match) throw new Error(`${name} not found in pwa-constants.ts`);
        return match[1];
    };
    const trimmedBase = base.length > 1 && base.endsWith("/") ? base.slice(0, -1) : base;
    if (read("PWA_BASE_PATH") !== trimmedBase) throw new Error(`PWA_BASE_PATH (${read("PWA_BASE_PATH")}) != basePath (${trimmedBase})`);
    if (!read("PWA_SW_PATH").startsWith(base)) throw new Error(`PWA_SW_PATH (${read("PWA_SW_PATH")}) must start with base ${base}`);
    if (read("PWA_SCOPE") !== base) throw new Error(`PWA_SCOPE (${read("PWA_SCOPE")}) != base (${base})`);
}

/** 读取双语 PWA 文案，并校验离线页所需翻译存在（缺失时构建报错）。 */
const OFFLINE_KEYS = ["offlineTitle", "offlineDescription", "offlineRetry"];
function readPwaMessages() {
    const read = (locale) => JSON.parse(fs.readFileSync(path.join(webDir, `src/features/locale/messages/${locale}/pwa.json`), "utf8"));
    const messages = { "zh-cn": read("zh-cn"), en: read("en") };
    for (const [locale, dict] of Object.entries(messages)) {
        for (const key of OFFLINE_KEYS) {
            if (!dict[key]) throw new Error(`missing pwa.${key} translation for locale "${locale}"`);
        }
    }
    return messages;
}

/** 按确定性顺序遍历目录文件（相对路径排序），返回 [relativePath, absolutePath] 列表。 */
function listFiles(dir, prefix) {
    const result = [];
    if (!fs.existsSync(dir)) return result;
    const walk = (current) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const absolute = path.join(current, entry.name);
            if (entry.isDirectory()) walk(absolute);
            else result.push([path.relative(webDir, absolute), absolute]);
        }
    };
    walk(dir);
    return result.sort(([a], [b]) => a.localeCompare(b));
}

/** 递归收集哈希输入（路径 + 内容），保证任何产物变化都反映到版本号。 */
function collectHashInputs(base) {
    const inputs = [`base:${base}`];
    const buildIdPath = path.join(NEXT_DIR, "BUILD_ID");
    if (!fs.existsSync(buildIdPath)) {
        throw new Error("missing .next/BUILD_ID: run `next build` before generating PWA artifacts");
    }
    // 构建产物代码内容：客户端 chunk + BUILD_ID（SW 模板等价物为 Vite 的 bundle 内容）。
    inputs.push(fs.readFileSync(buildIdPath, "utf8"));
    for (const [, absolute] of listFiles(path.join(NEXT_DIR, "static"))) {
        inputs.push(fs.readFileSync(absolute));
    }
    // PWA 图标资产内容。
    for (const [, absolute] of listFiles(path.join(PUBLIC_DIR, "pwa"))) {
        inputs.push(fs.readFileSync(absolute));
    }
    return inputs;
}

const base = resolveBase();
const brandName = readBrandName();
const shortName = brandName.split(/\s+/)[0];
const bgTokens = readThemeTokens("studio-bg");
const actionTokens = readThemeTokens("studio-action");
verifyThemeColorConstants(bgTokens);
verifyRuntimeConstants(base);
const messages = readPwaMessages();

const ICON_DIR = `${base}pwa/`;
const OFFLINE_FILE = "novanova-offline.html";
const SW_FILE = "novanova-sw.js";
const OFFLINE_URL = `${base}${OFFLINE_FILE}`;
const iconAssets = ["icon-192.png", "icon-512.png", "maskable-192.png", "maskable-512.png", "apple-touch-icon.png", "favicon-32.png", "favicon.svg"];

/* ------------------------------- manifest.webmanifest ------------------------------- */

const manifest = {
    id: base,
    name: brandName,
    short_name: shortName,
    lang: "zh-cn",
    start_url: `${base}?pwa-launch=1`,
    scope: base,
    display: "standalone",
    background_color: bgTokens[0],
    theme_color: bgTokens[0],
    icons: [
        { src: `${ICON_DIR}icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
        { src: `${ICON_DIR}icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
        { src: `${ICON_DIR}maskable-192.png`, sizes: "192x192", type: "image/png", purpose: "maskable" },
        { src: `${ICON_DIR}maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
};
const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;

/* ------------------------------- novanova-offline.html ------------------------------ */

const offlineTemplate = fs.readFileSync(path.join(webDir, "scripts/pwa/offline-template.html"), "utf8");
const offlineDict = Object.fromEntries(Object.entries(messages).map(([locale, dict]) => [locale, Object.fromEntries(OFFLINE_KEYS.map((key) => [key, dict[key]]))]));
const offlineContent = offlineTemplate
    .replaceAll("__PWA_BRAND_NAME__", brandName)
    .replaceAll("__PWA_BG_LIGHT__", bgTokens[0])
    .replaceAll("__PWA_BG_DARK__", bgTokens[1] || bgTokens[0])
    .replaceAll("__PWA_ACTION_LIGHT__", actionTokens[0])
    .replaceAll("__PWA_ACTION_DARK__", actionTokens[1] || actionTokens[0])
    .replaceAll("__PWA_ICON_URL__", `${ICON_DIR}icon-192.png`)
    .replaceAll("__PWA_OFFLINE_DICT__", JSON.stringify(offlineDict));

/* --------------------------------- novanova-sw.js ---------------------------------- */

const swTemplate = fs.readFileSync(path.join(webDir, "scripts/pwa/sw-template.js"), "utf8");
const publicAssets = [OFFLINE_URL, ...iconAssets.map((name) => `${ICON_DIR}${name}`)];

// 缓存版本号：base + 构建产物 + 图标 + 离线页 + manifest + SW 模板 的 sha256 前 16 位。
const hash = crypto.createHash("sha256");
for (const input of [...collectHashInputs(base), offlineContent, manifestContent, swTemplate]) {
    hash.update(input);
    hash.update(Buffer.from([0]));
}
const cacheVersion = hash.digest("hex").slice(0, 16);

const swContent = swTemplate
    .replaceAll("__CACHE_NAME__", cacheVersion)
    .replaceAll("__CACHE_PREFIX__", `${shortName.toLowerCase()}-pwa`)
    .replaceAll("__BASE__", base)
    .replaceAll("__OFFLINE_URL__", OFFLINE_URL)
    .replaceAll("__PUBLIC_ASSETS__", JSON.stringify(publicAssets));

/* ----------------------------------- 写出产物 ------------------------------------- */

const outputs = [
    ["manifest.webmanifest", manifestContent],
    [OFFLINE_FILE, offlineContent],
    [SW_FILE, swContent],
];
for (const [name, content] of outputs) {
    fs.writeFileSync(path.join(PUBLIC_DIR, name), content);
    console.log(`  public/${name}  ${(Buffer.byteLength(content) / 1024).toFixed(1)} KB`);
}
console.log(`  cache version: ${shortName.toLowerCase()}-pwa-${cacheVersion}`);
console.log(`done: ${outputs.length} PWA artifacts written (base=${JSON.stringify(base)}, brand=${JSON.stringify(brandName)})`);
