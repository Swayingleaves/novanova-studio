/** 主题偏好：跟随系统、浅色、暗色。 */
export type ThemePreference = "system" | "light" | "dark";

/** 实际生效主题：仅允许浅色或暗色。 */
export type ResolvedTheme = "light" | "dark";

/** 主题偏好本地存储键。 */
export const THEME_STORAGE_KEY = "novanova:theme";

/** 主题偏好 Cookie 键。 */
export const THEME_COOKIE_KEY = "novanova_theme";

/** 主题偏好 Cookie 保存时长：一年。 */
export const THEME_COOKIE_MAX_AGE = 31_536_000;

type CookieStoreLike = {
    get: (name: string) => { value: string } | undefined;
};

/**
 * 规范化主题偏好字符串。
 *
 * @param value string | null | undefined 原始偏好值
 * @return ThemePreference | null 合法主题偏好
 */
export function normalizeThemePreference(value: string | null | undefined): ThemePreference | null {
    if (value === "system" || value === "light" || value === "dark") return value;
    return null;
}

/**
 * 根据主题偏好和系统主题计算实际生效主题。
 *
 * @param preference ThemePreference 主题偏好
 * @param systemPrefersDark boolean 系统是否偏好暗色
 * @return ResolvedTheme 生效主题
 */
export function resolveThemePreference(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
    if (preference === "dark") return "dark";
    if (preference === "light") return "light";
    return systemPrefersDark ? "dark" : "light";
}

/**
 * 从完整 Cookie 字符串中解析主题偏好。
 *
 * @param cookieValue string | null | undefined Cookie 原始字符串
 * @return ThemePreference | null 主题偏好
 */
export function parseThemePreferenceFromCookie(cookieValue: string | null | undefined): ThemePreference | null {
    if (!cookieValue) return null;
    const cookieEntry = cookieValue
        .split(";")
        .map((item) => item.trim())
        .find((item) => item.startsWith(`${THEME_COOKIE_KEY}=`));

    if (!cookieEntry) return null;
    return normalizeThemePreference(decodeURIComponent(cookieEntry.slice(THEME_COOKIE_KEY.length + 1)));
}

/**
 * 从 Next.js CookieStore 中读取主题偏好。
 *
 * @param cookieStore CookieStoreLike Cookie 读取器
 * @return ThemePreference | null 主题偏好
 */
export function readThemePreferenceFromCookieStore(cookieStore: CookieStoreLike): ThemePreference | null {
    return normalizeThemePreference(cookieStore.get(THEME_COOKIE_KEY)?.value);
}

/**
 * 为 SSR 首屏选择一个稳定的初始主题。
 * <p>
 * 服务端无法直接获知系统主题，因此只有显式 dark 才首屏输出暗色，其余统一回浅色，随后再由 beforeInteractive 脚本修正。
 *
 * @param preference ThemePreference | null | undefined 主题偏好
 * @return ResolvedTheme 初始主题
 */
export function getInitialResolvedTheme(preference: ThemePreference | null | undefined): ResolvedTheme {
    return preference === "dark" ? "dark" : "light";
}

/**
 * 读取浏览器本地保存的主题偏好。
 *
 * @return ThemePreference | null 主题偏好
 */
export function readStoredThemePreference(): ThemePreference | null {
    if (typeof window === "undefined") return null;
    try {
        return normalizeThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
    } catch {
        return null;
    }
}

/**
 * 读取系统当前生效主题。
 *
 * @return ResolvedTheme 系统主题
 */
export function readSystemResolvedTheme(): ResolvedTheme {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * 将主题偏好持久化到 localStorage 与 Cookie。
 *
 * @param preference ThemePreference 主题偏好
 * @return void
 */
export function persistThemePreference(preference: ThemePreference): void {
    if (typeof window !== "undefined") {
        try {
            window.localStorage.setItem(THEME_STORAGE_KEY, preference);
        } catch {
            // 浏览器禁用本地存储时，仅保留内存状态。
        }
    }

    if (typeof document !== "undefined") {
        document.cookie = `${THEME_COOKIE_KEY}=${encodeURIComponent(preference)}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`;
    }
}

/**
 * 把生效主题同步到根节点。
 *
 * @param resolvedTheme ResolvedTheme 生效主题
 * @param preference ThemePreference | undefined 当前主题偏好
 * @return void
 */
export function applyResolvedThemeToDocument(resolvedTheme: ResolvedTheme, preference?: ThemePreference): void {
    if (typeof document === "undefined") return;

    const root = document.documentElement;
    root.setAttribute("data-theme", resolvedTheme);
    if (preference) root.setAttribute("data-theme-preference", preference);
    root.classList.toggle("dark", resolvedTheme === "dark");
    root.style.colorScheme = resolvedTheme;
}

/**
 * 构建首屏主题注入脚本。
 *
 * @param defaultPreference ThemePreference 默认主题偏好
 * @return string 可直接注入到 beforeInteractive 的脚本
 */
export function buildThemeBootstrapScript(defaultPreference: ThemePreference = "dark"): string {
    return `(()=>{try{var storageKey=${JSON.stringify(THEME_STORAGE_KEY)};var cookieKey=${JSON.stringify(THEME_COOKIE_KEY)};var defaultPreference=${JSON.stringify(defaultPreference)};var normalize=function(value){return value==="system"||value==="light"||value==="dark"?value:null;};var readCookie=function(){var target=document.cookie.split(";").map(function(item){return item.trim();}).find(function(item){return item.indexOf(cookieKey+"=")===0;});if(!target)return null;return normalize(decodeURIComponent(target.slice(cookieKey.length+1)));};var preference=normalize(window.localStorage.getItem(storageKey))||readCookie()||defaultPreference;var resolved=preference==="dark"?"dark":preference==="light"?"light":(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");var root=document.documentElement;root.setAttribute("data-theme",resolved);root.setAttribute("data-theme-preference",preference);root.classList.toggle("dark",resolved==="dark");root.style.colorScheme=resolved;}catch(error){var root=document.documentElement;root.setAttribute("data-theme","dark");root.setAttribute("data-theme-preference","dark");root.classList.add("dark");root.style.colorScheme="dark";}})();`;
}
