"use client";

import { useMemo, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { MenuProps } from "antd";
import { Button, Dropdown, Empty, Input, Modal, Tabs, Tag, Tooltip } from "antd";
import { AudioLines, Boxes, Check, ChevronDown, ChevronsLeft, ChevronRight, Clapperboard, FileText, FolderOpen, Image as ImageIcon, ListFilter, PanelLeftClose, PanelLeftOpen, Search, UserRound, Video, X } from "lucide-react";

import { isBackgroundNode, isImageNode, isVideoNode } from "../domain/canvas-node";
import type { CanvasBackgroundNode, CanvasNode, CanvasStoryboardAssetKind } from "../types";
import {
    CANVAS_NAVIGATION_ASSET_CATEGORY_OPTIONS,
    CANVAS_NAVIGATION_NODE_CATEGORY_OPTIONS,
    canvasNavigationAssetKindLabel,
    canvasNavigationAssetTitle,
    canvasNavigationCategoryLabel,
    canvasNavigationNodeKindLabel,
    queryCanvasNavigationAssets,
    queryCanvasNavigationNodes,
    type CanvasNavigationAsset,
    type CanvasNavigationAssetCategory,
    type CanvasNavigationCategoryOption,
    type CanvasNavigationNodeCategory,
    type CanvasNavigationNodeResult,
    type CanvasNavigationStoryboardAsset,
} from "./canvas-navigation-query";
import { useCanvasTheme } from "./canvas-theme-provider";

export type { CanvasNavigationAsset, CanvasNavigationStoryboardAsset } from "./canvas-navigation-query";

export type CanvasNavigationPanelState = "expanded" | "collapsed";
export type CanvasNavigationTab = "nodes" | "assets";

type NavigationQueryState<Category extends string> = {
    searchOpen: boolean;
    keyword: string;
    category: Category;
};

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
    const [nodeQuery, setNodeQuery] = useState<NavigationQueryState<CanvasNavigationNodeCategory>>({ searchOpen: false, keyword: "", category: "all" });
    const [assetQuery, setAssetQuery] = useState<NavigationQueryState<CanvasNavigationAssetCategory>>({ searchOpen: false, keyword: "", category: "all" });
    const nodeResults = useMemo(() => queryCanvasNavigationNodes(props.nodes, nodeQuery.keyword, nodeQuery.category), [nodeQuery.category, nodeQuery.keyword, props.nodes]);
    const assetResults = useMemo(() => queryCanvasNavigationAssets(props.assets, assetQuery.keyword, assetQuery.category), [assetQuery.category, assetQuery.keyword, props.assets]);

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
                <NavigationIconButton label="查看画布资产" active={props.activeTab === "assets"} onClick={() => openTab(props, "assets")}><FolderOpen className="size-4" /></NavigationIconButton>
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
                className="flex h-full min-h-0 flex-1 flex-col px-2 [&_.ant-tabs-nav]:pl-2 [&_.ant-tabs-body-holder]:min-h-0 [&_.ant-tabs-body-holder]:min-w-0 [&_.ant-tabs-body-holder]:flex-1 [&_.ant-tabs-body]:h-full [&_.ant-tabs-content]:h-full [&_.ant-tabs-content]:min-h-0"
                onChange={(tab) => props.onTabChange(tab as CanvasNavigationTab)}
                items={[
                    {
                        key: "nodes",
                        label: <TabLabel icon={<Boxes className="size-3.5" />} label="节点" count={props.nodes.length} />,
                        children: (
                            <div className="flex h-full min-h-0 flex-col">
                                <NavigationQueryToolbar
                                    resourceLabel="节点"
                                    placeholder="搜索节点"
                                    query={nodeQuery}
                                    options={CANVAS_NAVIGATION_NODE_CATEGORY_OPTIONS}
                                    onChange={setNodeQuery}
                                />
                                <NodeList
                                    nodes={props.nodes}
                                    results={nodeResults}
                                    selectedNodeIds={props.selectedNodeIds}
                                    onLocateNode={props.onLocateNode}
                                    onClearQuery={() => setNodeQuery((current) => ({ ...current, keyword: "", category: "all" }))}
                                />
                            </div>
                        ),
                    },
                    {
                        key: "assets",
                        label: <TabLabel icon={<FolderOpen className="size-3.5" />} label="画布资产" count={props.assets.length} />,
                        children: (
                            <div className="flex h-full min-h-0 flex-col">
                                <NavigationQueryToolbar
                                    resourceLabel="资产"
                                    placeholder="搜索资产"
                                    query={assetQuery}
                                    options={CANVAS_NAVIGATION_ASSET_CATEGORY_OPTIONS}
                                    onChange={setAssetQuery}
                                />
                                <AssetList
                                    assets={props.assets}
                                    results={assetResults}
                                    onPreviewAsset={props.onPreviewAsset}
                                    onClearQuery={() => setAssetQuery((current) => ({ ...current, keyword: "", category: "all" }))}
                                />
                            </div>
                        ),
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

function NavigationQueryToolbar<Category extends string>({ resourceLabel, placeholder, query, options, onChange }: { resourceLabel: string; placeholder: string; query: NavigationQueryState<Category>; options: ReadonlyArray<CanvasNavigationCategoryOption<Category>>; onChange: Dispatch<SetStateAction<NavigationQueryState<Category>>> }) {
    const theme = useCanvasTheme();
    const categoryLabel = canvasNavigationCategoryLabel(options, query.category);
    const categoryActive = query.category !== "all";
    const closeSearch = () => onChange((current) => (current.searchOpen || current.keyword ? { ...current, searchOpen: false, keyword: "" } : current));
    const menu: MenuProps = {
        items: options.map((option) => ({
            key: option.value,
            label: option.label,
            icon: option.value === query.category ? <Check className="size-3.5" /> : <span className="inline-block size-3.5" />,
            style: option.value === query.category ? { background: theme.toolbar.activeBg, color: theme.toolbar.activeText } : undefined,
        })),
        onClick: ({ key }) => onChange((current) => ({ ...current, category: key as Category })),
    };
    return (
        <div className="flex shrink-0 items-center gap-1 px-2 pt-2">
            {query.searchOpen ? (
                <Input
                    autoFocus
                    size="small"
                    value={query.keyword}
                    placeholder={placeholder}
                    aria-label={placeholder}
                    className="h-8 min-w-0 flex-1 text-xs placeholder:text-inherit placeholder:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
                    style={{ background: theme.node.fill, borderColor: theme.toolbar.border, color: theme.node.text, outlineColor: theme.node.activeStroke }}
                    onChange={(event) => onChange((current) => ({ ...current, keyword: event.target.value }))}
                    onKeyDown={(event) => {
                        if (event.key !== "Escape") return;
                        event.preventDefault();
                        closeSearch();
                    }}
                />
            ) : (
                <QueryIconButton label={`搜索${resourceLabel}`} onClick={() => onChange((current) => ({ ...current, searchOpen: true }))}><Search className="size-4" /></QueryIconButton>
            )}
            <Dropdown menu={menu} trigger={["click"]} placement="bottomLeft">
                <button
                    type="button"
                    aria-label={`筛选${resourceLabel}分类，当前${categoryLabel}`}
                    className="flex h-8 max-w-36 shrink-0 items-center gap-1 rounded-md px-2 text-xs transition-colors motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
                    style={{ background: categoryActive ? theme.toolbar.activeBg : "transparent", color: categoryActive ? theme.toolbar.activeText : theme.node.muted, outlineColor: theme.node.activeStroke }}
                    onMouseEnter={(event) => {
                        if (!categoryActive) event.currentTarget.style.background = theme.toolbar.itemHover;
                    }}
                    onMouseLeave={(event) => {
                        if (!categoryActive) event.currentTarget.style.background = "transparent";
                    }}
                >
                    <ListFilter className="size-3.5 shrink-0" />
                    <span className="truncate">{categoryLabel}</span>
                    <ChevronDown className="size-3.5 shrink-0" />
                </button>
            </Dropdown>
            {query.searchOpen ? <QueryIconButton label="关闭搜索" onClick={closeSearch}><X className="size-4" /></QueryIconButton> : null}
        </div>
    );
}

function QueryIconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
    const theme = useCanvasTheme();
    return (
        <Tooltip title={label} mouseEnterDelay={0.4}>
            <button
                type="button"
                aria-label={label}
                className="grid size-8 shrink-0 place-items-center rounded-md transition-colors motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
                style={{ color: theme.node.muted, outlineColor: theme.node.activeStroke }}
                onMouseEnter={(event) => { event.currentTarget.style.background = theme.toolbar.itemHover; }}
                onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }}
                onClick={onClick}
            >
                {children}
            </button>
        </Tooltip>
    );
}

function NodeList({ nodes, results, selectedNodeIds, onLocateNode, onClearQuery }: { nodes: CanvasNode[]; results: CanvasNavigationNodeResult[]; selectedNodeIds: Set<string>; onLocateNode: (nodeId: string) => void; onClearQuery: () => void }) {
    const [collapsedBoards, setCollapsedBoards] = useState<Set<string>>(() => new Set());
    const toggleBoard = (boardId: string) => setCollapsedBoards((prev) => {
        const next = new Set(prev);
        if (next.has(boardId)) next.delete(boardId);
        else next.add(boardId);
        return next;
    });
    if (!nodes.length) return <PanelEmpty description="暂无节点" />;
    if (!results.length) return <NavigationNoResult description="未找到符合条件的节点" onClearQuery={onClearQuery} />;
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            <div className="space-y-1">
                {results.map((result) => result.type === "background" ? (
                    <BackgroundBoardGroup
                        key={result.board.id}
                        board={result.board}
                        members={result.members}
                        collapsed={collapsedBoards.has(result.board.id)}
                        onToggle={() => toggleBoard(result.board.id)}
                        selectedNodeIds={selectedNodeIds}
                        onLocateNode={onLocateNode}
                    />
                ) : (
                    <NodeRow key={result.node.id} node={result.node} selected={selectedNodeIds.has(result.node.id)} onLocateNode={onLocateNode} />
                ))}
            </div>
        </div>
    );
}

