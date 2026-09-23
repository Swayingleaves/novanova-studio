"use client";

import { useMemo, useState } from "react";
import { Button, Modal } from "antd";
import { Maximize2 } from "lucide-react";
import { Background, Controls, MarkerType, ReactFlow, type Edge, type Node, type NodeDragHandler } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { buildCharacterRelationshipData } from "../lib/character-relationship-data";
import { useScriptStore } from "../stores/use-script-store";

/** 人物关系图，节点位置与文字关系共用正式人物数据。 */
export function CharacterRelationshipGraph() {
    const project = useScriptStore((state) => state.project);
    const updateCharacters = useScriptStore((state) => state.updateCharacters);
    const [fullScreenOpen, setFullScreenOpen] = useState(false);
    const graphData = useMemo(() => buildCharacterRelationshipData(
        project?.characters || [], project?.characterRelations || [],
    ), [project?.characterRelations, project?.characters]);
    const nodes = useMemo<Node[]>(() => graphData.nodes.map((node) => ({
        id: node.id,
        position: node.position,
        data: { label: node.label },
        style: {
            border: "1px solid var(--studio-line-strong)",
            borderRadius: 10,
            color: "var(--studio-ink)",
            background: "var(--studio-panel-solid)",
            minWidth: 140,
        },
    })), [graphData.nodes]);
    const edges = useMemo<Edge[]>(() => graphData.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        markerEnd: edge.directed ? { type: MarkerType.ArrowClosed } : undefined,
        type: "smoothstep",
        style: { stroke: "var(--studio-primary)" },
        labelStyle: { fill: "var(--studio-ink)", fontSize: 12, fontWeight: 500 },
        labelBgStyle: { fill: "var(--studio-panel-solid)", stroke: "var(--studio-line-strong)", strokeWidth: 1 },
        labelBgPadding: [4, 6] as [number, number],
    })), [graphData.edges]);

    const handleNodeDragStop: NodeDragHandler = (_, node) => {
        if (!project) return;
        updateCharacters(project.characters.map((character) => character.id === node.id ? {
            ...character,
            graphPositionX: node.position.x,
            graphPositionY: node.position.y,
        } : character), project.characterRelations);
    };

    if (!project?.characters.length) return <div className="flex h-72 items-center justify-center text-sm text-[var(--studio-faint)]">添加人物后即可查看关系图</div>;
    return (
        <>
            <div className="relative h-80 overflow-hidden rounded-xl border border-[var(--studio-line)] bg-[var(--studio-surface-soft)]" aria-label="人物关系图">
                <Button className="absolute right-3 top-3 z-10" size="small" icon={<Maximize2 className="size-4" />} onClick={() => setFullScreenOpen(true)}>全屏查看</Button>
                <CharacterRelationshipCanvas nodes={nodes} edges={edges} onNodeDragStop={handleNodeDragStop} />
            </div>
            <Modal title="人物关系图" open={fullScreenOpen} footer={null} width="100vw" style={{ top: 0, maxWidth: "100vw", margin: 0, paddingBottom: 0 }} styles={{ body: { height: "calc(100vh - 56px)", padding: 0 } }} onCancel={() => setFullScreenOpen(false)} destroyOnHidden>
                <div className="h-full overflow-hidden bg-[var(--studio-surface-soft)]">
                    <CharacterRelationshipCanvas nodes={nodes} edges={edges} onNodeDragStop={handleNodeDragStop} />
                </div>
            </Modal>
        </>
    );
}

/** 渲染可在普通与全屏视图复用的人物关系画布。 */
function CharacterRelationshipCanvas({ nodes, edges, onNodeDragStop }: { nodes: Node[]; edges: Edge[]; onNodeDragStop: NodeDragHandler }) {
    return <ReactFlow nodes={nodes} edges={edges} fitView onNodeDragStop={onNodeDragStop} minZoom={0.4} maxZoom={1.6}>
        <Background color="var(--studio-line)" gap={20} />
        <Controls showInteractive={false} />
    </ReactFlow>;
}
