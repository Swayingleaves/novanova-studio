"use client";

const OUTPUT_MIME_TYPE = "image/png";

export type ImageCropRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type ImageSplitParams = {
    rows: number;
    columns: number;
};

export type ImageSplitPiece = {
    row: number;
    column: number;
    dataUrl: string;
};

type ImageFrame = {
    left: number;
    top: number;
    width: number;
    height: number;
};

type ImageGrid = {
    rows: number;
    columns: number;
};

export async function cropDataUrl(dataUrl: string, crop?: ImageCropRect): Promise<string> {
    const image = await readSourceImage(dataUrl);
    const frame = crop ? createCropFrame(image, crop) : createCenteredSquareFrame(image);
    return renderFrame(image, frame);
}

export async function splitDataUrl(dataUrl: string, params: ImageSplitParams): Promise<ImageSplitPiece[]> {
    const image = await readSourceImage(dataUrl);
    const grid = normalizeGrid(params);

    return collectGridPieces(image, grid);
}

function collectGridPieces(image: HTMLImageElement, grid: ImageGrid): ImageSplitPiece[] {
    const pieces: ImageSplitPiece[] = [];
    for (let row = 0; row < grid.rows; row += 1) {
        for (let column = 0; column < grid.columns; column += 1) {
            pieces.push({
                row,
                column,
                dataUrl: renderFrame(image, createGridFrame(image, row, column, grid)),
            });
        }
    }
    return pieces;
}

function createCropFrame(image: HTMLImageElement, crop: ImageCropRect): ImageFrame {
    const boundedLeft = clampUnit(crop.x);
    const boundedTop = clampUnit(crop.y);
    const boundedWidth = clampRange(crop.width, 0, 1 - boundedLeft);
    const boundedHeight = clampRange(crop.height, 0, 1 - boundedTop);
    const left = Math.min(image.width - 1, Math.floor(boundedLeft * image.width));
    const top = Math.min(image.height - 1, Math.floor(boundedTop * image.height));

    return {
        left,
        top,
        width: Math.max(1, Math.min(image.width - left, Math.ceil(boundedWidth * image.width))),
        height: Math.max(1, Math.min(image.height - top, Math.ceil(boundedHeight * image.height))),
    };
}

function createCenteredSquareFrame(image: HTMLImageElement): ImageFrame {
    const sideLength = Math.max(1, Math.min(image.width, image.height));
    return {
        left: Math.floor((image.width - sideLength) / 2),
        top: Math.floor((image.height - sideLength) / 2),
        width: sideLength,
        height: sideLength,
    };
}

function createGridFrame(image: HTMLImageElement, row: number, column: number, grid: ImageGrid): ImageFrame {
    const left = Math.floor((column * image.width) / grid.columns);
    const top = Math.floor((row * image.height) / grid.rows);
    const right = Math.floor(((column + 1) * image.width) / grid.columns);
    const bottom = Math.floor(((row + 1) * image.height) / grid.rows);

    return {
        left,
        top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top),
    };
}

function renderFrame(image: HTMLImageElement, frame: ImageFrame): string {
    const canvas = document.createElement("canvas");
    canvas.width = frame.width;
    canvas.height = frame.height;
    const context = canvas.getContext("2d");
    if (!context) {
        throw new Error("图片画布上下文初始化失败");
    }
    context.drawImage(image, frame.left, frame.top, frame.width, frame.height, 0, 0, frame.width, frame.height);
    return canvas.toDataURL(OUTPUT_MIME_TYPE);
}

function readSourceImage(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("图片读取失败"));
        image.src = dataUrl;
    });
}

function normalizeGrid(params: ImageSplitParams): ImageGrid {
    return {
        rows: normalizePositiveInteger(params.rows),
        columns: normalizePositiveInteger(params.columns),
    };
}

function normalizePositiveInteger(value: number): number {
    const numericValue = Number.isFinite(value) ? value : 1;
    return Math.max(1, Math.floor(numericValue));
}

function clampUnit(value: number): number {
    return clampRange(value, 0, 1);
}

function clampRange(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
        return min;
    }
    return Math.min(max, Math.max(min, value));
}