function BackgroundBoardGroup({ board, members, collapsed, onToggle, selectedNodeIds, onLocateNode }: { board: CanvasBackgroundNode; members: CanvasNode[]; collapsed: boolean; onToggle: () => void; selectedNodeIds: Set<string>; onLocateNode: (nodeId: string) => void }) {
    const theme = useCanvasTheme();
    return (
        <div className="space-y-1">
            <button
                type="button"
                aria-expanded={!collapsed}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors motion-reduce:transition-none"
                style={{ color: theme.node.text }}
                onMouseEnter={(event) => { event.currentTarget.style.background = theme.toolbar.itemHover; }}
                onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }}
                onClick={onToggle}
            >
                <span className="grid size-4 shrink-0 place-items-center" style={{ color: theme.node.muted }}>
                    {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                </span>
                <NodePreview node={board} />
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{board.title || "未命名背景板"}</span>
                    <span className="mt-0.5 flex items-center gap-1 text-[11px]" style={{ color: theme.node.muted }}><NodeKindIcon kind={board.kind} className="size-3" />{canvasNavigationNodeKindLabel(board.kind)}</span>
                </span>
                {members.length > 0 ? <span className="shrink-0 text-[11px]" style={{ color: theme.node.muted }}>{members.length} 个节点</span> : null}
            </button>
            {!collapsed && members.length > 0 ? (
                <div className="ml-[38px] space-y-1 border-l pl-2" style={{ borderColor: theme.toolbar.border }}>
                    {members.map((member) => <NodeRow key={member.id} node={member} selected={selectedNodeIds.has(member.id)} onLocateNode={onLocateNode} />)}
                </div>
            ) : null}
        </div>
    );
}

