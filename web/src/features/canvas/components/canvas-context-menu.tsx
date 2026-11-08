"use client";
import { useTranslation } from "@/features/locale/use-translation";


import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { Box, ChevronRight, Copy, Frame, Image, Plus, Trash2, Type, AudioLines, Upload, Video } from "lucide-react";

import type { CanvasNodeKind, CanvasPoint, ContextMenuState } from "../types";
import { useCanvasTheme } from "./canvas-theme-provider";

type CanvasNodeContextMenuProps = { menu: ContextMenuState; onClose: () => void; onCreateNode: (kind: CanvasNodeKind) => void; onUpload: (position: CanvasPoint) => void; onDuplicate: () => void; onDelete: () => void; onDeleteBackgroundOnly: () => void; onAddToBackground: (nodeIds: string[]) => void; onAddBackgroundLabel: () => void };
type MenuAction = { key: string; label: string; icon: ComponentType<{ className?: string }>; danger?: boolean; run: () => void };

const menuItemClassName = "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs transition hover:bg-black/5";

export function CanvasNodeContextMenu({ menu, onClose, onCreateNode, onUpload, onDuplicate, onDelete, onDeleteBackgroundOnly, onAddToBackground, onAddBackgroundLabel }: CanvasNodeContextMenuProps) {
    const translate = useTranslation();
    const theme = useCanvasTheme();
    const menuRef = useRef<HTMLDivElement>(null);
    const nodeMenuAnchorRef = useRef<HTMLDivElement>(null);
    const nodeSubmenuRef = useRef<HTMLDivElement>(null);
    const [nodeMenuOpen, setNodeMenuOpen] = useState(false);
    const [nodeMenuSide, setNodeMenuSide] = useState<"left" | "right">("right");
    const nodeActions: MenuAction[] = menu.type === "canvas"
        ? [
              { key: "add-text", label: translate("canvas.addTextNode"), icon: Type, run: () => onCreateNode("text") },
              { key: "add-image", label: translate("canvas.addImageNode"), icon: Image, run: () => onCreateNode("image") },
              { key: "add-audio", label: translate("canvas.addAudioNode"), icon: AudioLines, run: () => onCreateNode("audio") },
              { key: "add-video", label: translate("canvas.addVideoNode"), icon: Video, run: () => onCreateNode("video") },
              { key: "add-director-desk", label: translate("canvas.add3DDirectorDeskNode"), icon: Box, run: () => onCreateNode("directorDesk") },
          ]
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

    useLayoutEffect(() => {
        if (!nodeMenuOpen) return;
        const anchor = nodeMenuAnchorRef.current;
        const panel = nodeSubmenuRef.current;
        if (!anchor || !panel) return;
        const anchorRect = anchor.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        const margin = 8;
        const overflowsRight = anchorRect.right + panelRect.width > window.innerWidth - margin;
        const fitsLeft = anchorRect.left - panelRect.width >= margin;
        setNodeMenuSide(overflowsRight && fitsLeft ? "left" : "right");
    }, [nodeMenuOpen]);

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
            {menu.type === "canvas" ? (
                <div ref={nodeMenuAnchorRef} className="relative" onPointerEnter={() => setNodeMenuOpen(true)} onPointerLeave={() => setNodeMenuOpen(false)}>
                    <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={nodeMenuOpen} className={`${menuItemClassName} ${nodeMenuOpen ? "bg-black/5" : ""}`} style={{ color: theme.node.text }}>
                        <Plus className="size-4" />
                        <span className="min-w-0 flex-1">{translate("canvas.addNodeMenu")}</span>
                        <ChevronRight className="size-4" />
                    </button>
                    {nodeMenuOpen ? (
                        <div ref={nodeSubmenuRef} role="menu" aria-label={translate("canvas.addNodeMenu")} className="absolute top-0 z-[81] min-w-40 rounded-lg border p-1 shadow-xl" style={{ left: nodeMenuSide === "right" ? "100%" : "auto", right: nodeMenuSide === "left" ? "100%" : "auto", background: theme.node.panel, borderColor: theme.toolbar.border }}>
                            {nodeActions.map(renderAction)}
                        </div>
                    ) : null}
                </div>
            ) : null}
            {backgroundAction ? renderAction(backgroundAction) : null}
        </div>
    );
}
