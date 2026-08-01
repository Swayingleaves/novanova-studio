import type { ObjectStorageFile } from "@/shared/types/object-storage";
import type { CanvasBackgroundMode } from "@/shared/lib/canvas-theme";

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

export type CanvasNodeKind = "image" | "text" | "video";

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
    watermark: string;
    count: number;
    references: string[];
    referenceObjectStorages: ObjectStorageFile[];
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

export interface CanvasVideoNode extends CanvasNodeBase<"video"> {
    content: CanvasVideoContent;
    generation: CanvasVideoGenerationSettings;
}

export type CanvasNode = CanvasImageNode | CanvasTextNode | CanvasVideoNode;

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
