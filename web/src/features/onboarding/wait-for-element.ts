/**
 * 轮询等待目标元素出现。
 * <p>
 * antd Tour 的 target 解析只在挂载与切步时执行一次，目标缺失会退化成居中展示，
 * 因此开演前必须先把所有锚点等齐。`query` 可注入，便于在无 DOM 的 node:test 里覆盖。
 */
export function waitForElement(
    selector: string,
    options: {
        timeoutMs?: number;
        intervalMs?: number;
        query?: (selector: string) => Element | null;
    } = {},
): Promise<Element | null> {
    const {
        timeoutMs = 3000,
        intervalMs = 50,
        query = (value: string) => (typeof document === "undefined" ? null : document.querySelector(value)),
    } = options;

    const immediate = query(selector);
    if (immediate) return Promise.resolve(immediate);

    const startedAt = Date.now();
    return new Promise((resolve) => {
        const timer = setInterval(() => {
            const element = query(selector);
            if (element || Date.now() - startedAt >= timeoutMs) {
                clearInterval(timer);
                resolve(element);
            }
        }, intervalMs);
    });
}
