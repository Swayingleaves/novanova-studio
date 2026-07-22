/**
 * 读取当前地址中的初始提示词。
 */
export function readInitialPromptFromLocation() {
    if (typeof window === "undefined") return "";
    return new URL(window.location.href).searchParams.get("initialPrompt")?.trim() || "";
}

/**
 * 清理当前地址中的初始提示词，避免刷新页面时重复带入。
 */
export function clearInitialPromptFromLocation() {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("initialPrompt")) return;
    url.searchParams.delete("initialPrompt");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}
