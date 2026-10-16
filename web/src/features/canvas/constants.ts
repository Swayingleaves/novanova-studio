import { type CanvasAudioNode, type CanvasBackgroundNode, type CanvasDirectorDeskAspectRatio, type CanvasDirectorDeskCamera, type CanvasDirectorDeskNode, type CanvasDirectorDeskObject, type CanvasDirectorDeskProject, type CanvasExecutionState, type CanvasImageNode, type CanvasNodeFrame, type CanvasNodeKind, type CanvasPoint, type CanvasStoryboardNode, type CanvasTextNode, type CanvasVideoCompositionNode, type CanvasVideoNode } from "./types.ts";

export interface CreateCanvasNodeInput {
    id: string;
    title?: string;
    position: CanvasPoint;
}

export interface CanvasNodeTemplate {
    title: string;
    width: number;
    height: number;
}

export const CANVAS_CONNECTION_HANDLE_SIZE = 16;

const IMAGE_NODE_TEMPLATE: CanvasNodeTemplate = {
    title: "图像",
    width: 510,
    height: 360,
};

const TEXT_NODE_TEMPLATE: CanvasNodeTemplate = {
    title: "文本",
    width: 600,
    height: 600,
};

const VIDEO_NODE_TEMPLATE: CanvasNodeTemplate = {
    title: "视频",
    width: 630,
    height: 354,
};

const VIDEO_COMPOSITION_NODE_TEMPLATE: CanvasNodeTemplate = {
    title: "合成视频",
    width: 440,
    height: 380,
};

const DIRECTOR_DESK_NODE_TEMPLATE: CanvasNodeTemplate = {
    title: "3D 导演台",
    width: 520,
    height: 360,
};

const STORYBOARD_NODE_TEMPLATE: CanvasNodeTemplate = {
    title: "分镜脚本",
    width: 600,
    height: 600,
};

const BACKGROUND_NODE_TEMPLATE: CanvasNodeTemplate = {
    title: "背景板",
    width: 960,
    height: 640,
};

const CANVAS_NODE_TEMPLATES: Record<CanvasNodeKind, CanvasNodeTemplate> = {
    audio: { title: "音频", width: 480, height: 200 },
    image: IMAGE_NODE_TEMPLATE,
    text: TEXT_NODE_TEMPLATE,
    video: VIDEO_NODE_TEMPLATE,
    storyboard: STORYBOARD_NODE_TEMPLATE,
    videoComposition: VIDEO_COMPOSITION_NODE_TEMPLATE,
    directorDesk: DIRECTOR_DESK_NODE_TEMPLATE,
    background: BACKGROUND_NODE_TEMPLATE,
};

export const CANVAS_BACKGROUND_MIN_WIDTH = 320;
export const CANVAS_BACKGROUND_MIN_HEIGHT = 220;
export const CANVAS_BACKGROUND_PADDING = 32;
export const CANVAS_BACKGROUND_DEFAULT_COLOR = "var(--studio-surface-raised)";

/** 创建空音频节点。 */
export function createAudioNode(input: CreateCanvasNodeInput): CanvasAudioNode {
    return { id: input.id, kind: "audio", title: input.title?.trim() || "音频", frame: createNodeFrame(CANVAS_NODE_TEMPLATES.audio, input.position), execution: createIdleExecution(), content: { source: "", waveformPeaks: [] } };
}

export function createImageNode(input: CreateCanvasNodeInput): CanvasImageNode {
    return {
        id: input.id,
        kind: "image",
        title: input.title?.trim() || IMAGE_NODE_TEMPLATE.title,
        frame: createNodeFrame(IMAGE_NODE_TEMPLATE, input.position),
        execution: createIdleExecution(),
        content: {
            source: "",
        },
        generation: {
            operation: "generation",
            prompt: "",
            model: "",
            size: "",
            quality: "",
            resolution: "",
            count: 1,
            references: [],
            referenceObjectStorages: [],
            generationStyleIds: [],
            generationStyleSnapshots: [],
        },
        grouping: {
            isRoot: false,
            childIds: [],
            usesReferenceImages: false,
            expanded: false,
        },
    };
}

export function createTextNode(input: CreateCanvasNodeInput & { text?: string }): CanvasTextNode {
    return {
        id: input.id,
        kind: "text",
        title: input.title?.trim() || TEXT_NODE_TEMPLATE.title,
        frame: createNodeFrame(TEXT_NODE_TEMPLATE, input.position),
        execution: createIdleExecution(),
        content: {
            text: input.text || "",
            fontSize: 14,
        },
    };
}

