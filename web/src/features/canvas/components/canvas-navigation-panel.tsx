"use client";

import type { ReactNode } from "react";
import { Empty, Modal, Tabs, Tag, Tooltip } from "antd";
import { Boxes, ChevronsLeft, CircleCheck, CircleDashed, CircleX, Clapperboard, FileText, FolderOpen, Image as ImageIcon, PanelLeftClose, PanelLeftOpen, UserRound, Video } from "lucide-react";

import type { Asset } from "@/features/assets/stores/use-asset-store";
import { isImageNode } from "../domain/canvas-node";
import type { CanvasNode, CanvasStoryboardAsset, CanvasStoryboardAssetKind } from "../types";
import { useCanvasTheme } from "./canvas-theme-provider";

export type CanvasNavigationPanelState = "expanded" | "collapsed";
export type CanvasNavigationTab = "nodes" | "assets";
export type CanvasNavigationAsset =
    | { id: string; source: "library"; asset: Asset }
    | { id: string; source: "storyboard"; asset: CanvasStoryboardAsset; storyboardNodeTitle: string };
export type CanvasNavigationStoryboardAsset = Extract<CanvasNavigationAsset, { source: "storyboard" }>;

type CanvasNavigationPanelProps = {
    state: CanvasNavigationPanelState;
    activeTab: CanvasNavigationTab;
    nodes: CanvasNode[];
    assets: CanvasNavigationAsset[];
    selectedNodeIds: Set<string>;
    onTabChange: (tab: CanvasNavigationTab) => void;
    onLocateNode: (nodeId: string) => void;
    onPreviewAsset: (asset: CanvasNavigationAsset) => void;
    onCollapse: () => void;
    onExpand: () => void;
    onHide: () => void;
};

