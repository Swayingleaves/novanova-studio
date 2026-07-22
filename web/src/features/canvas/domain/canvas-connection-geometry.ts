import type { CanvasPoint } from "../types";

type CanvasRectangle = {
    position: CanvasPoint;
    width: number;
    height: number;
};

type CanvasConnectionPathInput = {
    start: CanvasPoint;
    end: CanvasPoint;
    minimumCurve?: number;
};

export function resolveCanvasConnectionAnchors(source: CanvasRectangle, target: CanvasRectangle) {
    return {
        start: { x: source.position.x + source.width, y: source.position.y + source.height / 2 },
        end: { x: target.position.x, y: target.position.y + target.height / 2 },
    };
}

export function createCanvasConnectionPath({ start, end, minimumCurve = 50 }: CanvasConnectionPathInput): string {
    const curve = Math.max(Math.abs(end.x - start.x) / 2, minimumCurve);
    return `M ${start.x} ${start.y} C ${start.x + curve} ${start.y} ${end.x - curve} ${end.y} ${end.x} ${end.y}`;
}
