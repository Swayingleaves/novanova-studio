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
    const nodes = useMemo<Node[]>(() => {
        const characters = new Map(project?.characters.map((character) => [character.id, character]) || []);
        return graphData.nodes.map((node) => {
            const character = characters.get(node.id);
            const name = character?.name || "未命名人物";
            return {
                id: node.id,
                position: node.position,
                ariaLabel: `人物 ${name}${character?.roleType ? `，${character.roleType}` : ""}`,
                data: { label: <div className="flex min-w-0 items-center gap-2.5 p-2 text-left">
                    <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[var(--studio-primary-soft)] text-sm font-semibold text-[var(--studio-primary)]" aria-hidden="true">{name.charAt(0)}</span>
                    <span className="min-w-0"><strong className="block truncate text-sm text-[var(--studio-ink)]">{name}</strong><span className="block truncate text-xs text-[var(--studio-muted)]">{character?.roleType || "未设置定位"}</span></span>
                </div> },
                style: {
                    border: "1px solid var(--studio-line-strong)", borderRadius: 8, padding: 0,
                    color: "var(--studio-ink)", background: "var(--studio-panel-solid)", width: 180,
                },
            };
        });
    }, [graphData.nodes, project?.characters]);
    const edges = useMemo<Edge[]>(() => {
        const relations = new Map(project?.characterRelations.map((relation) => [relation.id, relation]) || []);
        return graphData.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: relations.get(edge.id)?.relationshipType || "关系",
        markerEnd: edge.directed ? { type: MarkerType.ArrowClosed } : undefined,
        type: "smoothstep",
        style: { stroke: "var(--studio-primary)", strokeWidth: 1.5 },
        labelStyle: { fill: "var(--studio-ink)", fontSize: 12, fontWeight: 500 },
        labelBgStyle: { fill: "var(--studio-panel-solid)", stroke: "var(--studio-line-strong)", strokeWidth: 1 },
        labelBgPadding: [4, 6] as [number, number],
        }));
    }, [graphData.edges, project?.characterRelations]);

    const handleNodeDragStop: NodeDragHandler = (_, node) => {
        const latestProject = useScriptStore.getState().project;
        if (!latestProject || latestProject.id !== project?.id) return;
        updateCharacters(latestProject.characters.map((character) => character.id === node.id ? {
            ...character,
            graphPositionX: node.position.x,
            graphPositionY: node.position.y,
        } : character), latestProject.characterRelations);
    };

    if (!project?.characters.length) return <div className="flex h-72 items-center justify-center rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] text-sm text-[var(--studio-muted)]">添加人物后即可查看关系图</div>;
    return (
        <>
            <div className="relative h-[420px] overflow-hidden rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] sm:h-[520px]" aria-label="人物关系图">
                <div className="absolute left-3 top-3 z-10 max-w-[55%] rounded-md border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] px-2.5 py-1.5 text-xs text-[var(--studio-muted)]">{project.characters.length === 1 ? "再添加一位人物即可建立关系" : project.characterRelations.length === 0 ? "暂无人物关系，可在下方添加" : `${project.characters.length} 位人物 · ${project.characterRelations.length} 条关系`}</div>
                <Button className="absolute right-3 top-3 z-10 !h-11" icon={<Maximize2 className="size-4" />} onClick={() => setFullScreenOpen(true)}>全屏查看</Button>
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
    return <ReactFlow nodes={nodes} edges={edges} fitView fitViewOptions={{ padding: 0.25 }} onNodeDragStop={onNodeDragStop} minZoom={0.4} maxZoom={1.6}>
        <Background color="var(--studio-line)" gap={20} />
        <Controls showInteractive={false} />
    </ReactFlow>;
}
