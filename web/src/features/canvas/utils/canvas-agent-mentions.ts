import { translateMessage as translate } from "@/features/locale/translate";

import { isImageNode, isVideoNode } from "../domain/canvas-node";
import type { CanvasNode, CanvasNodeKind } from "../types";

/** 画布 Agent 输入框 @ 引用候选项。 */
export type CanvasAgentMentionCandidate = {
    /** 节点标识，插入输入框后作为引用标记。 */
    id: string;
    kind: CanvasNodeKind;
    /** 节点类型显示文案。 */
    kindLabel: string;
    /** 节点名称，空标题时回退为类型文案。 */
    title: string;
    /** 图片或视频节点缩略图地址。 */
    previewUrl?: string;
};

/** 读取节点在 @ 菜单和引用芯片中显示的名称。 */
function mentionTitle(node: CanvasNode, kindLabel: string) {
    return node.title.trim() || kindLabel;
}

/** 读取节点类型显示文案。 */
function mentionKindLabel(kind: CanvasNodeKind) {
    switch (kind) {
        case "image":
            return translate("canvas.image");
        case "video":
            return translate("canvas.video");
        case "audio":
            return translate("canvas.audio");
        case "storyboard":
            return translate("canvas.storyboard");
        case "videoComposition":
            return translate("canvas.videoComposition");
        case "directorDesk":
            return translate("canvas.3DDirectorDesk");
        case "background":
            return translate("canvas.background");
        default:
            return translate("canvas.text_dd8186");
    }
}

/** 图片和视频节点在读引用菜单中展示缩略图。 */
function mentionPreviewUrl(node: CanvasNode) {
    return isImageNode(node) || isVideoNode(node) ? node.content.source || undefined : undefined;
}
/** 构建画布 Agent 输入框的 @ 引用候选项，保持画布节点顺序。 */
export function buildCanvasAgentMentionCandidates(nodes: CanvasNode[]): CanvasAgentMentionCandidate[] {
    return nodes.map((node) => {
        const kindLabel = mentionKindLabel(node.kind);
        return { id: node.id, kind: node.kind, kindLabel, title: mentionTitle(node, kindLabel), previewUrl: mentionPreviewUrl(node) };
    });
}

/** 判断光标前是否正在输入 @ 引用命令；完整引用标记后返回空，避免重复弹出菜单。 */
export function readCanvasAgentMentionCommand(value: string, cursor: number, candidateIds: ReadonlySet<string>) {
    const match = value.slice(0, cursor).match(/@([^@\s]*)$/);
    if (!match || candidateIds.has(match[1])) return null;
    return { start: cursor - match[0].length, end: cursor, query: match[1] };
}

/** 按节点名称和类型过滤 @ 候选节点。 */
export function filterCanvasAgentMentionCandidates(candidates: CanvasAgentMentionCandidate[], query: string) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return candidates;
    return candidates.filter((candidate) => `${candidate.title} ${candidate.kindLabel}`.toLowerCase().includes(normalized));
}

/** 用节点引用标记匹配 JavaScript 正则。 */
function mentionPattern(nodes: CanvasNode[]) {
    const ids = [...new Set(nodes.map((node) => node.id))].filter(Boolean).sort((first, second) => second.length - first.length);
    if (!ids.length) return null;
    return new RegExp(`@(${ids.map(escapeRegExp).join("|")})`, "g");
}

/** 替换输入框中的节点引用标记，保留未识别的 @ 文本。 */
function replaceCanvasAgentMentions(value: string, nodes: CanvasNode[], replace: (node: CanvasNode) => string) {
    const pattern = mentionPattern(nodes);
    if (!pattern) return value;
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    return value.replace(pattern, (_mark, id: string) => {
        const node = nodeById.get(id);
        return node ? replace(node) : _mark;
    });
}

/** 将输入框内的节点引用标记转换为用户可读的 @ 名称。 */
export function formatCanvasAgentMentionDisplayText(value: string, nodes: CanvasNode[]) {
    return replaceCanvasAgentMentions(value, nodes, (node) => `@${mentionTitle(node, mentionKindLabel(node.kind))}`);
}

/** 将输入框内的节点引用标记转换为带真实节点 ID 的 Agent 消息。 */
export function buildCanvasAgentMentionMessage(value: string, nodes: CanvasNode[]) {
    return replaceCanvasAgentMentions(value, nodes, (node) => `@${mentionTitle(node, mentionKindLabel(node.kind))}（节点ID：${node.id}）`);
}

/** 读取输入框中已引用的节点标识，保持首次出现顺序并去重。 */
export function readCanvasAgentMentionNodeIds(value: string, nodes: CanvasNode[]) {
    const pattern = mentionPattern(nodes);
    if (!pattern) return [];
    const nodeIds = new Set(nodes.map((node) => node.id));
    return [...new Set(Array.from(value.matchAll(pattern), (match) => match[1]))].filter((id) => nodeIds.has(id));
}

/** 转义正则表达式字面量。 */
function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
