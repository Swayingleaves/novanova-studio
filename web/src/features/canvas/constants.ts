import {
    type CanvasExecutionState,
    type CanvasImageNode,
    type CanvasNodeFrame,
    type CanvasNodeKind,
    type CanvasPoint,
    type CanvasTextNode,
    type CanvasVideoNode,
} from "./types.ts";

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
    width: 340,
    height: 240,
};

const TEXT_NODE_TEMPLATE: CanvasNodeTemplate = {
    title: "文本",
    width: 340,
    height: 240,
};

const VIDEO_NODE_TEMPLATE: CanvasNodeTemplate = {
    title: "视频",
    width: 420,
    height: 236,
};

const CANVAS_NODE_TEMPLATES: Record<CanvasNodeKind, CanvasNodeTemplate> = {
    image: IMAGE_NODE_TEMPLATE,
    text: TEXT_NODE_TEMPLATE,
    video: VIDEO_NODE_TEMPLATE,
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
            watermark: "",
            count: 1,
            references: [],
            referenceObjectStorages: [],
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
