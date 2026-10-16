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

export type CanvasSettingGraphSkillSnapshot = {
    id: number;
    name: string;
    targetType: "canvasSettingGraph";
    systemPrompt: string;
    /** 技能默认生成比例；历史节点缺失时按16:9处理。 */
    aspectRatio?: string;
};

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
    nodeKind: CanvasNodeKind;
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

export type CanvasNodeKind = "image" | "text" | "video" | "audio" | "storyboard" | "videoComposition" | "directorDesk" | "background";

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
    directorDeskSource?: CanvasDirectorDeskExportSource;
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
    settingGraph?: CanvasSettingGraphSkillSnapshot;
}

export interface CanvasImageGrouping {
    isRoot: boolean;
    rootId?: string;
    childIds: string[];
    usesReferenceImages: boolean;
    primaryImageId?: string;
    expanded: boolean;
}

/** 音频节点保存真实波形采样，播放状态只保留在组件中。 */
export interface CanvasAudioNode extends CanvasNodeBase<"audio"> {
    content: CanvasVideoContent & {
        waveformPeaks: number[];
        /** 裁剪片段在原音频中的起始位置，未设置时从0开始。 */
        trimStartMilliseconds?: number;
        /** 裁剪片段在原音频中的结束位置，未设置时使用原始时长。 */
        trimEndMilliseconds?: number;
    };
}

export interface CanvasVideoContent {
    source: string;
    storageKey?: string;
    mimeType?: string;
    bytes?: number;
    durationMilliseconds?: number;
    objectStorage?: ObjectStorageFile;
    directorDeskSource?: CanvasDirectorDeskExportSource;
}

