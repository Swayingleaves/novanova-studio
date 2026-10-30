/**
 * PWA 安装入口的平台探测与显示策略（对应 PRD 4.4 节）。
 *
 * 纯函数模块：不接触浏览器 API，输入 UA / 安全上下文 / 触点数，
 * 输出平台判定结果，便于单测覆盖完整判定矩阵。
 */

/** 支持安装引导的桌面平台类型 */
export type InstallPlatform = "chromium-desktop" | "safari-mac" | "unsupported";

/** 手动安装引导的类型（对应不同浏览器的菜单路径） */
export type InstallGuideKind = "chrome-menu" | "edge-menu" | "safari-dock";

export interface InstallPlatformInfo {
    /** 平台判定结果，unsupported 表示不显示安装入口 */
    platform: InstallPlatform;
    /** 手动安装引导类型；unsupported 时为 null */
    guideKind: InstallGuideKind | null;
}

/** 移动端 UA 特征：含任一即视为移动端，本期不提供安装引导 */
const MOBILE_UA_PATTERN = /Android|iPhone|iPad|iPod|Mobile/;

/** Opera 特征（其 UA 同时含 Chrome/，需排除） */
const OPERA_UA_PATTERN = /OPR\//;

/** Vivaldi 特征（其 UA 同时含 Chrome/，需排除） */
const VIVALDI_UA_PATTERN = /Vivaldi\//;

/** Edge 桌面版特征（新 Edge UA 含 Edg/） */
const EDGE_UA_PATTERN = /Edg\//;

/** Chromium 系（Chrome / Edge）UA 中的 Chrome/ 版本标记 */
const CHROME_UA_PATTERN = /Chrome\//;

/** Safari（macOS）UA 特征 */
const MAC_SAFARI_UA_PATTERN = /Macintosh.*Safari/;

/** Safari UA 中的 Version/ 主版本号 */
const SAFARI_VERSION_PATTERN = /Version\/(\d+)/;

/**
 * 探测当前环境所属的可安装平台。
 *
 * 判定顺序（严格按 PRD 4.4）：
 * 1. 非安全上下文、移动端 UA、Macintosh UA 且触点数 > 1（iPad 伪装桌面）→ unsupported
 * 2. UA 含 Edg/ → chromium-desktop，edge-menu
 * 3. UA 含 Chrome/（排除 OPR/、Vivaldi/）→ chromium-desktop，chrome-menu
 * 4. Macintosh + Safari + Version ≥ 17 → safari-mac，safari-dock
 * 5. 其余 → unsupported
 */
export function detectInstallPlatform(
    userAgent: string,
    isSecureContext: boolean,
    maxTouchPoints: number,
): InstallPlatformInfo {
    if (!isSecureContext) {
        return { platform: "unsupported", guideKind: null };
    }

    const ua = userAgent ?? "";

    if (MOBILE_UA_PATTERN.test(ua)) {
        return { platform: "unsupported", guideKind: null };
    }

    // iPad 桌面模式下 UA 呈现 Macintosh，但 maxTouchPoints > 1
    const isMacintosh = /Macintosh/.test(ua);
    if (isMacintosh && maxTouchPoints > 1) {
        return { platform: "unsupported", guideKind: null };
    }

    if (EDGE_UA_PATTERN.test(ua)) {
        return { platform: "chromium-desktop", guideKind: "edge-menu" };
    }

    if (CHROME_UA_PATTERN.test(ua) && !OPERA_UA_PATTERN.test(ua) && !VIVALDI_UA_PATTERN.test(ua)) {
        return { platform: "chromium-desktop", guideKind: "chrome-menu" };
    }

    if (isMacintosh && MAC_SAFARI_UA_PATTERN.test(ua)) {
        const versionMatch = SAFARI_VERSION_PATTERN.exec(ua);
        const majorVersion = versionMatch ? Number.parseInt(versionMatch[1], 10) : 0;
        if (majorVersion >= 17) {
            return { platform: "safari-mac", guideKind: "safari-dock" };
        }
    }

    return { platform: "unsupported", guideKind: null };
}

export interface InstallEntryState {
    platform: InstallPlatform;
    /** 当前是否以 standalone（已安装）模式运行 */
    standalone: boolean;
    /** 本次会话内是否已触发 appinstalled */
    installedThisSession: boolean;
}

/**
 * 安装入口是否应显示。
 *
 * 平台不支持、已 standalone、本会话已安装 → 均隐藏入口。
 */
export function showInstallEntry(state: InstallEntryState): boolean {
    return state.platform !== "unsupported" && !state.standalone && !state.installedThisSession;
}
