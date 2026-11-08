"use client";
import { useTranslation } from "@/features/locale/use-translation";


import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Box, ChevronRight, Copy, Frame, Image, LayoutTemplate, Plus, Trash2, Type, AudioLines, Upload, Video } from "lucide-react";

import type { CanvasNodeKind, CanvasPoint, ContextMenuState } from "../types";
import { useCanvasTheme } from "./canvas-theme-provider";

type CanvasNodeContextMenuProps = { menu: ContextMenuState; onClose: () => void; onCreateNode: (kind: CanvasNodeKind) => void; onCreateFirstLastFrameVideoTemplate: () => void; onUpload: (position: CanvasPoint) => void; onDuplicate: () => void; onDelete: () => void; onDeleteBackgroundOnly: () => void; onAddToBackground: (nodeIds: string[]) => void; onAddBackgroundLabel: () => void };
type MenuAction = { key: string; label: string; icon: ComponentType<{ className?: string }>; danger?: boolean; run: () => void };

const menuItemClassName = "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs transition hover:bg-black/5";

export function CanvasNodeContextMenu({ menu, onClose, onCreateNode, onCreateFirstLastFrameVideoTemplate, onUpload, onDuplicate, onDelete, onDeleteBackgroundOnly, onAddToBackground, onAddBackgroundLabel }: CanvasNodeContextMenuProps) {
    const translate = useTranslation();
    const theme = useCanvasTheme();
    const menuRef = useRef<HTMLDivElement>(null);
    const nodeActions: MenuAction[] = menu.type === "canvas"
        ? [
              { key: "add-text", label: translate("canvas.addTextNode"), icon: Type, run: () => onCreateNode("text") },
              { key: "add-image", label: translate("canvas.addImageNode"), icon: Image, run: () => onCreateNode("image") },
              { key: "add-audio", label: translate("canvas.addAudioNode"), icon: AudioLines, run: () => onCreateNode("audio") },
              { key: "add-video", label: translate("canvas.addVideoNode"), icon: Video, run: () => onCreateNode("video") },
              { key: "add-director-desk", label: translate("canvas.add3DDirectorDeskNode"), icon: Box, run: () => onCreateNode("directorDesk") },
          ]
        : [];
    const templateActions: MenuAction[] = menu.type === "canvas"
        ? [{ key: "first-last-frame-video", label: translate("canvas.firstLastFrameVideoTemplate"), icon: Video, run: onCreateFirstLastFrameVideoTemplate }]
        : [];
    const backgroundAction: MenuAction | null = menu.type === "canvas" ? { key: "add-background", label: translate("canvas.addBackground"), icon: Frame, run: () => onCreateNode("background") } : null;
    const actions: MenuAction[] = menu.type === "canvas"
        ? []
        : [
              ...(menu.type === "node" ? [{ key: "duplicate", label: translate("canvas.duplicate"), icon: Copy, run: onDuplicate }] : []),
              ...(menu.type === "selection" ? [{ key: "add-to-background", label: translate("canvas.addToBackground", { value0: menu.nodeIds.length }), icon: Frame, run: () => onAddToBackground(menu.nodeIds) }] : []),
              ...(menu.type === "node" && menu.nodeKind === "background" ? [{ key: "add-background-description", label: translate("canvas.addBackgroundDescription"), icon: Type, run: onAddBackgroundLabel }, { key: "delete-background-only", label: translate("canvas.deleteBackgroundOnly"), icon: Trash2, danger: true, run: onDeleteBackgroundOnly }] : []),
              { key: "delete", label: menu.type === "selection" ? translate("canvas.deleteSelectedNodes", { value0: menu.nodeIds.length }) : menu.type === "node" ? translate("canvas.deleteNode") : translate("canvas.deleteConnection"), icon: Trash2, danger: true, run: onDelete },
          ];
    const uploadPosition = menu.type === "canvas" || menu.type === "selection" ? menu.position : undefined;
    if (uploadPosition) actions.unshift({ key: "upload", label: translate("canvas.uploadAssets"), icon: Upload, run: () => onUpload(uploadPosition) });

    useEffect(() => {
        const closeWhenOutside = (event: PointerEvent) => {
            if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
            onClose();
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("pointerdown", closeWhenOutside, { capture: true });
        window.addEventListener("keydown", closeOnEscape);
        menuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
        return () => {
            window.removeEventListener("pointerdown", closeWhenOutside, { capture: true });
            window.removeEventListener("keydown", closeOnEscape);
        };
    }, [onClose]);

    const renderAction = (action: MenuAction) => {
        const Icon = action.icon;
        return (
            <button key={action.key} type="button" role="menuitem" className={menuItemClassName} style={{ color: action.danger ? "#ef4444" : theme.node.text }} onClick={action.run}>
                <Icon className="size-4" />
                {action.label}
            </button>
        );
    };

    return (
        <div ref={menuRef} role="menu" aria-label={menu.type === "canvas" ? translate("canvas.addCanvasNode") : menu.type === "node" ? translate("canvas.nodeActions") : menu.type === "selection" ? translate("canvas.selectedNodeActions") : translate("canvas.connectionActions")} className="fixed z-[80] min-w-40 rounded-lg border p-1 shadow-xl" style={{ left: menu.x, top: menu.y, background: theme.node.panel, borderColor: theme.toolbar.border }} onPointerDown={(event) => event.stopPropagation()}>
            {actions.map(renderAction)}
            {menu.type === "canvas" ? <CanvasContextSubmenu label={translate("canvas.addNodeMenu")} icon={Plus} actions={nodeActions} renderAction={renderAction} /> : null}
            {menu.type === "canvas" ? <CanvasContextSubmenu label={translate("canvas.templateMenu")} icon={LayoutTemplate} actions={templateActions} renderAction={renderAction} /> : null}
            {backgroundAction ? renderAction(backgroundAction) : null}
        </div>
    );
}

/** 右键菜单里向左右展开的悬停子菜单，贴边时翻到另一侧。 */
function CanvasContextSubmenu({ label, icon: Icon, actions, renderAction }: { label: string; icon: ComponentType<{ className?: string }>; actions: MenuAction[]; renderAction: (action: MenuAction) => ReactNode }) {
    const theme = useCanvasTheme();
    const anchorRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [side, setSide] = useState<"left" | "right">("right");

    useLayoutEffect(() => {
        if (!open) return;
        const anchor = anchorRef.current;
        const panel = panelRef.current;
        if (!anchor || !panel) return;
        const anchorRect = anchor.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        const margin = 8;
        const overflowsRight = anchorRect.right + panelRect.width > window.innerWidth - margin;
        const fitsLeft = anchorRect.left - panelRect.width >= margin;
        setSide(overflowsRight && fitsLeft ? "left" : "right");
    }, [open]);

    return (
        <div ref={anchorRef} className="relative" onPointerEnter={() => setOpen(true)} onPointerLeave={() => setOpen(false)}>
            <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open} className={`${menuItemClassName} ${open ? "bg-black/5" : ""}`} style={{ color: theme.node.text }}>
                <Icon className="size-4" />
                <span className="min-w-0 flex-1">{label}</span>
                <ChevronRight className="size-4" />
            </button>
            {open ? (
                <div ref={panelRef} role="menu" aria-label={label} className="absolute top-0 z-[81] min-w-40 rounded-lg border p-1 shadow-xl" style={{ left: side === "right" ? "100%" : "auto", right: side === "left" ? "100%" : "auto", background: theme.node.panel, borderColor: theme.toolbar.border }}>
                    {actions.map(renderAction)}
                </div>
            ) : null}
        </div>
    );
}
