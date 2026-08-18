import type { ObjectStorageFile } from "@/shared/types/object-storage";
import type { CanvasBackgroundMode } from "@/shared/lib/canvas-theme";
import type { GenerationStyleSnapshot } from "@/services/api/server";
import type { VideoGenerationMode } from "@/features/settings/stores/use-config-store";

export interface CanvasViewTransform {
    x: number;
    y: number;
    k: number;
}

export type CanvasGenerationMode = "text" | "image" | "video";

export type CanvasImageGenerationType = "generation" | "edit";

export interface CanvasConnection {
    id: string;
    source: CanvasConnectionEndpoint;
    target: CanvasConnectionEndpoint;
}

export interface CanvasAssistantReference {
    id: string;
    type: CanvasNodeKind;
    title: string;
    dataUrl?: string;
    storageKey?: string;
    objectStorage?: ObjectStorageFile;
    text?: string;
}

export interface CanvasAssistantImage {
    id: string;
    dataUrl: string;
    storageKey?: string;
    prompt: string;
    objectStorage?: ObjectStorageFile;
}

export interface CanvasAssistantMessage {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    references?: CanvasAssistantReference[];
    generationStyles?: Array<{ id: number; name: string; generationType: "image" | "video" }>;
}

export interface CanvasAssistantSession {
    id: string;
    title: string;
    messages: CanvasAssistantMessage[];
    createdAt: string;
    updatedAt: string;
}

export interface ConnectionHandle {
    nodeId: string;
    handleType: "source" | "target";
}

export interface SelectionBox {
    startWorldX: number;
    startWorldY: number;
    currentWorldX: number;
    currentWorldY: number;
    additive: boolean;
    initialSelectedNodeIds: string[];
}

type NodeContextMenuState = {
    type: "node";
    x: number;
    y: number;
    nodeId: string;
};

type ConnectionContextMenuState = {
    type: "connection";
    x: number;
    y: number;
    connectionId: string;
};

type CanvasContextMenuState = {
    type: "canvas";
    x: number;
    y: number;
    position: CanvasPoint;
};

type SelectionContextMenuState = {
    type: "selection";
    x: number;
    y: number;
    nodeIds: string[];
};

export type ContextMenuState = NodeContextMenuState | ConnectionContextMenuState | CanvasContextMenuState | SelectionContextMenuState;

export interface CanvasPoint {
    x: number;
    y: number;
}

export interface CanvasViewport {
    offsetX: number;
    offsetY: number;
    zoom: number;
}

export type CanvasNodeKind = "image" | "text" | "video" | "storyboard" | "videoComposition";

export type CanvasExecutionPhase = "idle" | "running" | "succeeded" | "failed";

export interface CanvasExecutionState {
    phase: CanvasExecutionPhase;
    taskId?: string;
    progress?: number;
    errorMessage?: string;
    startedAt?: string;
    completedAt?: string;
}

export interface CanvasNodeFrame {
    position: CanvasPoint;
    width: number;
    height: number;
    naturalWidth?: number;
    naturalHeight?: number;
    freeResize?: boolean;
}

export interface CanvasImageContent {
    source: string;
    storageKey?: string;
    mimeType?: string;
    bytes?: number;
    objectStorage?: ObjectStorageFile;
}

export interface CanvasImageGenerationSettings {
    operation: "generation" | "edit";
    prompt: string;
    model: string;
    size: string;
    quality: string;
    resolution: string;
    count: number;
    references: string[];
    referenceObjectStorages: ObjectStorageFile[];
    generationStyleIds: number[];
    generationStyleSnapshots: GenerationStyleSnapshot[];
}

export interface CanvasImageGrouping {
    isRoot: boolean;
    rootId?: string;
    childIds: string[];
    usesReferenceImages: boolean;
    primaryImageId?: string;
    expanded: boolean;
}

export interface CanvasVideoContent {
    source: string;
    storageKey?: string;
    mimeType?: string;
    bytes?: number;
    durationMilliseconds?: number;
    objectStorage?: ObjectStorageFile;
}

export interface CanvasVideoGenerationSettings {
    prompt: string;
    model: string;
    size: string;
    seconds: string;
    quality: string;
    /** 视频生成模式；历史画布数据缺失时按文生视频处理。 */
    videoGenerationMode?: VideoGenerationMode;
    watermark: string;
    count: number;
    /** 新版持久化的参考图片地址；历史数据可能缺失。 */
    references: string[];
    referenceObjectStorages: ObjectStorageFile[];
    /** 新版持久化的参考视频地址；历史数据可能缺失。 */
    videoReferences?: string[];
    /** 新版持久化的参考视频对象存储信息；历史数据可能缺失。 */
    videoReferenceObjectStorages?: ObjectStorageFile[];
    generationStyleIds: number[];
    generationStyleSnapshots: GenerationStyleSnapshot[];
}

