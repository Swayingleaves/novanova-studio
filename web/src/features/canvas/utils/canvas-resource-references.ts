import { imageReferenceLabel } from "@/features/generation/lib/image-reference-prompt";
import { seedanceReferenceLabel } from "@/features/generation/lib/seedance-video";
import type { CanvasConnection, CanvasNode } from "../types";
import { isAudioNode, isImageNode, isTextNode, isVideoCompositionNode, isVideoNode } from "../domain/canvas-node";

export type CanvasResourceKind = "image" | "video" | "text" | "audio";

export type CanvasResourceReference = {
    id: string;
    nodeId: string;
    kind: CanvasResourceKind;
    label: string;
    title: string;
    durationMs?: number;
    previewUrl?: string;
    text?: string;
    active: boolean;
};

type GraphIndex = {
    nodeById: Map<string, CanvasNode>;
    parentNodesById: Map<string, CanvasNode[]>;
    childNodesById: Map<string, CanvasNode[]>;
};

export function buildCanvasResourceReferences(nodes: CanvasNode[], connections: CanvasConnection[], contextNodeId?: string | null): CanvasResourceReference[] {
    if (!contextNodeId) return mapReferences(nodes);

    // 已引用资产按连线解析顺序置于候选列表前部，保证与参考内容区域的编号顺序一致。
    const referencedNodes = getMentionResourceNodes(contextNodeId, nodes, connections);
    const referencedIds = new Set(referencedNodes.map((node) => node.id));
    const orderedNodes = [...referencedNodes, ...nodes.filter((node) => !referencedIds.has(node.id))];
    return mapReferences(orderedNodes, (node) => referencedIds.has(node.id));
}

export function buildNodeMentionReferences(node: CanvasNode, nodes: CanvasNode[], connections: CanvasConnection[]): CanvasResourceReference[] {
    return mapReferences(getMentionResourceNodes(node.id, nodes, connections), true);
}

