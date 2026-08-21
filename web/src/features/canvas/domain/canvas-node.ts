import type {
    CanvasExecutionState,
    CanvasImageContent,
    CanvasImageGenerationSettings,
    CanvasImageGrouping,
    CanvasImageNode,
    CanvasNode,
    CanvasNodeFrame,
    CanvasStoryboardAsset,
    CanvasStoryboardNode,
    CanvasStoryboardShot,
    CanvasTextNode,
    CanvasVideoCompositionData,
    CanvasVideoCompositionNode,
    CanvasVideoContent,
    CanvasVideoGenerationSettings,
    CanvasVideoNode,
} from "../types.ts";
import type { ObjectStorageFile } from "@/shared/types/object-storage";
import type { GenerationStyleSnapshot } from "@/services/api/server";
import type { VideoGenerationMode } from "@/features/settings/stores/use-config-store";

export type CanvasNodeAttributeStatus = "idle" | "loading" | "success" | "error";

export type CanvasNodeAttributes = {
    content?: string;
    prompt?: string;
    status?: CanvasNodeAttributeStatus;
    errorDetails?: string;
    taskId?: string;
    progress?: number;
    startedAt?: string;
    completedAt?: string;
    fontSize?: number;
    model?: string;
    generationType?: "generation" | "edit";
    size?: string;
    quality?: string;
    imageResolution?: string;
    count?: number;
    seconds?: string;
    vquality?: string;
    videoGenerationMode?: VideoGenerationMode;
    watermark?: string;
    references?: string[];
    referenceObjectStorages?: ObjectStorageFile[];
    videoReferences?: string[];
    videoReferenceObjectStorages?: ObjectStorageFile[];
    naturalWidth?: number;
    naturalHeight?: number;
    freeResize?: boolean;
    isBatchRoot?: boolean;
    batchRootId?: string;
    batchChildIds?: string[];
    batchUsesReferenceImages?: boolean;
    primaryImageId?: string;
    imageBatchExpanded?: boolean;
    storageKey?: string;
    mimeType?: string;
    bytes?: number;
    durationMs?: number;
    objectStorage?: ObjectStorageFile;
    generationStyleIds?: number[];
    generationStyleSnapshots?: GenerationStyleSnapshot[];
    storyboardShots?: CanvasStoryboardShot[];
    storyboardAssets?: CanvasStoryboardAsset[];
    videoCompositionInputVideoNodeIds?: string[];
    videoCompositionResultVideoNodeId?: string;
};

export function isImageNode(node: CanvasNode): node is CanvasImageNode {
    return node.kind === "image";
}

export function isTextNode(node: CanvasNode): node is CanvasTextNode {
    return node.kind === "text";
}

export function isVideoNode(node: CanvasNode): node is CanvasVideoNode {
    return node.kind === "video";
}

export function isVideoCompositionNode(node: CanvasNode): node is CanvasVideoCompositionNode {
    return node.kind === "videoComposition";
}

export function isStoryboardNode(node: CanvasNode): node is CanvasStoryboardNode {
    return node.kind === "storyboard";
}

export function updateCanvasNodeTitle<Node extends CanvasNode>(node: Node, title: string): Node {
    const normalizedTitle = title.trim();
    return normalizedTitle && normalizedTitle !== node.title ? { ...node, title: normalizedTitle } : node;
}

export function updateCanvasNodeFrame<Node extends CanvasNode>(node: Node, patch: Partial<CanvasNodeFrame>): Node {
    const frame = mergeDefined(node.frame, patch);
    return {
        ...node,
        frame: {
            ...frame,
            position: patch.position ? { ...patch.position } : node.frame.position,
        },
    };
}

export function updateCanvasNodeExecution<Node extends CanvasNode>(node: Node, patch: Partial<CanvasExecutionState>): Node {
    return {
        ...node,
        execution: mergeDefined(node.execution, patch),
    };
}

export function updateImageNodeContent(node: CanvasImageNode, patch: Partial<CanvasImageContent>): CanvasImageNode {
    return {
        ...node,
        content: mergeDefined(node.content, patch),
    };
}

export function updateTextNodeContent(node: CanvasTextNode, patch: Partial<CanvasTextNode["content"]>): CanvasTextNode {
    return {
        ...node,
        content: mergeDefined(node.content, patch),
    };
}

export function updateImageNodeGeneration(node: CanvasImageNode, patch: Partial<CanvasImageGenerationSettings>): CanvasImageNode {
    return {
        ...node,
        generation: mergeDefined(node.generation, patch),
    };
}

export function updateImageNodeGrouping(node: CanvasImageNode, patch: Partial<CanvasImageGrouping>): CanvasImageNode {
    return {
        ...node,
        grouping: mergeDefined(node.grouping, patch),
    };
}

export function updateVideoNodeContent(node: CanvasVideoNode, patch: Partial<CanvasVideoContent>): CanvasVideoNode {
    return {
        ...node,
        content: mergeDefined(node.content, patch),
    };
}

export function updateVideoNodeGeneration(node: CanvasVideoNode, patch: Partial<CanvasVideoGenerationSettings>): CanvasVideoNode {
    return {
        ...node,
        generation: mergeDefined(node.generation, patch),
    };
}

export function updateVideoCompositionNodeData(node: CanvasVideoCompositionNode, patch: Partial<CanvasVideoCompositionData>): CanvasVideoCompositionNode {
    return {
        ...node,
        composition: mergeDefined(node.composition, patch),
    };
}

