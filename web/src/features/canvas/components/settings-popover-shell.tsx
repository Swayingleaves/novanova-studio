"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "antd";

import type { CanvasTheme } from "@/shared/lib/canvas-theme";
import { useCanvasTheme } from "./canvas-theme-provider";

/** 浮层相对触发按钮的定位方位。 */
export type PopoverPlacement = "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";

type SettingsPopoverShellProps = {
    /** 触发按钮内显示的摘要文本。 */
    summary: string;
    /** 触发按钮前置图标。 */
    icon?: ReactNode;
    /** 自定义触发按钮类名。 */
    buttonClassName?: string;
    /** 定位方位，默认 topLeft。 */
    placement?: PopoverPlacement;
    /** 浮层开关变化回调。 */
    onOpenChange?: (open: boolean) => void;
    /** 浮层宽度。 */
    width?: number;
    /** 浮层内嵌入的面板内容。 */
    children: ReactNode;
};

/**
 * 画布设置浮层的通用容器：管理触发按钮、浮层定位、
 * 点击外部关闭和窗口同步。内部面板由各具体浮层提供。
 */
export function SettingsPopoverShell({ summary, icon, buttonClassName, placement = "topLeft", onOpenChange, width = 356, children }: SettingsPopoverShellProps) {
    const theme = useCanvasTheme();
    const anchorRef = useRef<HTMLSpanElement>(null);
    const layerRef = useRef<HTMLDivElement>(null);
    const [active, setActive] = useState(false);
    const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
    // 用 ref 跟踪当前开关状态，避免在 state 更新函数内触发外部回调。
    const activeRef = useRef(false);
    activeRef.current = active;

    const toggle = () => {
        const next = !activeRef.current;
        setActive(next);
        onOpenChange?.(next);
    };

    useEffect(() => {
        if (!active) return;
        const resync = () => setAnchorRect(anchorRef.current?.getBoundingClientRect() ?? null);
        const dismiss = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (anchorRef.current?.contains(target) || layerRef.current?.contains(target)) return;
            if (document.activeElement instanceof HTMLElement && layerRef.current?.contains(document.activeElement)) document.activeElement.blur();
            setActive(false);
            onOpenChange?.(false);
        };
        resync();
        window.addEventListener("resize", resync);
        window.addEventListener("scroll", resync, true);
        window.addEventListener("pointerdown", dismiss, true);
        return () => {
            window.removeEventListener("resize", resync);
            window.removeEventListener("scroll", resync, true);
            window.removeEventListener("pointerdown", dismiss, true);
        };
    }, [active, onOpenChange]);

    return (
        <>
            <span ref={anchorRef} className="inline-flex min-w-0">
                <Button
                    type="text"
                    size="small"
                    className={buttonClassName ?? "!h-8 !max-w-[170px] !justify-start !rounded-full !px-2.5"}
                    style={{ background: theme.node.fill, color: theme.node.text }}
                    icon={icon}
                    onClick={toggle}
                >
                    <span className="truncate">{summary}</span>
                </Button>
            </span>
            {active && anchorRect ? (
                <PopoverLayer layerRef={layerRef} anchorRect={anchorRect} placement={placement} width={width} theme={theme}>
                    {children}
                </PopoverLayer>
            ) : null}
        </>
    );
}

/** 浮层定位层，通过 portal 渲染到 body。 */
function PopoverLayer({ layerRef, anchorRect, placement, width, theme, children }: { layerRef: React.RefObject<HTMLDivElement | null>; anchorRect: DOMRect; placement: PopoverPlacement; width: number; theme: CanvasTheme; children: ReactNode }) {
    const layerWidth = Math.min(width, window.innerWidth - 24);
    const gap = 8;
    const edgeMargin = 12;
    const alignRight = placement.endsWith("Right");
    const alignCenter = placement === "top" || placement === "bottom";
    const placeAbove = placement.startsWith("top");

    const left = alignCenter ? anchorRect.left + anchorRect.width / 2 - layerWidth / 2 : alignRight ? anchorRect.right - layerWidth : anchorRect.left;
    const clampedLeft = Math.max(edgeMargin, Math.min(window.innerWidth - layerWidth - edgeMargin, left));

    const vertical = placeAbove
        ? { bottom: window.innerHeight - anchorRect.top + gap, maxHeight: Math.max(260, anchorRect.top - edgeMargin * 2) }
        : { top: anchorRect.bottom + gap, maxHeight: Math.max(260, window.innerHeight - anchorRect.bottom - edgeMargin * 2) };

    return createPortal(
        <div
            ref={layerRef}
            data-canvas-settings-popover
            style={{
                position: "fixed",
                zIndex: 1200,
                width: layerWidth,
                left: clampedLeft,
                ...vertical,
                background: theme.node.panel,
                borderRadius: 16,
                boxShadow: "0 16px 48px rgba(28,25,23,.14)",
                padding: 16,
                overflowY: "auto",
                color: theme.node.text,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
        >
            {children}
        </div>,
        document.body,
    );
}