function NodeRow({ node, selected, onLocateNode }: { node: CanvasNode; selected: boolean; onLocateNode: (nodeId: string) => void }) {
    const theme = useCanvasTheme();
    const batchCount = isImageNode(node) && node.grouping.isRoot ? node.grouping.childIds.length : 0;
    return (
        <button
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
                <span className="mt-0.5 flex items-center gap-1 text-[11px]" style={{ color: theme.node.muted }}><NodeKindIcon kind={node.kind} className="size-3" />{canvasNavigationNodeKindLabel(node.kind)}</span>
            </span>
            {batchCount > 0 ? <span className="shrink-0 text-[11px]" style={{ color: theme.node.muted }}>{batchCount} 张</span> : null}
        </button>
    );
}
function AssetList({ assets, results, onPreviewAsset, onClearQuery }: { assets: CanvasNavigationAsset[]; results: CanvasNavigationAsset[]; onPreviewAsset: (asset: CanvasNavigationAsset) => void; onClearQuery: () => void }) {
    const theme = useCanvasTheme();
    if (!assets.length) return <PanelEmpty description="暂无画布资产" />;
    if (!results.length) return <NavigationNoResult description="未找到符合条件的资产" onClearQuery={onClearQuery} />;
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            <div className="space-y-1">
                {results.map((asset) => (
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
                            <span className="block truncate text-xs font-medium">{canvasNavigationAssetTitle(asset)}</span>
                            <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px]" style={{ color: theme.node.muted }}><AssetKindIcon asset={asset} className="size-3" /><span className="truncate">{canvasNavigationAssetKindLabel(asset)}</span></span>
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

function NavigationNoResult({ description, onClearQuery }: { description: string; onClearQuery: () => void }) {
    return (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 py-12">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description} />
            <Button size="small" onClick={onClearQuery}>清除搜索和筛选</Button>
        </div>
    );
}

function NodePreview({ node }: { node: CanvasNode }) {
    const theme = useCanvasTheme();
    const imageSource = isImageNode(node) ? node.content.source : "";
    const videoSource = isVideoNode(node) ? node.content.source : "";
    return (
        <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md" style={{ background: theme.node.fill, color: theme.node.muted }}>
            {imageSource ? (
                <img src={imageSource} alt="" loading="lazy" className="size-full object-cover" />
            ) : videoSource ? (
                <video src={videoSource} aria-hidden="true" muted playsInline preload="auto" className="pointer-events-none size-full object-cover" />
            ) : isBackgroundNode(node) ? <Boxes className="size-4" /> : (
                <NodeKindIcon kind={node.kind} className="size-4" />
            )}
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

function NodeKindIcon({ kind, className }: { kind: CanvasNode["kind"]; className?: string }) {
    const Icon = kind === "audio" ? AudioLines : kind === "image" ? ImageIcon : kind === "text" ? FileText : kind === "video" ? Video : kind === "storyboard" ? Clapperboard : Boxes;
    return <Icon className={className} />;
}

function AssetKindIcon({ asset, className }: { asset: CanvasNavigationAsset; className?: string }) {
    const Icon = asset.source === "library"
        ? asset.asset.kind === "image" ? ImageIcon : asset.asset.kind === "video" ? Video : FileText
        : asset.asset.kind === "character" ? UserRound : asset.asset.kind === "scene" ? ImageIcon : Boxes;
    return <Icon className={className} />;
}

function storyboardAssetKindLabel(kind: CanvasStoryboardAssetKind) {
    return kind === "character" ? "角色" : kind === "scene" ? "场景" : "道具";
}

/** 预览画布导航中的分镜资产，并按原始比例展示完整图片。 */
export function CanvasStoryboardAssetPreviewDialog({ asset, onClose }: { asset: CanvasNavigationStoryboardAsset | null; onClose: () => void }) {
    const theme = useCanvasTheme();
    if (!asset) return null;
    const title = asset.asset.name || "未命名分镜资产";
    const imageSource = asset.asset.image?.source;
    return (
        <Modal title={title} open centered footer={null} width="min(calc(100vw - 32px), 1080px)" onCancel={onClose} destroyOnHidden>
            <div className="grid gap-5 pt-1 lg:grid-cols-[minmax(0,1fr)_260px]">
                <div className="flex min-h-[56dvh] items-center justify-center rounded-lg p-3 sm:p-5" style={{ background: theme.node.fill }}>
                    {imageSource ? (
                        <img src={imageSource} alt={title} className="block max-h-[72dvh] max-w-full object-contain" decoding="async" />
                    ) : (
                        <div className="grid min-h-48 place-items-center gap-2 text-sm" style={{ color: theme.node.muted }}>
                            <AssetKindIcon asset={asset} className="size-7" />
                            <span>暂未关联图片</span>
                        </div>
                    )}
                </div>
                <div className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                        <Tag>分镜资产</Tag>
                        <Tag>{storyboardAssetKindLabel(asset.asset.kind)}</Tag>
                        {asset.storyboardNodeTitle ? <Tag>{asset.storyboardNodeTitle}</Tag> : null}
                    </div>
                    <div className="rounded-lg p-4 text-sm leading-6" style={{ background: theme.node.fill, color: asset.asset.description ? theme.node.text : theme.node.muted }}>
                        {asset.asset.description || "暂无描述"}
                    </div>
                </div>
            </div>
        </Modal>
    );
}
