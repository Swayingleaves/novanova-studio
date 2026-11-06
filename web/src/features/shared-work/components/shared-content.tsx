"use client";
import { useMemo, useState } from "react";
import { Background, Controls, Handle, Position, ReactFlow, type Node, type NodeProps, type NodeTypes } from "@xyflow/react";
import { Image, Modal, Tag } from "antd";
import { canvasThemes } from "@/shared/lib/canvas-theme";
import { useThemeStore } from "@/features/theme/stores/use-theme-store";
import type { CanvasNode } from "@/features/canvas/types";
import type { SharedSnapshot } from "@/services/api/shared-work";
import "@xyflow/react/dist/style.css";

/** 只挂载展示组件，不连接画布编辑状态、运行器和自动保存器。 */
export function SharedContent({ snapshot }: { snapshot: SharedSnapshot }) {
    return <div className="space-y-4">
        {snapshot.kind === "canvas" && snapshot.scene ? <SharedCanvasViewer snapshot={snapshot} /> : snapshot.media ? <MediaContent kind={snapshot.kind} source={snapshot.media.source} /> : null}
        {snapshot.generation ? <section className="rounded-lg border border-[var(--studio-line)] p-4"><h3 className="mb-3 font-medium">作者公开的生成信息</h3><dl className="space-y-3">{Object.entries(snapshot.generation).map(([key, value]) => <div key={key}><dt className="text-xs text-[var(--studio-muted)]">{generationLabels[key] || key}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm">{String(value)}</dd></div>)}</dl></section> : null}
    </div>;
}

const generationLabels: Record<string, string> = { prompt: "提示词", generationPrompt: "实际生成提示词", modelName: "模型", quality: "质量", imageResolution: "分辨率", resolution: "分辨率", size: "尺寸", count: "数量", seconds: "时长（秒）", videoSeconds: "时长（秒）", vquality: "视频质量", videoWatermark: "水印", videoGenerationMode: "视频模式" };

function MediaContent({ kind, source, compact = false }: { kind: string; source?: string; compact?: boolean }) {
    if (!source) return <div className="p-5 text-sm text-[var(--studio-muted)]">暂无媒体</div>;
    const className = `${compact ? "max-h-72" : "max-h-[65dvh]"} w-full rounded-lg bg-[var(--studio-media)] object-contain`;
    if (kind === "image") return <Image src={source} alt="分享图片" className={className} styles={{ root: { width: "100%" }, image: { objectFit: "contain", maxHeight: compact ? 288 : "65dvh" } }} />;
    if (kind === "video") return <video src={source} controls playsInline preload="metadata" className={className} />;
    return <audio src={source} controls className="w-full" />;
}

type PublicFlowNode = Node<{ node: CanvasNode }, "shared">;
const publicNodeTypes: NodeTypes = { shared: SharedNode };

export function SharedCanvasViewer({ snapshot }: { snapshot: SharedSnapshot }) {
    const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
    const theme = canvasThemes[resolvedTheme];
    const [selected, setSelected] = useState<CanvasNode | null>(null);
    const nodes = useMemo<PublicFlowNode[]>(() => (snapshot.scene?.nodes || []).map((node) => ({
        id: node.id, type: "shared", position: node.frame.position, data: { node },
        style: { width: node.frame.width, height: node.frame.height, background: theme.node.fill, color: theme.node.text, border: `1px solid ${theme.node.stroke}`, borderRadius: 8 },
        draggable: false, selectable: false, connectable: false,
        zIndex: node.kind === "background" ? -1 : 0,
    })), [snapshot.scene, theme]);
    const edges = useMemo(() => (snapshot.scene?.connections || []).map((edge) => ({ id: edge.id, source: edge.source.nodeId, target: edge.target.nodeId, style: { stroke: theme.node.muted } })), [snapshot.scene, theme]);
    return <>
        <div className="h-[min(65dvh,640px)] min-h-80 overflow-hidden rounded-lg border border-[var(--studio-line)]" style={{ background: theme.canvas.background }} aria-label="只读画布">
            <ReactFlow nodes={nodes} edges={edges} nodeTypes={publicNodeTypes} fitView fitViewOptions={{ padding: 0.15 }} minZoom={0.05} maxZoom={3} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} edgesReconnectable={false} deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null} onNodeClick={(_, node) => setSelected(node.data.node)} colorMode={resolvedTheme === "dark" ? "dark" : "light"} proOptions={{ hideAttribution: true }}>
                <Background color={theme.canvas.dot} /><Controls showInteractive={false} />
            </ReactFlow>
        </div>
        <p className="text-xs text-[var(--studio-muted)]">拖动空白处平移，滚轮或双指缩放。点击节点查看完整内容和播放媒体。</p>
        <Modal title={selected?.title || "节点内容"} open={Boolean(selected)} onCancel={() => setSelected(null)} footer={null} width={760} destroyOnHidden>
            {selected ? <NodeContent node={selected} /> : null}
        </Modal>
    </>;
}

function SharedNode({ data }: NodeProps<PublicFlowNode>) {
    const node = data.node;
    return <div className="size-full overflow-hidden p-2" style={node.kind === "background" ? { background: node.backgroundColor } : undefined}>
        <Handle type="target" position={Position.Left} isConnectable={false} className="opacity-0" />
        <div className="truncate text-xs opacity-70">{node.title}</div>
        {node.kind === "image" ? <img src={node.content.source || undefined} alt={node.title} className="h-[calc(100%-20px)] w-full object-contain" draggable={false} /> : node.kind === "text" ? <p className="whitespace-pre-wrap break-words" style={{ fontSize: node.content.fontSize }}>{node.content.text}</p> : node.kind === "video" ? <video src={node.content.source} controls playsInline preload="metadata" className="nodrag nopan h-[calc(100%-20px)] w-full object-contain" /> : node.kind === "audio" ? <audio src={node.content.source} controls className="nodrag nopan mt-3 w-full" /> : <p className="mt-4 text-sm opacity-70">点击查看内容</p>}
        <Handle type="source" position={Position.Right} isConnectable={false} className="opacity-0" />
    </div>;
}

function NodeContent({ node }: { node: CanvasNode }) {
    if (node.kind === "text") return <p className="whitespace-pre-wrap break-words">{node.content.text}</p>;
    if (node.kind === "image" || node.kind === "video" || node.kind === "audio") return <div className="space-y-4">
        <MediaContent kind={node.kind} source={node.content.source} compact />
        {"generation" in node ? node.generation.generationStyleSnapshots.map((style) => <section key={style.id}><h4 className="font-medium">{style.name}</h4><p className="mt-2 whitespace-pre-wrap break-words">{style.stylePrompt}</p></section>) : null}
        {node.kind === "image" && node.generation.settingGraph ? <section><h4 className="font-medium">{node.generation.settingGraph.name}</h4><p className="mt-2 whitespace-pre-wrap break-words">{node.generation.settingGraph.systemPrompt}</p></section> : null}
        {"generation" in node ? <><h4 className="font-medium">提示词</h4><p className="whitespace-pre-wrap break-words">{node.generation.prompt || "未填写"}</p><div className="flex flex-wrap gap-2">{Object.entries(node.generation).filter(([key, value]) => ["quality", "imageResolution", "size", "count", "seconds"].includes(key) && (typeof value === "string" || typeof value === "number")).map(([key, value]) => <Tag key={key}>{generationLabels[key]}：{String(value)}</Tag>)}</div><div className="flex flex-wrap gap-2">{node.generation.references.map((source, index) => <Image key={index} src={source} alt={`参考素材 ${index + 1}`} width={100} height={100} style={{ objectFit: "contain" }} />)}</div>{node.kind === "video" ? <>{node.generation.videoReferences?.map((source, index) => <MediaContent key={index} kind="video" source={source} compact />)}{node.generation.audioReferences?.map((audio) => <MediaContent key={audio.id} kind="audio" source={audio.url} />)}</> : null}</> : null}
    </div>;
    if (node.kind === "storyboard") return <div className="space-y-4"><p className="whitespace-pre-wrap">{node.content.instruction}</p><p className="text-sm text-[var(--studio-muted)]">{node.content.visualStyle}</p>{node.storyboard.assets.map((asset) => <section key={asset.id}><h4 className="font-medium">{asset.name}</h4><p className="my-2 whitespace-pre-wrap">{asset.description}</p>{asset.image ? <MediaContent kind="image" source={asset.image.source} compact /> : null}</section>)}{node.storyboard.shots.map((shot, index) => <section key={shot.id} className="border-b border-[var(--studio-line)] pb-3"><Tag>分镜 {index + 1}</Tag><Tag>{shot.durationSeconds} 秒</Tag>{Object.entries(shot).filter(([key, value]) => key !== "id" && typeof value === "string").map(([key, value]) => <p key={key} className="mt-2 whitespace-pre-wrap">{String(value)}</p>)}</section>)}</div>;
    if (node.kind === "directorDesk") return <div className="space-y-3">{node.director.cover?.source ? <MediaContent kind="image" source={node.director.cover.source} compact /> : null}<p>导演台场景包含 {node.director.project.objects.length} 个对象</p>{node.director.project.objects.map((object) => <p key={object.id}>{object.name} · 位置（{object.transform.position.x}, {object.transform.position.y}, {object.transform.position.z}）</p>)}<p>机位：{node.director.project.cameras.map((camera) => camera.name).join("、")}</p>{node.director.project.assets.filter((asset) => asset.kind === "image").map((asset) => <MediaContent key={asset.id} kind="image" source={(asset as unknown as { source: string }).source} compact />)}</div>;
    if (node.kind === "videoComposition") return <p>视频合成 · {node.composition.inputVideoNodeIds.length} 个输入节点</p>;
    return <p>{node.title}</p>;
}