/** 导演台导出结果的可追溯来源信息。 */
export interface CanvasDirectorDeskExportSource {
    sourceCanvasDocumentId: string;
    sourceDirectorNodeId: string;
    sourceProjectRevision: number;
    sourceCameraId: string;
    sourceDurationMilliseconds?: number;
    sourceFrameRate?: number;
    sourceTimeMilliseconds?: number;
    sourceTaskId?: string;
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
    audioReferences?: import("@/features/generation/types/media").ReferenceAudio[];
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

/** 导演台支持的输出画幅。 */
export type CanvasDirectorDeskAspectRatio = "16:9" | "9:16" | "1:1";

/** 导演台三维向量，位置和缩放使用米制单位。 */
export interface CanvasDirectorDeskVector3 {
    x: number;
    y: number;
    z: number;
}

/** 导演台对象的基础变换。旋转单位为弧度。 */
export interface CanvasDirectorDeskTransform {
    position: CanvasDirectorDeskVector3;
    rotation: CanvasDirectorDeskVector3;
    scale: CanvasDirectorDeskVector3;
}

/** 导演台内置确定性动作预设。 */
export type CanvasDirectorDeskActionPreset = "idle" | "tPose" | "walk" | "run" | "sit" | "crouch" | "kneelSingle" | "kneelDouble" | "handsOnHips" | "lean" | "bow" | "think" | "fight" | "kick" | "throw" | "push" | "wave" | "reach" | "crossArms" | "phone";

/** 导演台人物动作片段，按绝对时间求值。 */
export interface CanvasDirectorDeskActionClip {
    id: string;
    preset: CanvasDirectorDeskActionPreset;
    startTimeMilliseconds: number;
    endTimeMilliseconds: number;
    /** 动作播放倍率，不改变路径的移动速度。 */
    speed?: number;
}

/** 人体可编辑关节，统一使用解剖学名称映射实际模型骨骼。 */
export type CanvasDirectorDeskJoint = "body" | "spine" | "neck" | "head" | "leftShoulder" | "rightShoulder" | "leftElbow" | "rightElbow" | "leftWrist" | "rightWrist" | "leftHip" | "rightHip" | "leftKnee" | "rightKnee" | "leftAnkle" | "rightAnkle";

/** 人偶姿势。工程中保存微调偏移，求值结果保存最终旋转，单位为弧度。 */
export interface CanvasDirectorDeskPose {
    joints: Record<CanvasDirectorDeskJoint, CanvasDirectorDeskVector3>;
    /** 身体重心相对对象原点的位移，单位为米。 */
    rootOffset: CanvasDirectorDeskVector3;
}

/** 绘制工具类型。 */
export type CanvasDirectorDeskPathKind = "circle" | "line" | "rectangle" | "pencil" | "pen";

/** 路径锚点及其绝对坐标贝塞尔切线手柄。 */
export interface CanvasDirectorDeskPathAnchor {
    position: CanvasDirectorDeskVector3;
    incoming?: CanvasDirectorDeskVector3;
    outgoing?: CanvasDirectorDeskVector3;
}

/** 对象与摄像机共用的运动路径片段，同一轨道的片段时间不得重叠。 */
export interface CanvasDirectorDeskMotionPath {
    id: string;
    kind: CanvasDirectorDeskPathKind;
    anchors: CanvasDirectorDeskPathAnchor[];
    closed: boolean;
    startTimeMilliseconds: number;
    endTimeMilliseconds: number;
    followDirection: boolean;
}

/** 导演台可恢复的基础场景对象与骨骼角色。 */
export type CanvasDirectorDeskObjectKind = "ground" | "cube" | "sphere" | "character" | "glb";

/** 导演台可恢复的外部资产类型。资产只保存稳定存储引用，不保存 Blob 或 Three.js 实例。 */
export type CanvasDirectorDeskAssetKind = "glb" | "image";

/** 导演台外部资产清单项。 */
export interface CanvasDirectorDeskAsset {
    id: string;
    name: string;
    kind: CanvasDirectorDeskAssetKind;
    storageKey: string;
    mimeType: string;
    bytes: number;
    objectStorage?: ObjectStorageFile;
}

/** 导演台背景图片引用。 */
export interface CanvasDirectorDeskBackground {
    assetId: string;
}

/** 导演台时间轨道关键帧。 */
export interface CanvasDirectorDeskKeyframe<Value> {
    id: string;
    timeMilliseconds: number;
    value: Value;
}

/** 导演台对象的运动轨道。 */
export interface CanvasDirectorDeskObjectTrack {
    position: CanvasDirectorDeskKeyframe<CanvasDirectorDeskVector3>[];
    rotation: CanvasDirectorDeskKeyframe<CanvasDirectorDeskVector3>[];
    actionClips?: CanvasDirectorDeskActionClip[];
    pose?: CanvasDirectorDeskKeyframe<CanvasDirectorDeskPose>[];
    motionPaths?: CanvasDirectorDeskMotionPath[];
}

/** 导演台场景对象。Three.js 运行时实例不写入该结构。 */
export interface CanvasDirectorDeskObject {
    id: string;
    name: string;
    kind: CanvasDirectorDeskObjectKind;
    transform: CanvasDirectorDeskTransform;
    visible: boolean;
    locked: boolean;
    assetId?: string;
    pose?: CanvasDirectorDeskPose;
    track?: CanvasDirectorDeskObjectTrack;
}

/** 导演台机位。位置、目标点和视场角均可按绝对时间求值。 */
export interface CanvasDirectorDeskCamera {
    id: string;
    name: string;
    position: CanvasDirectorDeskVector3;
    target: CanvasDirectorDeskVector3;
    fieldOfView: number;
    keyframes: Array<CanvasDirectorDeskKeyframe<Pick<CanvasDirectorDeskCamera, "position" | "target" | "fieldOfView">>>;
    motionPaths?: CanvasDirectorDeskMotionPath[];
    /** 持续对准对象的场景标识；未设置时使用原有目标点。 */
    targetObjectId?: string;
    /** 对准位置相对对象原点的世界坐标偏移。 */
    targetOffset?: CanvasDirectorDeskVector3;
}

/** 导演台工程时间轴。 */
export interface CanvasDirectorDeskTimeline {
    durationMilliseconds: number;
    frameRate: 30;
}

/** 导演台导出设置。 */
export interface CanvasDirectorDeskExportSettings {
    aspectRatio: CanvasDirectorDeskAspectRatio;
    width: number;
    height: number;
    frameRate: 30;
}

/** 导演台场景工程，保存为画布节点 JSON。 */
export interface CanvasDirectorDeskProject {
    schemaVersion: 1;
    objects: CanvasDirectorDeskObject[];
    assets: CanvasDirectorDeskAsset[];
    background?: CanvasDirectorDeskBackground;
    cameras: CanvasDirectorDeskCamera[];
    selectedCameraId: string;
    timeline: CanvasDirectorDeskTimeline;
}

/** 导演台节点的持久化数据。 */
export interface CanvasDirectorDeskData {
    schemaVersion: 1;
    projectRevision: number;
    project: CanvasDirectorDeskProject;
    cover?: {
        source: string;
        storageKey?: string;
        mimeType?: string;
        bytes?: number;
        objectStorage?: ObjectStorageFile;
    };
    exportSettings: CanvasDirectorDeskExportSettings;
}

/** 画布 3D 导演台节点。 */
export interface CanvasDirectorDeskNode extends CanvasNodeBase<"directorDesk"> {
    director: CanvasDirectorDeskData;
}

/** 画布背景板节点，使用绝对坐标包裹一组普通内容节点。 */
export interface CanvasBackgroundNode extends CanvasNodeBase<"background"> {
    /** 背景板填充颜色，使用主题预设颜色标识。 */
    backgroundColor: string;
    /** 背景板直接包含的普通节点标识。 */
    memberNodeIds: string[];
}

export type CanvasNode = CanvasAudioNode | CanvasImageNode | CanvasTextNode | CanvasVideoNode | CanvasStoryboardNode | CanvasVideoCompositionNode | CanvasDirectorDeskNode | CanvasBackgroundNode;

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
