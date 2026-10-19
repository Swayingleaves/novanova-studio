let confirmLeave: (() => Promise<boolean>) | null = null;

/** 程序化导航与退出登录在改变页面或会话前共用当前页面确认。 */
export async function confirmPageNavigation(destination?: string) {
    if (!confirmLeave) return true;
    if (destination) {
        const target = new URL(destination, window.location.href);
        if (target.origin === window.location.origin && target.pathname === window.location.pathname) return true;
    }
    return confirmLeave();
}

/** 注册页面的离开确认，卸载时撤销，避免旧空间影响新空间。 */
export function registerHistoryLeaveGuard(confirm: () => Promise<boolean>) {
    confirmLeave = confirm;
    return () => { if (confirmLeave === confirm) confirmLeave = null; };
}

/** 等待 Next.js 完成历史方法安装，并避开开发模式重复挂载后再追踪导航。 */
export function trackNavigationHistory() {
    let active = true;
    let dispose: (() => void) | undefined;
    queueMicrotask(() => { if (active) dispose = installNavigationHistory(); });
    return () => { active = false; dispose?.(); };
}

/** 给本次页面运行的历史条目标记位置，后退取消时可准确恢复且不丢失 Next.js 的历史状态。 */
function installNavigationHistory() {
    const token = crypto.randomUUID();
    let position = 0;
    let currentAddress = window.location.href;
    let acceptedPosition: number | null = null;
    let restored: (() => void) | null = null;
    let confirming = false;
    const originalPush = window.history.pushState;
    const originalReplace = window.history.replaceState;
    const stamp = (state: Record<string, unknown> | null) => ({ ...state, novanovaNavigation: { token, position } });
    const push: History["pushState"] = function (state, unused, url) {
        position += 1;
        originalPush.call(window.history, stamp(state), unused, url);
        currentAddress = window.location.href;
    };
    const replace: History["replaceState"] = function (state, unused, url) {
        originalReplace.call(window.history, stamp(state), unused, url);
        currentAddress = window.location.href;
    };
    originalReplace.call(window.history, stamp(window.history.state), "");
    window.history.pushState = push;
    window.history.replaceState = replace;
    const interceptHistory = (event: PopStateEvent) => {
        const next = event.state?.novanovaNavigation;
        // 不属于本次运行的文档交给浏览器处理，其离开确认由 beforeunload 负责。
        if (next?.token !== token) return;
        if (restored && next.position === position) {
            event.stopImmediatePropagation();
            const resolve = restored;
            restored = null;
            resolve();
            return;
        }
        if (confirming && next.position === position) {
            event.stopImmediatePropagation();
            return;
        }
        const current = new URL(currentAddress);
        const destination = new URL(window.location.href);
        const samePage = destination.origin === current.origin && destination.pathname === current.pathname;
        if (!confirmLeave || samePage || next.position === acceptedPosition || next.position === position) {
            position = next.position;
            currentAddress = window.location.href;
            acceptedPosition = null;
            return;
        }
        event.stopImmediatePropagation();
        const distance = next.position - position;
        if (confirming) {
            window.history.go(-distance);
            return;
        }
        confirming = true;
        const confirm = confirmLeave;
        const restore = new Promise<void>((resolve) => { restored = resolve; });
        window.history.go(-distance);
        void restore.then(async () => {
            if (confirmLeave !== confirm || !await confirm()) return;
            if (confirmLeave !== confirm) return;
            acceptedPosition = next.position;
            window.history.go(distance);
        }).finally(() => { confirming = false; });
    };
    window.addEventListener("popstate", interceptHistory, { capture: true });
    return () => {
        window.removeEventListener("popstate", interceptHistory, { capture: true });
        if (window.history.pushState === push) window.history.pushState = originalPush;
        if (window.history.replaceState === replace) window.history.replaceState = originalReplace;
    };
}
