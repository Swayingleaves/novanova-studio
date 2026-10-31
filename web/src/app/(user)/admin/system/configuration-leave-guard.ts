import { registerHistoryLeaveGuard } from "@/shared/lib/navigation-history-guard";

/** 仅离开当前后台路径时确认；页签、页内锚点和新标签页不会丢弃配置。 */
export function leavesConfigurationPage(destination: string, currentAddress: string) {
    const current = new URL(currentAddress);
    const target = new URL(destination, current);
    return target.origin !== current.origin || target.pathname !== current.pathname;
}

/** 沿用创作页面的捕获阶段导航拦截，真正卸载页面时使用浏览器原生确认。 */
export function registerConfigurationLeaveGuard(confirmLeave: () => Promise<boolean>, navigate: (destination: string) => void) {
    let pendingConfirmation: Promise<boolean> | null = null;
    let active = true;
    let accepted = false;
    const requestConfirmation = () => {
        if (accepted) return Promise.resolve(true);
        if (pendingConfirmation) return Promise.resolve(false);
        pendingConfirmation = confirmLeave().then((proceed) => {
            accepted = active && proceed;
            return accepted;
        }).finally(() => { pendingConfirmation = null; });
        return pendingConfirmation;
    };
    const unregisterHistory = registerHistoryLeaveGuard(requestConfirmation);
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
        if (accepted) return;
        event.preventDefault();
        event.returnValue = "";
    };
    const interceptLink = (event: MouseEvent) => {
        if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        const link = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
        if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download") || !leavesConfigurationPage(link.href, window.location.href)) return;
        if (!["http:", "https:"].includes(new URL(link.href).protocol)) return;
        event.preventDefault();
        event.stopPropagation();
        if (pendingConfirmation) return;
        void requestConfirmation().then((proceed) => {
            if (!active || !proceed) return;
            accepted = true;
            navigate(link.href);
        });
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    document.addEventListener("click", interceptLink, { capture: true });
    return () => {
        active = false;
        unregisterHistory();
        window.removeEventListener("beforeunload", warnBeforeUnload);
        document.removeEventListener("click", interceptLink, { capture: true });
    };
}