export function createStoryboardNode(input: CreateCanvasNodeInput): CanvasStoryboardNode {
    return {
        id: input.id,
        kind: "storyboard",
        title: input.title?.trim() || STORYBOARD_NODE_TEMPLATE.title,
        frame: createNodeFrame(STORYBOARD_NODE_TEMPLATE, input.position),
        execution: createIdleExecution(),
        content: {
            instruction: "",
            visualStyle: "",
            model: "",
        },
        storyboard: {
            shots: [],
            assets: [],
        },
    };
}

export function createVideoNode(input: CreateCanvasNodeInput): CanvasVideoNode {
    return {
        id: input.id,
        kind: "video",
        title: input.title?.trim() || VIDEO_NODE_TEMPLATE.title,
        frame: createNodeFrame(VIDEO_NODE_TEMPLATE, input.position),
        execution: createIdleExecution(),
        content: {
            source: "",
        },
        generation: {
            prompt: "",
            model: "",
            size: "",
            seconds: "",
            quality: "",
            videoGenerationMode: "text-to-video",
            watermark: "",
            count: 1,
            references: [],
            referenceObjectStorages: [],
            videoReferences: [],
            videoReferenceObjectStorages: [],
            generationStyleIds: [],
            generationStyleSnapshots: [],
        },
    };
}

export function createVideoCompositionNode(input: CreateCanvasNodeInput): CanvasVideoCompositionNode {
    return {
        id: input.id,
        kind: "videoComposition",
        title: input.title?.trim() || VIDEO_COMPOSITION_NODE_TEMPLATE.title,
        frame: createNodeFrame(VIDEO_COMPOSITION_NODE_TEMPLATE, input.position),
        execution: createIdleExecution(),
        composition: {
            inputVideoNodeIds: [],
        },
    };
}

/** 创建带默认机位和基础地面的导演台节点。 */
export function createDirectorDeskNode(input: CreateCanvasNodeInput): CanvasDirectorDeskNode {
    const camera: CanvasDirectorDeskCamera = {
        id: "camera-main",
        name: "主机位",
        position: { x: 4, y: 3, z: 6 },
        target: { x: 0, y: 1, z: 0 },
        fieldOfView: 42,
        keyframes: [],
    };
    const objects: CanvasDirectorDeskObject[] = [
        {
            id: "ground-main",
            name: "地面",
            kind: "ground",
            transform: {
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 6, y: 1, z: 6 },
            },
            visible: true,
            locked: true,
        },
        {
            id: "character-main",
            name: "角色 A",
            kind: "character",
            transform: {
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 },
            },
            visible: true,
            locked: false,
            track: { position: [], rotation: [], actionClips: [] },
        },
    ];
    const project: CanvasDirectorDeskProject = {
        schemaVersion: 1,
        objects,
        assets: [],
        cameras: [camera],
        selectedCameraId: camera.id,
        timeline: { durationMilliseconds: 5000, frameRate: 30 },
    };
    const aspectRatio: CanvasDirectorDeskAspectRatio = "16:9";
    return {
        id: input.id,
        kind: "directorDesk",
        title: input.title?.trim() || DIRECTOR_DESK_NODE_TEMPLATE.title,
        frame: createNodeFrame(DIRECTOR_DESK_NODE_TEMPLATE, input.position),
        execution: createIdleExecution(),
        director: {
            schemaVersion: 1,
            projectRevision: 1,
            project,
            exportSettings: { aspectRatio, width: 1280, height: 720, frameRate: 30 },
        },
    };
}

/** 创建背景板节点。 */
export function createBackgroundNode(input: CreateCanvasNodeInput & { backgroundColor?: string; memberNodeIds?: string[] }): CanvasBackgroundNode {
    return {
        id: input.id,
        kind: "background",
        title: input.title?.trim() || BACKGROUND_NODE_TEMPLATE.title,
        frame: createNodeFrame(BACKGROUND_NODE_TEMPLATE, input.position),
        execution: createIdleExecution(),
        backgroundColor: input.backgroundColor || CANVAS_BACKGROUND_DEFAULT_COLOR,
        memberNodeIds: [...(input.memberNodeIds || [])],
    };
}

export function getCanvasNodeTemplate(kind: CanvasNodeKind): CanvasNodeTemplate {
    return CANVAS_NODE_TEMPLATES[kind];
}

function createIdleExecution(): CanvasExecutionState {
    return { phase: "idle" };
}

function createNodeFrame(template: CanvasNodeTemplate, position: CanvasPoint): CanvasNodeFrame {
    return {
        position: { ...position },
        width: template.width,
        height: template.height,
    };
}
