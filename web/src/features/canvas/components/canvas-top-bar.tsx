"use client";
import { translateMessage as translate } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";


import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Bot, Keyboard, PanelLeftOpen } from "lucide-react";
import { Button, Modal, Tooltip } from "antd";

import { UserStatusActions } from "@/features/app-shell/components/user-status-actions";
import { UserCreditMenu } from "@/features/app-shell/components/user-credit-menu";
import { LanguageMenu } from "@/features/locale/components/language-menu";
import { ThemePreferenceMenu } from "@/features/theme/components/theme-preference-menu";
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
    navigationPanelHidden: boolean;
    onOpenNavigationPanel: () => void;
    agentOpen: boolean;
    onToggleAgent: () => void;
};

const SHORTCUT_GROUPS = () => ([
    {
        get title() { return translate("canvas.view"); },
        items: [
            [translate("canvas.panCanvas"), translate("canvas.panView")],
            [translate("canvas.mouseWheelZoomSlider"), translate("canvas.zoomCanvas")],
        ],
    },
    {
        get title() { return translate("canvas.selectionEditing"); },
        items: [
            [translate("canvas.ctrlCmdDrag"), translate("canvas.selectNodes")],
            [translate("canvas.shiftCtrlCmdClick"), translate("canvas.extendSelection")],
            ["Ctrl / Cmd + A", translate("canvas.selectAllNodes")],
            ["Ctrl / Cmd + C / V", translate("canvas.copyOrPasteNodesTextAndImages")],
            ["Delete / Backspace", translate("canvas.deleteSelectedContent")],
            ["Esc", translate("canvas.deselectAndCloseOverlay")],
        ],
    },
    {
        get title() { return translate("canvas.historyCollaboration"); },
        items: [
            ["Ctrl / Cmd + Z", translate("canvas.undo")],
            ["Ctrl / Cmd + Shift + Z / Y", translate("canvas.redo")],
            [translate("canvas.ctrlCmdShiftDragNode"), translate("canvas.sendNodeToCanvasAgent")],
            [translate("canvas.dropAnImageOrVideo"), translate("canvas.uploadToCanvas")],
        ],
    },
] as const);

export function CanvasTopBar(props: CanvasTopBarProps) {
    const translate = useTranslation();
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
                    <Tooltip title={translate("canvas.backToCanvases")}>
                        <Button type="text" aria-label={translate("canvas.backToCanvases")} icon={<ArrowLeft className="size-4" />} onClick={props.onBackToProjects} style={toolbarButtonStyle} />
                    </Tooltip>
                    <div className="h-5 w-px" style={{ background: theme.toolbar.border }} />
                    <div ref={titleAreaRef} className="min-w-0">
                        {props.isTitleEditing ? (
                            <input
                                autoFocus
                                value={props.titleDraft}
                                aria-label={translate("canvas.canvasName")}
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
                            <button type="button" className="max-w-[min(42vw,320px)] truncate text-left text-base font-semibold" onDoubleClick={props.onStartTitleEditing} title={translate("canvas.doubleClickToRenameCanvas")}>
                                {props.title}
                            </button>
                        )}
                    </div>
                </div>

                <div className="pointer-events-auto flex items-center gap-1">
                    {props.navigationPanelHidden ? (
                        <Tooltip title={translate("canvas.showCanvasNavigator")}>
                            <Button type="text" aria-label={translate("canvas.showCanvasNavigator")} icon={<PanelLeftOpen className="size-4" />} onClick={props.onOpenNavigationPanel} style={toolbarButtonStyle} />
                        </Tooltip>
                    ) : null}
                    <UserStatusActions variant="canvas" onOpenShortcuts={() => setShortcutsOpen(true)} />
                    <LanguageMenu />
                    <ThemePreferenceMenu variant="toolbar" />
                    <UserCreditMenu />
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
                        {translate("canvas.canvasAgent")}</Button>
                </div>
            </header>

            <Modal title={<span className="inline-flex items-center gap-2"><Keyboard className="size-4" />{translate("canvas.canvasShortcuts")}</span>} open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} footer={null} centered width={560}>
                <div className="space-y-5 pt-2">
                    {SHORTCUT_GROUPS().map((group) => (
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
