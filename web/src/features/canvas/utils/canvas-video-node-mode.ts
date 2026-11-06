import type { VideoGenerationMode } from "@/features/settings/stores/use-config-store";
import type { CanvasConnection, CanvasNode, CanvasVideoNode } from "../types";
import { applyCanvasNodeAttributes, isAudioNode, isImageNode, isVideoNode } from "../domain/canvas-node";
import { buildNodeGenerationReferences, getGenerationResourceNodes } from "./canvas-resource-references";

/** 视频节点的参考素材数量，按来源与素材类型分组。 */
export type CanvasVideoNodeReferenceCounts = {
    /** 连线直接接入的图片、视频和音频数量。 */
    connected: { image: number; video: number; audio: number };
    /** 节点自身上传或上次生成保存的图片、视频和音频数量。 */
    persisted: { image: number; video: number; audio: number };
};

/** 视频节点生成模式同步结果。 */
export type CanvasVideoNodeGenerationModeSyncResult = {
    /** 同步后的节点列表；没有任何节点需要切换时返回原数组。 */
    nodes: CanvasNode[];
    /** 本次连线实际接入的素材总数，供下一次同步判断参考内容是否被移除。 */
    connectedMediaCounts: Map<string, number>;
};

/**
 * 统计视频节点可用的参考素材。
 *
 * @param node 视频节点
 * @param nodes 当前画布节点
 * @param connections 当前画布连线
 * @return 连线接入与节点持久化的参考素材数量
 */
export function readCanvasVideoNodeReferenceCounts(node: CanvasVideoNode, nodes: CanvasNode[], connections: CanvasConnection[]): CanvasVideoNodeReferenceCounts {
    const counts: CanvasVideoNodeReferenceCounts = {
        connected: { image: 0, video: 0, audio: 0 },
        persisted: { image: 0, video: 0, audio: 0 },
    };
    for (const resource of getGenerationResourceNodes(node.id, nodes, connections)) {
        if (isAudioNode(resource) && resource.content.source) counts.connected.audio += 1;
        else if (isImageNode(resource) && resource.content.source) counts.connected.image += 1;
        else if (isVideoNode(resource) && resource.content.source) counts.connected.video += 1;
    }
    for (const reference of buildNodeGenerationReferences(node)) {
        if (reference.kind === "audio") counts.persisted.audio += 1;
        else if (reference.kind === "video") counts.persisted.video += 1;
        else if (reference.kind === "image") counts.persisted.image += 1;
    }
    return counts;
}

/** 按素材类型统计的参考数量。 */
export type CanvasVideoReferenceKindCounts = { image: number; video: number; audio: number };

/**
 * 按图片、视频和音频数量推导视频生成模式。
 * <p>
 * 文本参考只合并进提示词，因此没有媒体参考时保持当前模式；接入图片判定为图生视频；接入视频或音频只能使用全能参考。
 * 首尾帧模式由用户显式选择，不参与自动切换。
 *
 * @param currentMode 当前生成模式
 * @param counts 各类型参考素材数量
 * @param revertEmpty 参考内容被移除后是否回落到文生视频
 * @return 推导后的生成模式
 */
export function resolveVideoGenerationMode(currentMode: VideoGenerationMode, counts: CanvasVideoReferenceKindCounts, revertEmpty = false): VideoGenerationMode {
    if (currentMode === "first-last-frame-to-video") return currentMode;
    if (counts.video || counts.audio) return "reference-to-video";
    if (counts.image) return currentMode === "text-to-video" ? "image-to-video" : currentMode;
    return revertEmpty && currentMode !== "text-to-video" ? "text-to-video" : currentMode;
}

/**
 * 按实际接入的参考内容推导视频生成模式。
 *
 * @param currentMode 当前生成模式
 * @param counts 参考素材数量
 * @param revertEmpty 参考内容被移除后是否回落到文生视频
 * @return 推导后的生成模式
 */
export function resolveVideoNodeGenerationMode(currentMode: VideoGenerationMode, counts: CanvasVideoNodeReferenceCounts, revertEmpty = false): VideoGenerationMode {
    return resolveVideoGenerationMode(
        currentMode,
        {
            image: counts.connected.image + counts.persisted.image,
            video: counts.connected.video + counts.persisted.video,
            audio: counts.connected.audio + counts.persisted.audio,
        },
        revertEmpty,
    );
}

/**
 * 按参考素材同步画布中所有视频节点的生成模式。
 *
 * @param nodes 当前画布节点
 * @param connections 当前画布连线
 * @param previousConnectedMediaCounts 上一次同步时各视频节点连线接入的素材数量
 * @return 同步结果
 */
export function synchronizeVideoNodeGenerationModes(nodes: CanvasNode[], connections: CanvasConnection[], previousConnectedMediaCounts: ReadonlyMap<string, number> = new Map()): CanvasVideoNodeGenerationModeSyncResult {
    const connectedMediaCounts = new Map<string, number>();
    let changed = false;
    const synchronizedNodes = nodes.map((node) => {
        if (!isVideoNode(node)) return node;
        const counts = readCanvasVideoNodeReferenceCounts(node, nodes, connections);
        const connectedMediaCount = counts.connected.image + counts.connected.video + counts.connected.audio;
        connectedMediaCounts.set(node.id, connectedMediaCount);
        const currentMode = node.generation.videoGenerationMode || "text-to-video";
        // 只有连线原本带来参考、又被全部移除时才回落文生视频，避免用户主动选择图片或全能参考模式后被立即改回。
        const revertEmpty = connectedMediaCount === 0 && (previousConnectedMediaCounts.get(node.id) || 0) > 0;
        const mode = resolveVideoNodeGenerationMode(currentMode, counts, revertEmpty);
        if (mode === currentMode) return node;
        changed = true;
        return applyCanvasNodeAttributes(node, { videoGenerationMode: mode });
    });
    return { nodes: changed ? synchronizedNodes : nodes, connectedMediaCounts };
}
