"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const KEYBOARD_RESIZE_STEP = 24;

type ResizableRightPanelOptions = {
    defaultWidth?: number;
    minWidth?: number;
    maxWidth?: number;
    /** 左侧主工作区需要保留的最小宽度，避免拉宽右侧面板时挤塌主内容。 */
    minMainWidth?: number;
    /** 本地持久化宽度的键名，省略时不持久化。 */
    storageKey?: string;
};

/**
 * 右侧协作面板（Nana助手等）拖拽调宽 Hook：
 * 支持左边界拖拽、键盘方向键微调、双击恢复默认宽度以及视口缩放自动钳制。
 */
export function useResizableRightPanel({
    defaultWidth = 380,
    minWidth = 320,
    maxWidth = 720,
    minMainWidth = 360,
    storageKey,
}: ResizableRightPanelOptions = {}) {
    const [width, setWidth] = useState(defaultWidth);
    const [isResizing, setIsResizing] = useState(false);
    const stopResizeRef = useRef<() => void>(() => undefined);

    const getMaxWidth = useCallback(() => {
        if (typeof window === "undefined") return maxWidth;
        return Math.max(minWidth, Math.min(maxWidth, window.innerWidth - minMainWidth));
    }, [maxWidth, minMainWidth, minWidth]);

    const clampWidth = useCallback(
        (nextWidth: number) => Math.min(getMaxWidth(), Math.max(minWidth, nextWidth)),
        [getMaxWidth, minWidth],
    );

    const persistWidth = useCallback(
        (nextWidth: number) => {
            if (!storageKey || typeof window === "undefined") return;
            try {
                window.localStorage.setItem(storageKey, String(Math.round(nextWidth)));
            } catch {
                // 忽略隐私模式或配额导致的存储异常
            }
        },
        [storageKey],
    );

    // 挂载后从 localStorage 恢复上次拖拽的宽度（避免 SSR 水合不一致）
    useEffect(() => {
        if (storageKey && typeof window !== "undefined") {
            try {
                const saved = Number(window.localStorage.getItem(storageKey));
                if (Number.isFinite(saved) && saved > 0) {
                    setWidth(clampWidth(saved));
                }
            } catch {
                // 忽略存储读取异常
            }
        }
        const handleWindowResize = () => setWidth((current) => clampWidth(current));
        window.addEventListener("resize", handleWindowResize);
        return () => {
            window.removeEventListener("resize", handleWindowResize);
            stopResizeRef.current();
        };
    }, [clampWidth, storageKey]);

    const startResize = useCallback(
        (event: React.PointerEvent<HTMLButtonElement>) => {
            if (event.button !== 0) return;
            event.preventDefault();
            stopResizeRef.current();
            const previousCursor = document.body.style.cursor;
            const previousUserSelect = document.body.style.userSelect;
            let latestWidth = width;

            const move = (pointerEvent: PointerEvent) => {
                latestWidth = clampWidth(window.innerWidth - pointerEvent.clientX);
                setWidth(latestWidth);
            };
            const stop = () => {
                setIsResizing(false);
                document.body.style.cursor = previousCursor;
                document.body.style.userSelect = previousUserSelect;
                document.removeEventListener("pointermove", move);
                document.removeEventListener("pointerup", stop);
                document.removeEventListener("pointercancel", stop);
                stopResizeRef.current = () => undefined;
                persistWidth(latestWidth);
            };

            setIsResizing(true);
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
            document.addEventListener("pointermove", move);
            document.addEventListener("pointerup", stop);
            document.addEventListener("pointercancel", stop);
            stopResizeRef.current = stop;
        },
        [clampWidth, persistWidth, width],
    );

    const resizeWithKeyboard = useCallback(
        (event: React.KeyboardEvent<HTMLButtonElement>) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const delta = event.key === "ArrowLeft" ? KEYBOARD_RESIZE_STEP : -KEYBOARD_RESIZE_STEP;
            setWidth((current) => {
                const next = clampWidth(current + delta);
                persistWidth(next);
                return next;
            });
        },
        [clampWidth, persistWidth],
    );

    const resetWidth = useCallback(() => {
        const next = clampWidth(defaultWidth);
        setWidth(next);
        persistWidth(next);
    }, [clampWidth, defaultWidth, persistWidth]);

    return {
        width,
        isResizing,
        minWidth,
        maxWidth: getMaxWidth(),
        startResize,
        resizeWithKeyboard,
        resetWidth,
    };
}
