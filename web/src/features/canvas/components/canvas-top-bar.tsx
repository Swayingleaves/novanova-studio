"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Bot, Keyboard } from "lucide-react";
import { Button, Modal, Tooltip } from "antd";

import { UserStatusActions } from "@/features/app-shell/components/user-status-actions";
import { useCanvasTheme } from "./canvas-theme-provider";

type CanvasTopBarProps = {
    title: string;
    titleDraft: string;
    isTitleEditing: boolean;
    onTitleDraftChange: (value: string) => void;
    onStartTitleEditing: () => void;
    onFinishTitleEditing: () => void;
    onCancelTitleEditing: () => void;
    onBackToProjects: () => void;
    agentOpen: boolean;
    onToggleAgent: () => void;
    taskPanel: ReactNode;
};

const SHORTCUT_GROUPS = [
    {
        title: "视图",
        items: [
            ["拖动画布", "平移视图"],
            ["滚轮 / 缩放滑杆", "缩放画布"],
        ],
    },
    {
        title: "选择与编辑",
        items: [
            ["Ctrl / Cmd + 拖动", "框选节点"],
            ["Shift / Ctrl / Cmd + 点击", "追加选择"],
            ["Ctrl / Cmd + A", "全选节点"],
            ["Ctrl / Cmd + C / V", "复制或粘贴节点、文本、图片"],
            ["Delete / Backspace", "删除选中内容"],
            ["Esc", "取消选择并关闭浮层"],
        ],
    },
    {
        title: "历史与协作",
        items: [
            ["Ctrl / Cmd + Z", "撤销"],
            ["Ctrl / Cmd + Shift + Z / Y", "重做"],
            ["Ctrl / Cmd + Shift + 拖动节点", "发送节点到画布Agent"],
            ["拖入图片或视频", "上传到画布"],
        ],
    },
] as const;

export function CanvasTopBar(props: CanvasTopBarProps) {
    const theme = useCanvasTheme();
    const titleAreaRef = useRef<HTMLDivElement>(null);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);

    useEffect(() => {
        if (!props.isTitleEditing) return;
        const finishWhenClickingOutside = (event: PointerEvent) => {
            if (!titleAreaRef.current?.contains(event.target as Node)) props.onFinishTitleEditing();
        };
        document.addEventListener("pointerdown", finishWhenClickingOutside, true);
        return () => document.removeEventListener("pointerdown", finishWhenClickingOutside, true);
    }, [props.isTitleEditing, props.onFinishTitleEditing]);

    const toolbarButtonStyle = { color: theme.node.text };

    return (
        <>
            <header className="pointer-events-none absolute inset-x-0 top-0 z-[140] flex h-14 items-center justify-between px-3">
                <div className="pointer-events-auto flex min-w-0 items-center gap-2">
                    <Tooltip title="返回画布列表">
                        <Button type="text" aria-label="返回画布列表" icon={<ArrowLeft className="size-4" />} onClick={props.onBackToProjects} style={toolbarButtonStyle} />
                    </Tooltip>
                    <div className="h-5 w-px" style={{ background: theme.toolbar.border }} />
                    <div ref={titleAreaRef} className="min-w-0">
                        {props.isTitleEditing ? (
                            <input
                                autoFocus
                                value={props.titleDraft}
                                aria-label="画布名称"
                                className="w-[min(42vw,320px)] bg-transparent text-base font-semibold outline-none"
                                style={{ color: theme.node.text }}
                                onChange={(event) => props.onTitleDraftChange(event.target.value)}
                                onBlur={props.onFinishTitleEditing}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") props.onFinishTitleEditing();
                                    else if (event.key === "Escape") props.onCancelTitleEditing();
                                }}
                            />
                        ) : (
                            <button type="button" className="max-w-[min(42vw,320px)] truncate text-left text-base font-semibold" onDoubleClick={props.onStartTitleEditing} title="双击修改画布名称">
                                {props.title}
                            </button>
                        )}
                    </div>
                </div>

                <div className="pointer-events-auto flex items-center gap-1">
                    <UserStatusActions variant="canvas" onOpenShortcuts={() => setShortcutsOpen(true)} />
                    {props.taskPanel}
                    <Button
                        type="text"
                        className="!px-2"
                        icon={<Bot className="size-4" />}
                        aria-pressed={props.agentOpen}
                        onClick={props.onToggleAgent}
                        style={{
                            color: props.agentOpen ? theme.toolbar.activeGradientText : theme.node.text,
                            background: props.agentOpen ? theme.toolbar.activeGradient : "transparent",
                        }}
                    >
                        画布Agent
                    </Button>
                </div>
            </header>

            <Modal title={<span className="inline-flex items-center gap-2"><Keyboard className="size-4" />画布快捷键</span>} open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} footer={null} centered width={560}>
                <div className="space-y-5 pt-2">
                    {SHORTCUT_GROUPS.map((group) => (
                        <section key={group.title} aria-label={group.title}>
                            <h3 className="mb-2 text-sm font-semibold" style={{ color: theme.node.text }}>{group.title}</h3>
                            <dl className="divide-y" style={{ borderColor: theme.node.stroke }}>
                                {group.items.map(([keys, description]) => (
                                    <div key={keys} className="flex items-center justify-between gap-6 py-2 text-sm">
                                        <dt><kbd className="rounded-md px-2 py-1 font-mono text-xs" style={{ background: theme.node.fill, color: theme.node.text }}>{keys}</kbd></dt>
                                        <dd className="text-right" style={{ color: theme.node.muted }}>{description}</dd>
                                    </div>
                                ))}
                            </dl>
                        </section>
                    ))}
                </div>
            </Modal>
        </>
    );
}
