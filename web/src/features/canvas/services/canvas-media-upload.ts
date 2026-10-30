import { findNonOverlappingCanvasNodePosition } from "../domain/canvas-page-node";
import type { CanvasNode, CanvasPoint } from "../types";

const MEDIA_UPLOAD_CONCURRENCY = 3;
const MEDIA_NODE_GAP = 54;

/** 限制单批上传并发，按选择顺序保留结果；离开画布后停止调度与进度回调。 */
export async function uploadCanvasFiles<Result>(
    files: readonly File[],
    uploadFile: (file: File) => Promise<Result>,
    signal: AbortSignal,
    onProgress: (completed: number) => void,
): Promise<PromiseSettledResult<Result>[]> {
    const results: PromiseSettledResult<Result>[] = new Array(files.length);
    let nextIndex = 0;
    let completed = 0;
    const uploadNext = async () => {
        while (!signal.aborted && nextIndex < files.length) {
            const index = nextIndex++;
            try {
                results[index] = { status: "fulfilled", value: await uploadFile(files[index]) };
            } catch (reason) {
                results[index] = { status: "rejected", reason };
            }
            if (signal.aborted) return;
            onProgress(++completed);
        }
    };
    await Promise.all(Array.from({ length: Math.min(MEDIA_UPLOAD_CONCURRENCY, files.length) }, uploadNext));
    return signal.aborted ? [] : results;
}

/** 按文件顺序排成最多三列，整体避让已有节点，保留每个媒体的原始尺寸比例。 */
export function layoutUploadedCanvasNodes(nodes: CanvasNode[], existingNodes: CanvasNode[], center: CanvasPoint): CanvasNode[] {
    if (!nodes.length) return [];
    const columns = Math.min(3, nodes.length);
    const columnWidths = Array<number>(columns).fill(0);
    const rowHeights = Array<number>(Math.ceil(nodes.length / columns)).fill(0);
    nodes.forEach((node, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        columnWidths[column] = Math.max(columnWidths[column], node.frame.width);
        rowHeights[row] = Math.max(rowHeights[row], node.frame.height);
    });
    const width = columnWidths.reduce((total, value) => total + value, 0) + MEDIA_NODE_GAP * (columns - 1);
    const height = rowHeights.reduce((total, value) => total + value, 0) + MEDIA_NODE_GAP * (rowHeights.length - 1);
    const origin = findNonOverlappingCanvasNodePosition(existingNodes, { x: center.x - width / 2, y: center.y - height / 2 }, width, height, MEDIA_NODE_GAP);
    const columnPositions: number[] = [];
    const rowPositions: number[] = [];
    columnWidths.reduce((position, value, index) => { columnPositions[index] = position; return position + value + MEDIA_NODE_GAP; }, origin.x);
    rowHeights.reduce((position, value, index) => { rowPositions[index] = position; return position + value + MEDIA_NODE_GAP; }, origin.y);
    return nodes.map((node, index) => ({
        ...node,
        frame: { ...node.frame, position: { x: columnPositions[index % columns], y: rowPositions[Math.floor(index / columns)] } },
    }));
}