interface CanvasNodeBase<Kind extends CanvasNodeKind> {
    id: string;
    kind: Kind;
    title: string;
    frame: CanvasNodeFrame;
    execution: CanvasExecutionState;
}

export interface CanvasImageNode extends CanvasNodeBase<"image"> {
    content: CanvasImageContent;
    generation: CanvasImageGenerationSettings;
    grouping: CanvasImageGrouping;
}

export interface CanvasTextNode extends CanvasNodeBase<"text"> {
    content: {
        text: string;
        fontSize: number;
    };
}

export type CanvasStoryboardShotSize = "大特写" | "特写" | "近景" | "头肩景" | "中景" | "中远景" | "全景" | "远景" | "大远景" | "大全景";

export type CanvasStoryboardAssetKind = "character" | "scene" | "prop";

export interface CanvasStoryboardAssetImage {
    source: string;
    storageKey?: string;
    mimeType?: string;
    objectStorage?: ObjectStorageFile;
}

export type CanvasStoryboardAssetGenerationPhase = "idle" | "running" | "succeeded" | "failed";

export type CanvasStoryboardAssetGenerationItemStatus = "pending" | "running" | "succeeded" | "failed";

export interface CanvasStoryboardAssetGenerationSettings {
    model: string;
    quality: string;
    imageResolution: string;
    size: string;
}

export interface CanvasStoryboardAssetGenerationState {
    phase: CanvasStoryboardAssetGenerationPhase;
    selectedAssetIds: string[];
    taskIds: Record<string, string>;
    statuses: Record<string, CanvasStoryboardAssetGenerationItemStatus>;
    errors: Record<string, string>;
    settings: CanvasStoryboardAssetGenerationSettings;
    progress: number;
    errorMessage?: string;
    startedAt?: string;
    completedAt?: string;
}

export interface CanvasStoryboardAsset {
    id: string;
    kind: CanvasStoryboardAssetKind;
    name: string;
    description: string;
    image?: CanvasStoryboardAssetImage;
}

export interface CanvasStoryboardShot {
    id: string;
    shotNumber: number;
    durationSeconds: number;
    visualDescription: string;
    shotSize: CanvasStoryboardShotSize;
    lightingAtmosphere: string;
    dialogueVoiceover: string;
    soundEffect: string;
    cameraMovement: string;
    finalPrompt: string;
    assetIds: string[];
}

export interface CanvasStoryboardNode extends CanvasNodeBase<"storyboard"> {
    content: {
        instruction: string;
        visualStyle: string;
        model: string;
    };
    storyboard: {
        shots: CanvasStoryboardShot[];
        assets: CanvasStoryboardAsset[];
        assetGeneration?: CanvasStoryboardAssetGenerationState;
    };
}

export interface CanvasVideoNode extends CanvasNodeBase<"video"> {
    content: CanvasVideoContent;
    generation: CanvasVideoGenerationSettings;
}

/** 视频合成节点的持久化数据。 */
export interface CanvasVideoCompositionData {
    /** 按最终合成顺序排列的直接输入视频节点ID。 */
    inputVideoNodeIds: string[];
    /** 最近一次合成创建的结果视频节点ID。 */
    resultVideoNodeId?: string;
}

/** 画布视频合成节点。 */
export interface CanvasVideoCompositionNode extends CanvasNodeBase<"videoComposition"> {
    /** 视频合成业务数据。 */
    composition: CanvasVideoCompositionData;
}

export type CanvasNode = CanvasImageNode | CanvasTextNode | CanvasVideoNode | CanvasStoryboardNode | CanvasVideoCompositionNode;

export interface CanvasConnectionEndpoint {
    nodeId: string;
    portId?: string | null;
}

export interface CanvasScene {
    nodes: CanvasNode[];
    connections: CanvasConnection[];
    viewport: CanvasViewport;
}

export interface CanvasDocumentIdentity {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
}

export interface CanvasConversation {
    sessions: CanvasAssistantSession[];
    activeSessionId: string | null;
}

export interface CanvasPreferences {
    background: CanvasBackgroundMode;
    showImageInformation: boolean;
}

export interface CanvasDocument {
    identity: CanvasDocumentIdentity;
    scene: CanvasScene;
    conversation: CanvasConversation;
    preferences: CanvasPreferences;
}
