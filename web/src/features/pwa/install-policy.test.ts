import assert from "node:assert/strict";
import test from "node:test";

import { detectInstallPlatform, showInstallEntry } from "./install-policy.ts";

const SECURE = true;
const NO_TOUCH = 0;

const EDGE_UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";
const CHROME_MAC_UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const CHROME_WIN_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const OPERA_UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/112.0.0.0";
const VIVALDI_UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Vivaldi/6.8.3381.4";
const SAFARI_17_UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15";
const SAFARI_16_UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15";
const IPHONE_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const ANDROID_UA =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const FIREFOX_UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0";

test("detectInstallPlatform：非安全上下文一律 unsupported", () => {
    assert.deepEqual(detectInstallPlatform(EDGE_UA, false, NO_TOUCH), {
        platform: "unsupported",
        guideKind: null,
    });
    assert.deepEqual(detectInstallPlatform(CHROME_MAC_UA, false, NO_TOUCH), {
        platform: "unsupported",
        guideKind: null,
    });
    assert.deepEqual(detectInstallPlatform(SAFARI_17_UA, false, NO_TOUCH), {
        platform: "unsupported",
        guideKind: null,
    });
});

test("detectInstallPlatform：移动端 UA 一律 unsupported（即使安全上下文）", () => {
    assert.deepEqual(detectInstallPlatform(IPHONE_UA, SECURE, 5), {
        platform: "unsupported",
        guideKind: null,
    });
    assert.deepEqual(detectInstallPlatform(ANDROID_UA, SECURE, 5), {
        platform: "unsupported",
        guideKind: null,
    });
});

test("detectInstallPlatform：iPad 伪装 Macintosh 桌面 UA 时按触点数排除", () => {
    assert.deepEqual(detectInstallPlatform(SAFARI_17_UA, SECURE, 5), {
        platform: "unsupported",
        guideKind: null,
    });
    // 真 Mac 桌面 Safari 无多点触控
    assert.deepEqual(detectInstallPlatform(SAFARI_17_UA, SECURE, NO_TOUCH), {
        platform: "safari-mac",
        guideKind: "safari-dock",
    });
});

test("detectInstallPlatform：Edge UA 判定为 chromium-desktop + edge-menu", () => {
    assert.deepEqual(detectInstallPlatform(EDGE_UA, SECURE, NO_TOUCH), {
        platform: "chromium-desktop",
        guideKind: "edge-menu",
    });
});

test("detectInstallPlatform：Chrome UA（mac/win）判定为 chromium-desktop + chrome-menu", () => {
    assert.deepEqual(detectInstallPlatform(CHROME_MAC_UA, SECURE, NO_TOUCH), {
        platform: "chromium-desktop",
        guideKind: "chrome-menu",
    });
    assert.deepEqual(detectInstallPlatform(CHROME_WIN_UA, SECURE, NO_TOUCH), {
        platform: "chromium-desktop",
        guideKind: "chrome-menu",
    });
});

test("detectInstallPlatform：UA 含 Chrome/ 的 Opera / Vivaldi 排除", () => {
    assert.deepEqual(detectInstallPlatform(OPERA_UA, SECURE, NO_TOUCH), {
        platform: "unsupported",
        guideKind: null,
    });
    assert.deepEqual(detectInstallPlatform(VIVALDI_UA, SECURE, NO_TOUCH), {
        platform: "unsupported",
        guideKind: null,
    });
});

test("detectInstallPlatform：Mac Safari Version ≥ 17 判定为 safari-mac + safari-dock", () => {
    assert.deepEqual(detectInstallPlatform(SAFARI_17_UA, SECURE, NO_TOUCH), {
        platform: "safari-mac",
        guideKind: "safari-dock",
    });
});

test("detectInstallPlatform：Mac Safari Version < 17 unsupported", () => {
    assert.deepEqual(detectInstallPlatform(SAFARI_16_UA, SECURE, NO_TOUCH), {
        platform: "unsupported",
        guideKind: null,
    });
});

test("detectInstallPlatform：Firefox 等其他桌面浏览器 unsupported", () => {
    assert.deepEqual(detectInstallPlatform(FIREFOX_UA, SECURE, NO_TOUCH), {
        platform: "unsupported",
        guideKind: null,
    });
    assert.deepEqual(detectInstallPlatform("", SECURE, NO_TOUCH), {
        platform: "unsupported",
        guideKind: null,
    });
});

test("showInstallEntry：平台支持且未 standalone 且本会话未安装时显示", () => {
    assert.equal(
        showInstallEntry({ platform: "chromium-desktop", standalone: false, installedThisSession: false }),
        true,
    );
    assert.equal(
        showInstallEntry({ platform: "safari-mac", standalone: false, installedThisSession: false }),
        true,
    );
});

test("showInstallEntry：unsupported / standalone / 本会话已安装任一成立即隐藏", () => {
    assert.equal(
        showInstallEntry({ platform: "unsupported", standalone: false, installedThisSession: false }),
        false,
    );
    assert.equal(
        showInstallEntry({ platform: "chromium-desktop", standalone: true, installedThisSession: false }),
        false,
    );
    assert.equal(
        showInstallEntry({ platform: "chromium-desktop", standalone: false, installedThisSession: true }),
        false,
    );
});