export function updateStoryboardNodeContent(node: CanvasStoryboardNode, patch: Partial<CanvasStoryboardNode["content"]>): CanvasStoryboardNode {
    return {
        ...node,
        content: mergeDefined(node.content, patch),
    };
}

export function updateStoryboardNodeData(node: CanvasStoryboardNode, patch: Partial<CanvasStoryboardNode["storyboard"]>): CanvasStoryboardNode {
    return {
        ...node,
        storyboard: mergeDefined(node.storyboard, patch),
    };
}

export function applyCanvasNodeAttributes(node: CanvasNode, attributes?: CanvasNodeAttributes): CanvasNode {
    if (!attributes) return node;
    const phase = mapExecutionPhase(attributes.status, node.execution.phase);
    const executionPatch = {
        errorMessage: attributes.errorDetails,
        taskId: attributes.taskId,
        progress: attributes.progress,
        startedAt: attributes.startedAt,
        completedAt: attributes.completedAt,
    };
    const executed: CanvasNode =
        attributes.status === "success"
            ? {
                  ...node,
                  execution: {
                      phase: "succeeded",
                      ...((attributes.startedAt ?? node.execution.startedAt) ? { startedAt: attributes.startedAt ?? node.execution.startedAt } : {}),
                      ...(attributes.completedAt ? { completedAt: attributes.completedAt } : {}),
                  },
              }
            : attributes.status === "idle"
              ? { ...node, execution: { phase: "idle" as const } }
              : updateCanvasNodeExecution(node, { phase, ...executionPatch });
    const framed = updateCanvasNodeFrame(executed, {
        naturalWidth: attributes.naturalWidth,
        naturalHeight: attributes.naturalHeight,
        freeResize: attributes.freeResize,
    });

    if (isTextNode(framed)) {
        return updateTextNodeContent(framed, {
            text: attributes.content ?? framed.content.text,
            fontSize: attributes.fontSize ?? framed.content.fontSize,
        });
    }
    if (isImageNode(framed)) {
        const withContent = updateImageNodeContent(framed, {
            source: attributes.content ?? framed.content.source,
            storageKey: attributes.storageKey,
            mimeType: attributes.mimeType,
            bytes: attributes.bytes,
            objectStorage: attributes.objectStorage,
        });
        const withGeneration = updateImageNodeGeneration(withContent, {
            operation: attributes.generationType,
            prompt: attributes.prompt,
            model: attributes.model,
            size: attributes.size,
            quality: attributes.quality,
            resolution: attributes.imageResolution,
            count: attributes.count,
            references: attributes.references,
            referenceObjectStorages: attributes.referenceObjectStorages,
            generationStyleIds: attributes.generationStyleIds,
            generationStyleSnapshots: attributes.generationStyleSnapshots,
        });
        return updateImageNodeGrouping(withGeneration, {
            isRoot: attributes.isBatchRoot,
            rootId: attributes.batchRootId,
            childIds: attributes.batchChildIds,
            usesReferenceImages: attributes.batchUsesReferenceImages,
            primaryImageId: attributes.primaryImageId,
            expanded: attributes.imageBatchExpanded,
        });
    }
    if (isStoryboardNode(framed)) {
        const withContent = updateStoryboardNodeContent(framed, {
            instruction: attributes.content,
            model: attributes.model,
        });
        return updateStoryboardNodeData(withContent, {
            shots: attributes.storyboardShots,
            assets: attributes.storyboardAssets,
        });
    }
    if (isVideoCompositionNode(framed)) {
        return updateVideoCompositionNodeData(framed, {
            inputVideoNodeIds: attributes.videoCompositionInputVideoNodeIds,
            resultVideoNodeId: attributes.videoCompositionResultVideoNodeId,
        });
    }
    const withContent = updateVideoNodeContent(framed, {
        source: attributes.content ?? framed.content.source,
        storageKey: attributes.storageKey,
        mimeType: attributes.mimeType,
        bytes: attributes.bytes,
        durationMilliseconds: attributes.durationMs,
        objectStorage: attributes.objectStorage,
    });
    return updateVideoNodeGeneration(withContent, {
        prompt: attributes.prompt,
        model: attributes.model,
        size: attributes.size,
        seconds: attributes.seconds,
        quality: attributes.vquality,
        videoGenerationMode: attributes.videoGenerationMode,
        watermark: attributes.watermark,
        count: attributes.count,
        references: attributes.references,
        referenceObjectStorages: attributes.referenceObjectStorages,
        videoReferences: attributes.videoReferences,
        videoReferenceObjectStorages: attributes.videoReferenceObjectStorages,
        generationStyleIds: attributes.generationStyleIds,
        generationStyleSnapshots: attributes.generationStyleSnapshots,
    });
}

function mergeDefined<Value extends object>(source: Value, patch: Partial<Value>): Value {
    const result = { ...source };
    Object.entries(patch).forEach(([key, value]) => {
        if (value !== undefined) (result as Record<string, unknown>)[key] = value;
    });
    return result;
}

function mapExecutionPhase(status: CanvasNodeAttributeStatus | undefined, fallback: CanvasExecutionState["phase"]): CanvasExecutionState["phase"] {
    if (status === "loading") return "running";
    if (status === "success") return "succeeded";
    if (status === "error") return "failed";
    if (status === "idle") return "idle";
    return fallback;
}
