const PENDING_INITIAL_PROMPT_KEY = "novanova:pending-initial-prompt";

/**
 * 读取当前地址或一次性导航缓存中的初始提示词。
 */
export function readInitialPromptFromLocation() {
    if (typeof window === "undefined") return "";
    const url = new URL(window.location.href);
    const queryPrompt = url.searchParams.get("initialPrompt")?.trim() || "";
    const isCanvasPath = url.pathname === "/canvas" || url.pathname.startsWith("/canvas/");
    return queryPrompt || (isCanvasPath ? window.sessionStorage.getItem(PENDING_INITIAL_PROMPT_KEY)?.trim() || "" : "");
}

/**
 * 保存一次性页面跳转提示词，供画布页面创建项目后读取。
 *
 * @param prompt string 需要带入目标页面的原始提示词
 */
export function storeInitialPromptForNavigation(prompt: string) {
    if (typeof window === "undefined") return;
    const value = prompt.trim();
    if (value) {
        window.sessionStorage.setItem(PENDING_INITIAL_PROMPT_KEY, value);
    } else {
        window.sessionStorage.removeItem(PENDING_INITIAL_PROMPT_KEY);
    }
}

/**
 * 清理地址和一次性导航缓存中的初始提示词，避免刷新页面时重复带入。
 */
export function clearInitialPromptFromLocation() {
    if (typeof window === "undefined") return;
    window.sessionStorage.removeItem(PENDING_INITIAL_PROMPT_KEY);
    const url = new URL(window.location.href);
    if (!url.searchParams.has("initialPrompt")) return;
    url.searchParams.delete("initialPrompt");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}
