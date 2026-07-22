import { nanoid } from "nanoid";

import { getCanvasNodeTemplate } from "../constants";
import type { CanvasPoint } from "../types";
import type { CanvasAgentOp } from "./canvas-agent-ops";

export type CanvasAgentToolResult = {
    ok: boolean;
    message: string;
    data?: Record<string, unknown>;
};

export type CanvasAgentToolExecution = {
    ops: CanvasAgentOp[];
    result: CanvasAgentToolResult;
};

type CreateId = () => string;

/** 将 Agent 工具参数解析为画布操作和真实的执行结果语义。 */
export function resolveCanvasAgentTool(
    name: string,
    args: Record<string, unknown> | undefined,
    createId: CreateId = nanoid,
): CanvasAgentToolExecution | null {
    if (!args) return null;

    switch (name) {
        case "canvas_generate_text":
            return createGenerationExecution("text", args, true, createId);
        case "canvas_generate_image":
            return createGenerationExecution("image", args, true, createId);
        case "canvas_generate_video":
            return createGenerationExecution("video", args, true, createId);
        case "canvas_create_generation_flow": {
            const mode = readOptionalGenerationMode(args.mode);
            return mode ? createGenerationExecution(mode, args, args.autoRun === true, createId) : null;
        }
        case "canvas_run_generation":
            return createRunGenerationExecution(args);
        case "canvas_create_node":
            return successExecution(name, [{
                type: "add_node",
                nodeType: args.nodeType as CanvasAgentOp["nodeType"],
                title: args.title as string,
                x: args.x as number,
                y: args.y as number,
                width: args.width as number,
                height: args.height as number,
                attributes: readNodeAttributes(args),
            }]);
        case "canvas_create_text_node":
            return successExecution(name, [{
                type: "add_node",
                nodeType: "text",
                title: (args.title as string) || "文本",
                x: args.x as number,
                y: args.y as number,
                width: args.width as number,
                height: args.height as number,
                attributes: { content: args.text as string, status: "success" },
            }]);
        case "canvas_create_text_nodes":
            return successExecution(name, createTextNodeOps(args));
        case "canvas_create_image_prompt_flow":
            return successExecution(name, [{
                type: "add_node",
                nodeType: "text",
                title: "提示词",
                x: args.x as number,
                y: args.y as number,
                width: 300,
                attributes: { content: args.prompt as string, status: "success" },
            }]);
        case "canvas_update_node":
            return successExecution(name, [{ type: "update_node", id: args.id as string, patch: readNodePatch(args.patch), attributes: readNodeAttributes(args) }]);
        case "canvas_update_node_text":
            return successExecution(name, [{ type: "update_node", id: args.id as string, title: args.title as string, attributes: { content: args.text as string, status: "success" } }]);
        case "canvas_move_nodes":
            return successExecution(name, createMoveNodeOps(args));
        case "canvas_resize_node":
            return successExecution(name, [{ type: "update_node", id: args.id as string, patch: { width: args.width as number, height: args.height as number } }]);
        case "canvas_delete_nodes":
            return successExecution(name, [{ type: "delete_node", ids: args.ids as string[] }]);
        case "canvas_connect_nodes":
            return successExecution(name, createConnectionOps(args));
        case "canvas_select_nodes":
            return successExecution(name, [{ type: "select_nodes", ids: args.ids as string[] }]);
        case "canvas_set_viewport":
            return successExecution(name, [{ type: "set_viewport", viewport: args.viewport as CanvasAgentOp["viewport"] }]);
        case "canvas_apply_ops":
            return createApplyOpsExecution(normalizeAgentOps(args.ops));
        default:
            return null;
    }
}

/** 将缺少坐标的新增节点放到当前视口中心，并错开批量节点。 */
export function positionCanvasAgentAddNodeOps(ops: CanvasAgentOp[], canvasCenter: CanvasPoint): CanvasAgentOp[] {
    let fallbackIndex = 0;
    return ops.map((operation) => {
        if (operation.type !== "add_node" || operation.position) return operation;
        const kind = operation.nodeType || "text";
        const template = getCanvasNodeTemplate(kind);
        const offset = fallbackIndex * 36;
        fallbackIndex += 1;
        return {
            ...operation,
            x: typeof operation.x === "number" ? operation.x : canvasCenter.x - template.width / 2 + offset,
            y: typeof operation.y === "number" ? operation.y : canvasCenter.y - template.height / 2 + offset,
        };
    });
}

function createGenerationExecution(
    mode: "text" | "image" | "video",
    args: Record<string, unknown>,
    autoRun: boolean,
    createId: CreateId,
): CanvasAgentToolExecution {
    const prompt = readString(args.prompt);
    if (!prompt) return failureExecution("生成提示词不能为空");
    if (autoRun && mode === "image" && !readString(args.size)) {
        return failureExecution("图片尺寸不能为空，请先向用户确认尺寸");
    }
    const nodeId = `${mode}-${createId()}`;
    const addNode: CanvasAgentOp = {
        type: "add_node",
        id: nodeId,
        nodeType: mode,
        title: readString(args.title) || generationLabel(mode),
        x: readNumber(args.x),
        y: readNumber(args.y),
        attributes: generationAttributes(mode, args, prompt),
    };
    const ops = autoRun
        ? [addNode, { type: "run_generation", nodeId, mode, prompt } satisfies CanvasAgentOp]
        : [addNode];
    return {
        ops,
        result: {
            ok: true,
            message: autoRun ? `${generationLabel(mode)}节点已创建，生成任务已开始` : `${generationLabel(mode)}节点已创建`,
            data: { nodeId, status: autoRun ? "running" : "idle" },
        },
    };
}

