import { type CanvasExecutionState, type CanvasImageNode, type CanvasNodeFrame, type CanvasNodeKind, type CanvasPoint, type CanvasStoryboardNode, type CanvasTextNode, type CanvasVideoCompositionNode, type CanvasVideoNode } from "./types.ts";

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

const STORYBOARD_NODE_TEMPLATE: CanvasNodeTemplate = {
    title: "分镜脚本",
    width: 600,
    height: 600,
};

const CANVAS_NODE_TEMPLATES: Record<CanvasNodeKind, CanvasNodeTemplate> = {
    image: IMAGE_NODE_TEMPLATE,
    text: TEXT_NODE_TEMPLATE,
    video: VIDEO_NODE_TEMPLATE,
    storyboard: STORYBOARD_NODE_TEMPLATE,
    videoComposition: VIDEO_COMPOSITION_NODE_TEMPLATE,
};

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
