"use client";

type NodeRect = {
    width: number;
    height: number;
};

export function fitNodeSize(width: number, height: number, maxWidth = 640, maxHeight = 640): NodeRect {
    const originalWidth = coercePositiveNumber(width);
    const originalHeight = coercePositiveNumber(height);
    const allowedWidth = coercePositiveNumber(maxWidth);
    const allowedHeight = coercePositiveNumber(maxHeight);
    const scale = Math.min(1, allowedWidth / originalWidth, allowedHeight / originalHeight);

    return {
        width: originalWidth * scale,
        height: originalHeight * scale,
    };
}

export function nodeSizeFromRatio(size: string, baseWidth: number, baseHeight: number): NodeRect | null {
    const ratio = parseAspectRatio(size);
    if (!ratio) return null;

    const safeBaseWidth = coercePositiveNumber(baseWidth);
    const safeBaseHeight = coercePositiveNumber(baseHeight);
    if (ratio < 0.25 || ratio > 4) {
        return { width: safeBaseWidth, height: safeBaseHeight };
    }

    const baseRatio = safeBaseWidth / safeBaseHeight;
    if (ratio >= baseRatio) {
        return { width: safeBaseWidth, height: safeBaseWidth / ratio };
    }

    return { width: safeBaseHeight * ratio, height: safeBaseHeight };
}

function parseAspectRatio(size: string): number | null {
    const match = String(size || "").trim().match(/^(\d+(?:\.\d+)?)(?:x|:)(\d+(?:\.\d+)?)/i);
    if (!match) return null;

    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

    return width / height;
}

function coercePositiveNumber(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : 1;
}