function createRunGenerationExecution(args: Record<string, unknown>): CanvasAgentToolExecution | null {
    const nodeId = readString(args.nodeId);
    if (!nodeId) return failureExecution("生成节点ID不能为空");
    const mode = readOptionalGenerationMode(args.mode);
    return {
        ops: [{ type: "run_generation", nodeId, mode, prompt: readString(args.prompt) }],
        result: {
            ok: true,
            message: "画布节点生成任务已开始",
            data: { nodeId, status: "running" },
        },
    };
}

function createApplyOpsExecution(ops: CanvasAgentOp[]): CanvasAgentToolExecution {
    const runningNodeIds = ops.filter((op) => op.type === "run_generation" && op.nodeId).map((op) => op.nodeId as string);
    if (!runningNodeIds.length) return successExecution("canvas_apply_ops", ops);
    return {
        ops,
        result: {
            ok: true,
            message: "画布操作已应用，生成任务已开始",
            data: { nodeIds: runningNodeIds, status: "running" },
        },
    };
}

function successExecution(name: string, ops: CanvasAgentOp[]): CanvasAgentToolExecution {
    return { ops, result: { ok: true, message: `工具 ${name} 执行成功` } };
}

function failureExecution(message: string): CanvasAgentToolExecution {
    return { ops: [], result: { ok: false, message } };
}

function generationAttributes(mode: "text" | "image" | "video", args: Record<string, unknown>, prompt: string): CanvasAgentOp["attributes"] {
    if (mode === "text") return { content: prompt, status: "idle" };
    if (mode === "video") {
        return {
            prompt,
            status: "idle",
            seconds: readString(args.seconds) || undefined,
            vquality: readString(args.vquality) || undefined,
        };
    }
    return {
        prompt,
        status: "idle",
        size: readString(args.size) || undefined,
        quality: readString(args.quality) || undefined,
        count: readPositiveInteger(args.count),
    };
}

function createTextNodeOps(args: Record<string, unknown>): CanvasAgentOp[] {
    const items = Array.isArray(args.items) ? args.items as Array<Record<string, unknown>> : [];
    const startX = readNumber(args.x);
    const startY = readNumber(args.y);
    const gap = readNumber(args.gap) ?? 36;
    return items.map((item, index) => ({
        type: "add_node",
        nodeType: "text",
        title: readString(item.title) || `文本${index + 1}`,
        x: startX === undefined ? undefined : startX + (args.direction === "column" ? 0 : index * gap),
        y: startY === undefined ? undefined : startY + (args.direction === "column" ? index * gap : 0),
        attributes: { content: readString(item.text), status: "success" },
    }));
}

function createMoveNodeOps(args: Record<string, unknown>): CanvasAgentOp[] {
    const items = Array.isArray(args.items) ? args.items as Array<Record<string, unknown>> : [];
    return items.map((item) => {
        const position: { x?: number; y?: number } = {};
        const x = readNumber(item.x);
        const y = readNumber(item.y);
        if (x !== undefined) position.x = x;
        if (y !== undefined) position.y = y;
        return { type: "update_node", id: readString(item.id), patch: { position } } as CanvasAgentOp;
    });
}

function createConnectionOps(args: Record<string, unknown>): CanvasAgentOp[] {
    const connections = Array.isArray(args.connections) ? args.connections as Array<Record<string, unknown>> : [];
    return connections.map((connection) => ({
        type: "connect_nodes",
        sourceNodeId: readString(connection.sourceNodeId ?? connection.fromNodeId),
        targetNodeId: readString(connection.targetNodeId ?? connection.toNodeId),
    }));
}

function readNodeAttributes(args: Record<string, unknown>) {
    const patch = args.patch && typeof args.patch === "object" ? args.patch as Record<string, unknown> : undefined;
    return (args.attributes || args.metadata || patch?.attributes) as CanvasAgentOp["attributes"];
}

function readNodePatch(value: unknown): CanvasAgentOp["patch"] {
    if (!value || typeof value !== "object") return undefined;
    const patch = value as Record<string, unknown>;
    return {
        title: patch.title as string | undefined,
        position: patch.position as { x: number; y: number } | undefined,
        width: patch.width as number | undefined,
        height: patch.height as number | undefined,
    };
}

function normalizeAgentOps(value: unknown): CanvasAgentOp[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
        const raw = item as Record<string, unknown>;
        return {
            ...raw,
            patch: readNodePatch(raw.patch),
            attributes: raw.attributes || (raw.patch as Record<string, unknown> | undefined)?.attributes,
        } as CanvasAgentOp;
    });
}

function readOptionalGenerationMode(value: unknown): "text" | "image" | "video" | undefined {
    return value === "text" || value === "image" || value === "video" ? value : undefined;
}

function generationLabel(mode: "text" | "image" | "video") {
    if (mode === "text") return "文本生成";
    if (mode === "video") return "视频生成";
    return "图片生成";
}

function readString(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readPositiveInteger(value: unknown) {
    const number = readNumber(value);
    return number === undefined ? undefined : Math.max(1, Math.floor(number));
}