export function CanvasNavigationPanel(props: CanvasNavigationPanelProps) {
    const theme = useCanvasTheme();

    if (props.state === "collapsed") {
        return (
            <aside
                data-canvas-no-zoom
                aria-label="画布导航"
                className="absolute left-0 top-16 z-[100] flex w-11 flex-col gap-1 rounded-r-lg border p-1"
                style={{ background: theme.node.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onWheelCapture={(event) => event.stopPropagation()}
            >
                <NavigationIconButton label="查看节点" active={props.activeTab === "nodes"} onClick={() => openTab(props, "nodes")}><Boxes className="size-4" /></NavigationIconButton>
                <NavigationIconButton label="查看资产" active={props.activeTab === "assets"} onClick={() => openTab(props, "assets")}><FolderOpen className="size-4" /></NavigationIconButton>
                <div className="h-px" style={{ background: theme.toolbar.border }} />
                <NavigationIconButton label="展开导航栏" onClick={props.onExpand}><PanelLeftOpen className="size-4" /></NavigationIconButton>
                <NavigationIconButton label="收起导航栏" onClick={props.onHide}><ChevronsLeft className="size-4" /></NavigationIconButton>
            </aside>
        );
    }

    return (
        <aside
            data-canvas-no-zoom
            aria-label="画布导航"
            className="absolute bottom-4 left-0 top-16 z-[100] flex min-h-0 flex-col overflow-hidden rounded-r-lg border"
            style={{ width: "min(280px, calc(100vw - 24px))", background: theme.node.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheelCapture={(event) => event.stopPropagation()}
        >
            <header className="flex h-11 shrink-0 items-center justify-between border-b px-3" style={{ borderColor: theme.toolbar.border }}>
                <span className="text-sm font-medium">画布导航</span>
                <div className="flex items-center gap-1">
                    <NavigationIconButton label="折叠导航栏" onClick={props.onCollapse}><PanelLeftClose className="size-4" /></NavigationIconButton>
                    <NavigationIconButton label="收起导航栏" onClick={props.onHide}><ChevronsLeft className="size-4" /></NavigationIconButton>
                </div>
            </header>
            <Tabs
                activeKey={props.activeTab}
                className="flex h-full min-h-0 flex-1 flex-col px-2 [&_.ant-tabs-nav]:pl-2 [&_.ant-tabs-content-holder]:min-h-0 [&_.ant-tabs-content-holder]:flex-1 [&_.ant-tabs-content]:h-full [&_.ant-tabs-tabpane]:h-full"
                onChange={(tab) => props.onTabChange(tab as CanvasNavigationTab)}
                items={[
                    {
                        key: "nodes",
                        label: <TabLabel icon={<Boxes className="size-3.5" />} label="节点" count={props.nodes.length} />,
                        children: <NodeList nodes={props.nodes} selectedNodeIds={props.selectedNodeIds} onLocateNode={props.onLocateNode} />,
                    },
                    {
                        key: "assets",
                        label: <TabLabel icon={<FolderOpen className="size-3.5" />} label="资产" count={props.assets.length} />,
                        children: <AssetList assets={props.assets} onPreviewAsset={props.onPreviewAsset} />,
                    },
                ]}
            />
        </aside>
    );
}

function openTab(props: CanvasNavigationPanelProps, tab: CanvasNavigationTab) {
    props.onTabChange(tab);
    props.onExpand();
}

function NavigationIconButton({ label, active = false, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
    const theme = useCanvasTheme();
    return (
        <Tooltip title={label} placement="right" mouseEnterDelay={0.4}>
            <button
                type="button"
                aria-label={label}
                aria-pressed={active || undefined}
                className="grid size-8 place-items-center rounded-md transition-colors motion-reduce:transition-none"
                style={{ background: active ? theme.toolbar.itemHover : "transparent", color: active ? theme.toolbar.activeText : theme.node.muted }}
                onClick={onClick}
            >
                {children}
            </button>
        </Tooltip>
    );
}

function TabLabel({ icon, label, count }: { icon: ReactNode; label: string; count: number }) {
    return <span className="inline-flex items-center gap-1.5">{icon}{label}<span className="text-xs opacity-60">{count}</span></span>;
}

function NodeList({ nodes, selectedNodeIds, onLocateNode }: { nodes: CanvasNode[]; selectedNodeIds: Set<string>; onLocateNode: (nodeId: string) => void }) {
    const theme = useCanvasTheme();
    if (!nodes.length) return <PanelEmpty description="暂无节点" />;
    return (
        <div className="thin-scrollbar h-full overflow-y-auto px-2 pb-2">
            <div className="space-y-1">
                {nodes.map((node) => {
                    const selected = selectedNodeIds.has(node.id);
                    const batchCount = isImageNode(node) && node.grouping.isRoot ? node.grouping.childIds.length : 0;
                    return (
                        <button
                            key={node.id}
                            type="button"
                            aria-pressed={selected}
                            className="flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors motion-reduce:transition-none"
                            style={{ background: selected ? theme.toolbar.itemHover : "transparent", borderColor: selected ? theme.node.activeStroke : "transparent", color: theme.node.text }}
                            onMouseEnter={(event) => {
                                if (!selected) event.currentTarget.style.background = theme.toolbar.itemHover;
                            }}
                            onMouseLeave={(event) => {
                                if (!selected) event.currentTarget.style.background = "transparent";
                            }}
                            onClick={() => onLocateNode(node.id)}
                        >
                            <NodePreview node={node} />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-medium">{node.title || "未命名节点"}</span>
                                <span className="mt-0.5 flex items-center gap-1 text-[11px]" style={{ color: theme.node.muted }}><NodeKindIcon kind={node.kind} className="size-3" />{nodeKindLabel(node.kind)}<NodeStatus phase={node.execution.phase} /></span>
                            </span>
                            {batchCount > 0 ? <span className="shrink-0 text-[11px]" style={{ color: theme.node.muted }}>{batchCount} 张</span> : null}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function AssetList({ assets, onPreviewAsset }: { assets: CanvasNavigationAsset[]; onPreviewAsset: (asset: CanvasNavigationAsset) => void }) {
    const theme = useCanvasTheme();
    if (!assets.length) return <PanelEmpty description="暂无资产" />;
    return (
        <div className="thin-scrollbar h-full overflow-y-auto pb-2">
            <div className="space-y-1">
                {assets.map((asset) => (
                    <button
                        key={asset.id}
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors motion-reduce:transition-none"
                        style={{ color: theme.node.text }}
                        onMouseEnter={(event) => {
                            event.currentTarget.style.background = theme.toolbar.itemHover;
                        }}
                        onMouseLeave={(event) => {
                            event.currentTarget.style.background = "transparent";
                        }}
                        onClick={() => onPreviewAsset(asset)}
                    >
                        <AssetPreview asset={asset} />
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium">{assetTitle(asset)}</span>
                            <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px]" style={{ color: theme.node.muted }}><AssetKindIcon asset={asset} className="size-3" /><span className="truncate">{assetKindLabel(asset)}</span></span>
                        </span>
                    </button>
                ))}
            </div>
        </div>
    );
}

function PanelEmpty({ description }: { description: string }) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description} className="py-12" />;
}

function NodePreview({ node }: { node: CanvasNode }) {
    const theme = useCanvasTheme();
    return (
        <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md" style={{ background: theme.node.fill, color: theme.node.muted }}>
            {isImageNode(node) && node.content.source ? <img src={node.content.source} alt="" loading="lazy" className="size-full object-cover" /> : <NodeKindIcon kind={node.kind} className="size-4" />}
        </span>
    );
}

function AssetPreview({ asset }: { asset: CanvasNavigationAsset }) {
    const theme = useCanvasTheme();
    const cover = asset.source === "library"
        ? asset.asset.coverUrl || (asset.asset.kind === "image" ? asset.asset.data.dataUrl : "")
        : asset.asset.image?.source || "";
    return (
        <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md" style={{ background: theme.node.fill, color: theme.node.muted }}>
            {cover ? <img src={cover} alt="" loading="lazy" className="size-full object-cover" /> : <AssetKindIcon asset={asset} className="size-4" />}
        </span>
    );
}

function NodeStatus({ phase }: { phase: CanvasNode["execution"]["phase"] }) {
    const label = phase === "running" ? "生成中" : phase === "succeeded" ? "已完成" : phase === "failed" ? "失败" : "待编辑";
    const Icon = phase === "running" ? CircleDashed : phase === "succeeded" ? CircleCheck : phase === "failed" ? CircleX : CircleDashed;
    return <span className="ml-auto inline-flex shrink-0 items-center gap-0.5"><Icon className={phase === "running" ? "size-3 animate-spin motion-reduce:animate-none" : "size-3"} />{label}</span>;
}

function NodeKindIcon({ kind, className }: { kind: CanvasNode["kind"]; className?: string }) {
    const Icon = kind === "image" ? ImageIcon : kind === "text" ? FileText : kind === "video" ? Video : kind === "storyboard" ? Clapperboard : Boxes;
    return <Icon className={className} />;
}

function AssetKindIcon({ asset, className }: { asset: CanvasNavigationAsset; className?: string }) {
    const Icon = asset.source === "library"
        ? asset.asset.kind === "image" ? ImageIcon : asset.asset.kind === "video" ? Video : FileText
        : asset.asset.kind === "character" ? UserRound : asset.asset.kind === "scene" ? ImageIcon : Boxes;
    return <Icon className={className} />;
}

function nodeKindLabel(kind: CanvasNode["kind"]) {
    return kind === "image" ? "图片" : kind === "text" ? "文本" : kind === "video" ? "视频" : kind === "storyboard" ? "分镜" : "视频合成";
}

function assetTitle(asset: CanvasNavigationAsset) {
    return asset.source === "library" ? asset.asset.title || "未命名资产" : asset.asset.name || "未命名分镜资产";
}

function assetKindLabel(asset: CanvasNavigationAsset) {
    if (asset.source === "library") return asset.asset.kind === "image" ? "图片" : asset.asset.kind === "video" ? "视频" : "文本";
    return `${storyboardAssetKindLabel(asset.asset.kind)} · ${asset.storyboardNodeTitle || "分镜脚本"}`;
}

function storyboardAssetKindLabel(kind: CanvasStoryboardAssetKind) {
    return kind === "character" ? "角色" : kind === "scene" ? "场景" : "道具";
}

export function CanvasStoryboardAssetPreviewDialog({ asset, onClose }: { asset: CanvasNavigationStoryboardAsset | null; onClose: () => void }) {
    const theme = useCanvasTheme();
    if (!asset) return null;
    const title = asset.asset.name || "未命名分镜资产";
    const imageSource = asset.asset.image?.source;
    return (
        <Modal title={title} open centered footer={null} width={720} onCancel={onClose} destroyOnHidden>
            <div className="grid gap-5 pt-1">
                {imageSource ? (
                    <img src={imageSource} alt={title} className="max-h-[52vh] w-full rounded-lg object-contain" />
                ) : (
                    <div className="grid min-h-48 place-items-center gap-2 rounded-lg text-sm" style={{ background: theme.node.fill, color: theme.node.muted }}>
                        <AssetKindIcon asset={asset} className="size-7" />
                        <span>暂未关联图片</span>
                    </div>
                )}
                <div className="flex flex-wrap gap-2">
                    <Tag>分镜资产</Tag>
                    <Tag>{storyboardAssetKindLabel(asset.asset.kind)}</Tag>
                    {asset.storyboardNodeTitle ? <Tag>{asset.storyboardNodeTitle}</Tag> : null}
                </div>
                <div className="rounded-lg p-4 text-sm leading-6" style={{ background: theme.node.fill, color: asset.asset.description ? theme.node.text : theme.node.muted }}>
                    {asset.asset.description || "暂无描述"}
                </div>
            </div>
        </Modal>
    );
}
