import { create } from "zustand";
import { creditAmount, type CreditAmount } from "@/shared/lib/credit-amounts";

const insufficientCreditsMessageKeys = new Set([
    "business.insufficientCreditsToCreateGenerationTask",
    "business.insufficientCreditsFor",
    "business.insufficientCreditsForDeduction",
    "business.insufficientCreditsForStorageCapacity",
]);

/** 只识别本站钱包的明确业务消息，不将供应商额度错误当作购买积分入口。 */
export function isInsufficientCreditsMessageKey(key: string | null | undefined) {
    return !!key && insufficientCreditsMessageKeys.has(key);
}

/** 浮动错误提示可据此跳过已由购买弹框承接的错误，页面失败状态仍保留。 */
export function isInsufficientCreditsError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    if ("messageKey" in error && typeof error.messageKey === "string") return isInsufficientCreditsMessageKey(error.messageKey);
    return "details" in error && isInsufficientCreditsError(error.details);
}

/** 报价或余额未知时不判断；积分比较沿用精确十进制计算。 */
export function hasInsufficientCredits(required: CreditAmount | null | undefined, available: CreditAmount | null | undefined) {
    if (required == null || available == null) return undefined;
    return creditAmount(required).isPositive() && creditAmount(required).greaterThan(available);
}

type InsufficientCreditsState = {
    scope: string;
    prompt: { message?: string } | null;
    handledEvents: ReadonlySet<string>;
    setScope: (scope: string) => void;
    show: (message?: string, eventId?: string, scope?: string) => void;
    close: () => void;
};

/** 同一时刻只展示一个提示，事件重放不会重复打断用户，空间切换后清空。 */
export const useInsufficientCreditsStore = create<InsufficientCreditsState>((set, get) => ({
    scope: "",
    prompt: null,
    handledEvents: new Set(),
    setScope: (scope) => {
        if (scope !== get().scope) set({ scope, prompt: null, handledEvents: new Set() });
    },
    show: (message, eventId, scope = get().scope) => {
        const state = get();
        if (scope !== state.scope || (eventId && state.handledEvents.has(eventId))) return;
        set({
            prompt: state.prompt ?? { message },
            handledEvents: eventId ? new Set([...state.handledEvents, eventId]) : state.handledEvents,
        });
    },
    close: () => set({ prompt: null }),
}));

/** 后台错误统一按消息键触发，调用方仍继续原有失败处理。 */
export function notifyInsufficientCredits(key: string | null | undefined, message?: string, eventId?: string, scope?: string) {
    if (!isInsufficientCreditsMessageKey(key)) return false;
    useInsufficientCreditsStore.getState().show(message, eventId, scope);
    return true;
}

/** 本地拦截使用与后台相同的全局提示入口。 */
export function showInsufficientCredits(message?: string) {
    useInsufficientCreditsStore.getState().show(message);
}
