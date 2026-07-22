import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type { CanvasPoint, CanvasViewTransform } from "../types";

type CanvasContainerOffset = {
    left: number;
    top: number;
};

export function convertScreenPointToCanvas(point: CanvasPoint, offset: CanvasContainerOffset, viewport: CanvasViewTransform): CanvasPoint {
    return {
        x: (point.x - offset.left - viewport.x) / viewport.k,
        y: (point.y - offset.top - viewport.y) / viewport.k,
    };
}

export function useCanvasViewportGeometry(
    containerRef: RefObject<HTMLDivElement | null>,
    viewport: CanvasViewTransform,
    setViewport: (viewport: CanvasViewTransform) => void,
) {
    const viewportRef = useRef(viewport);
    const initializedRef = useRef(false);
    const [containerSize, setContainerSize] = useState({ width: 1200, height: 720 });
    viewportRef.current = viewport;

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const measure = () => {
            const bounds = container.getBoundingClientRect();
            setContainerSize({ width: bounds.width, height: bounds.height });
            if (initializedRef.current) return;
            initializedRef.current = true;
            setViewport({ x: bounds.width / 2, y: bounds.height / 2, k: 1 });
        };

        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(container);
        return () => observer.disconnect();
    }, [containerRef, setViewport]);

    const screenToCanvas = useCallback(
        (clientX: number, clientY: number) => {
            const bounds = containerRef.current?.getBoundingClientRect();
            return convertScreenPointToCanvas(
                { x: clientX, y: clientY },
                { left: bounds?.left || 0, top: bounds?.top || 0 },
                viewportRef.current,
            );
        },
        [containerRef],
    );

    const getCanvasCenter = useCallback(() => {
        const bounds = containerRef.current?.getBoundingClientRect();
        return screenToCanvas(
            (bounds?.left || 0) + (bounds?.width || containerSize.width) / 2,
            (bounds?.top || 0) + (bounds?.height || containerSize.height) / 2,
        );
    }, [containerRef, containerSize.height, containerSize.width, screenToCanvas]);

    return { size: containerSize, screenToCanvas, getCanvasCenter };
}
