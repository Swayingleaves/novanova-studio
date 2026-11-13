/** 在图片左上角合成 “AI生成” 标识，用于导出文件而不是页面展示。 */

const LABEL = "AI生成";

/**
 * 把标识画进图片像素，返回新的 Blob。
 *
 * @param blob 原始图片
 * @returns 合成后的图片；非图片、浏览器不支持或合成失败时返回原 Blob
 */
export async function applyAiWatermark(blob: Blob): Promise<Blob> {
    if (!blob.type.startsWith("image/") || typeof document === "undefined" || typeof createImageBitmap !== "function") return blob;
    let bitmap: ImageBitmap;
    try {
        bitmap = await createImageBitmap(blob);
    } catch {
        return blob;
    }
    try {
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        if (!context) return blob;
        context.drawImage(bitmap, 0, 0);
        drawLabel(context, bitmap.width, bitmap.height);
        const type = blob.type === "image/jpeg" ? "image/jpeg" : "image/png";
        const output = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, type === "image/jpeg" ? 0.92 : undefined));
        return output?.size ? output : blob;
    } finally {
        bitmap.close();
    }
}

/** 在图片左上角合成 “AI生成” 磨砂标识，样式对齐即梦：浅色玻璃底 + 细白描边 + 圆环图标。 */
function drawLabel(context: CanvasRenderingContext2D, width: number, height: number) {
    const shortest = Math.min(width, height);
    const fontSize = Math.max(14, Math.round(shortest * 0.032));
    const paddingX = Math.round(fontSize * 0.7);
    const paddingY = Math.round(fontSize * 0.4);
    const icon = Math.round(fontSize * 0.36);
    const gap = Math.round(fontSize * 0.35);
    const margin = Math.max(8, Math.round(shortest * 0.02));
    context.font = `500 ${fontSize}px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
    context.textBaseline = "middle";
    const textWidth = context.measureText(LABEL).width;
    const boxWidth = paddingX * 2 + icon * 2 + gap + textWidth;
    const boxHeight = fontSize + paddingY * 2;
    const x = margin;
    const y = margin;
    roundRect(context, x, y, boxWidth, boxHeight, Math.round(boxHeight * 0.32));
    context.fillStyle = "rgba(255, 255, 255, 0.16)";
    context.fill();
    context.strokeStyle = "rgba(255, 255, 255, 0.55)";
    context.lineWidth = Math.max(1, fontSize * 0.06);
    context.stroke();
    context.beginPath();
    context.arc(x + paddingX + icon, y + boxHeight / 2, icon, 0, Math.PI * 2);
    context.strokeStyle = "rgba(255, 255, 255, 0.9)";
    context.lineWidth = Math.max(1, fontSize * 0.09);
    context.stroke();
    context.fillStyle = "rgba(255, 255, 255, 0.95)";
    context.shadowColor = "rgba(0, 0, 0, 0.3)";
    context.shadowBlur = Math.round(fontSize * 0.15);
    context.fillText(LABEL, x + paddingX + icon * 2 + gap, y + boxHeight / 2 + 1);
    context.shadowColor = "transparent";
    context.shadowBlur = 0;
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
    context.beginPath();
    context.moveTo(x + radius, y);
    context.arcTo(x + width, y, x + width, y + height, radius);
    context.arcTo(x + width, y + height, x, y + height, radius);
    context.arcTo(x, y + height, x, y, radius);
    context.arcTo(x, y, x + width, y, radius);
    context.closePath();
}