export function buildNodeGenerationReferences(node: CanvasNode): CanvasResourceReference[] {
    if (!isImageNode(node) && !isVideoNode(node)) return [];

    const countByKind: Record<"image" | "video", number> = { image: 0, video: 0 };
    const persistedReferences: Array<{ reference: string; objectStorage?: { url: string; key: string; mimeType: string }; forcedKind?: "video" }> = [
        ...node.generation.references.map((reference) => ({ reference, objectStorage: findObjectStorage(node.generation.referenceObjectStorages, reference) })),
        ...(isVideoNode(node) ? (node.generation.videoReferences || []).map((reference) => ({ reference, objectStorage: findObjectStorage(node.generation.videoReferenceObjectStorages || [], reference), forcedKind: "video" as const })) : []),
    ];
    const mediaReferences: CanvasResourceReference[] = persistedReferences.flatMap(({ reference, objectStorage, forcedKind }, index) => {
        const previewUrl = objectStorage?.url || (reference.startsWith("http") || reference.startsWith("data:") ? reference : "");
        if (!previewUrl) return [];

        const kind = forcedKind || objectStorage?.mimeType.startsWith("video/") || /^(?:video:|.*\.(mp4|webm|mov|m4v)(?:[?#]|$))/i.test(reference) ? "video" : "image";
        countByKind[kind] += 1;
        const label = kind === "image" ? `参考图${countByKind.image}` : `参考视频${countByKind.video}`;
        return [
            {
                id: `${node.id}-generation-reference-${index}`,
                nodeId: `${node.id}-generation-reference-${index}`,
                kind,
                label,
                title: label,
                previewUrl,
                active: true,
            },
        ];
    });
    return [...mediaReferences, ...(isVideoNode(node) ? (node.generation.audioReferences || []).map((audio, index) => ({ id: audio.id, nodeId: `${node.id}-audio-reference-${index}`, kind: "audio" as const, label: `音频${index + 1}`, title: audio.name, previewUrl: audio.url, durationMs: audio.durationMs, active: true })) : [])];
}

function findObjectStorage(files: Array<{ url: string; key: string; mimeType: string }>, reference: string) {
    const key = reference.replace(/^(?:image|video):/, "");
    return files.find((file) => file.url === reference || file.key === key);
}

export function getMentionResourceNodes(nodeId: string, nodes: CanvasNode[], connections: CanvasConnection[]): CanvasNode[] {
    return resolveContextResourceNodes(nodeId, buildGraphIndex(nodes, connections), true);
}

export function getGenerationResourceNodes(nodeId: string, nodes: CanvasNode[], connections: CanvasConnection[]): CanvasNode[] {
    return resolveContextResourceNodes(nodeId, buildGraphIndex(nodes, connections), false);
}

export function labelForKind(kind: CanvasResourceKind, index: number) {
    if (kind === "audio") return `音频${index + 1}`;
    if (kind === "image") return imageReferenceLabel(index);
    if (kind === "video") return seedanceReferenceLabel("video", index);
    return `文本${index + 1}`;
}

function resolveContextResourceNodes(nodeId: string, graph: GraphIndex, includeSelf: boolean): CanvasNode[] {
    const directResources = readDirectResourceInputs(nodeId, graph);
    if (directResources.length) return directResources;

    const currentNode = graph.nodeById.get(nodeId);
    return includeSelf && currentNode && resolveResourceKind(currentNode) ? [currentNode] : [];
}

function readDirectResourceInputs(nodeId: string, graph: GraphIndex): CanvasNode[] {
    const resources = (graph.parentNodesById.get(nodeId) || []).flatMap((node) => {
        if (isVideoCompositionNode(node)) {
            return node.composition.inputVideoNodeIds
                .map((inputNodeId) => graph.nodeById.get(inputNodeId))
                .filter((inputNode): inputNode is CanvasNode => Boolean(inputNode && resolveResourceKind(inputNode)));
        }
        return resolveResourceKind(node) ? [node] : [];
    });
    return uniqueNodes(resources);
}

function mapReferences(nodes: CanvasNode[], active: boolean | ((node: CanvasNode) => boolean) = false): CanvasResourceReference[] {
    const countByKind: Record<CanvasResourceKind, number> = { image: 0, video: 0, text: 0, audio: 0 };
    const references: CanvasResourceReference[] = [];
    const audioKeys = new Set<string>();

    uniqueNodes(nodes).forEach((node) => {
        const kind = resolveResourceKind(node);
        if (!kind) return;
        if (isAudioNode(node)) {
            const keys = [node.content.storageKey, node.content.source].filter((key): key is string => Boolean(key));
            if (keys.some((key) => audioKeys.has(key))) return;
            keys.forEach((key) => audioKeys.add(key));
        }

        const label = labelForKind(kind, countByKind[kind]);
        countByKind[kind] += 1;
        references.push({
            id: node.id,
            nodeId: node.id,
            kind,
            label,
            title: node.title || label,
            previewUrl: readPreviewUrl(node),
            durationMs: isAudioNode(node) ? node.content.durationMilliseconds : undefined,
            text: kind === "text" ? readTextContent(node) : undefined,
            active: typeof active === "function" ? active(node) : active,
        });
    });

    return references;
}

function buildGraphIndex(nodes: CanvasNode[], connections: CanvasConnection[]): GraphIndex {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const parentNodesById = new Map<string, CanvasNode[]>();
    const childNodesById = new Map<string, CanvasNode[]>();

    for (const connection of connections) {
        const sourceNode = nodeById.get(connection.source.nodeId);
        const targetNode = nodeById.get(connection.target.nodeId);
        if (!sourceNode || !targetNode) continue;
        appendLinkedNode(parentNodesById, targetNode.id, sourceNode);
        appendLinkedNode(childNodesById, sourceNode.id, targetNode);
    }

    return { nodeById, parentNodesById, childNodesById };
}

function appendLinkedNode(targetMap: Map<string, CanvasNode[]>, key: string, node: CanvasNode): void {
    const linkedNodes = targetMap.get(key);
    if (linkedNodes) linkedNodes.push(node);
    else targetMap.set(key, [node]);
}

function resolveResourceKind(node: CanvasNode): CanvasResourceKind | null {
    if (isAudioNode(node) && node.content.source) return "audio";
    if (isImageNode(node) && node.content.source) return "image";
    if (isVideoNode(node) && node.content.source) return "video";
    if (isTextNode(node) && readTextContent(node)) return "text";
    return null;
}

function readPreviewUrl(node: CanvasNode): string | undefined {
    return isAudioNode(node) || isImageNode(node) || isVideoNode(node) ? node.content.source : undefined;
}

function readTextContent(node: CanvasNode): string {
    if (isTextNode(node)) return node.content.text.trim();
    return isImageNode(node) || isVideoNode(node) ? node.generation.prompt.trim() : "";
}

function uniqueNodes(nodes: CanvasNode[]): CanvasNode[] {
    const seen = new Set<string>();
    return nodes.filter((node) => {
        if (seen.has(node.id)) return false;
        seen.add(node.id);
        return true;
    });
}
