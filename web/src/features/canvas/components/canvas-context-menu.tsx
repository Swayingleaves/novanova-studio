"use client";
import { useTranslation } from "@/features/locale/use-translation";


import { useEffect, useRef, type ComponentType } from "react";
import { Box, Copy, Frame, Image, Trash2, Type, AudioLines, Video } from "lucide-react";

import type { CanvasNodeKind, ContextMenuState } from "../types";
import { useCanvasTheme } from "./canvas-theme-provider";

type CanvasNodeContextMenuProps = { menu: ContextMenuState; onClose: () => void; onCreateNode: (kind: CanvasNodeKind) => void; onDuplicate: () => void; onDelete: () => void; onDeleteBackgroundOnly: () => void; onAddToBackground: (nodeIds: string[]) => void };
type MenuAction = { key: string; label: string; icon: ComponentType<{ className?: string }>; danger?: boolean; run: () => void };

export function CanvasNodeContextMenu({ menu, onClose, onCreateNode, onDuplicate, onDelete, onDeleteBackgroundOnly, onAddToBackground }: CanvasNodeContextMenuProps) {
    const translate = useTranslation();
    const theme = useCanvasTheme();
    const menuRef = useRef<HTMLDivElement>(null);
    const actions: MenuAction[] = menu.type === "canvas"
        ? [
              { key: "add-text", label: translate("canvas.addTextNode"), icon: Type, run: () => onCreateNode("text") },
              { key: "add-image", label: translate("canvas.addImageNode"), icon: Image, run: () => onCreateNode("image") },
              { key: "add-audio", label: translate("canvas.addAudioNode"), icon: AudioLines, run: () => onCreateNode("audio") },
              { key: "add-video", label: translate("canvas.addVideoNode"), icon: Video, run: () => onCreateNode("video") },
              { key: "add-director-desk", label: translate("canvas.add3DDirectorDeskNode"), icon: Box, run: () => onCreateNode("directorDesk") },
              { key: "add-background", label: translate("canvas.addBackground"), icon: Frame, run: () => onCreateNode("background") },
          ]
        : [
              ...(menu.type === "node" ? [{ key: "duplicate", label: translate("canvas.duplicate"), icon: Copy, run: onDuplicate }] : []),
              ...(menu.type === "selection" ? [{ key: "add-to-background", label: translate("canvas.addToBackground", { value0: menu.nodeIds.length }), icon: Frame, run: () => onAddToBackground(menu.nodeIds) }] : []),
              ...(menu.type === "node" && menu.nodeKind === "background" ? [{ key: "delete-background-only", label: translate("canvas.deleteBackgroundOnly"), icon: Trash2, danger: true, run: onDeleteBackgroundOnly }] : []),
              { key: "delete", label: menu.type === "selection" ? translate("canvas.deleteSelectedNodes", { value0: menu.nodeIds.length }) : menu.type === "node" ? translate("canvas.deleteNode") : translate("canvas.deleteConnection"), icon: Trash2, danger: true, run: onDelete },
          ];

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

    return (
        <div ref={menuRef} role="menu" aria-label={menu.type === "canvas" ? translate("canvas.addCanvasNode") : menu.type === "node" ? translate("canvas.nodeActions") : menu.type === "selection" ? translate("canvas.selectedNodeActions") : translate("canvas.connectionActions")} className="fixed z-[80] min-w-40 rounded-lg border p-1 shadow-xl" style={{ left: menu.x, top: menu.y, background: theme.node.panel, borderColor: theme.toolbar.border }} onPointerDown={(event) => event.stopPropagation()}>
            {actions.map((action) => {
                const Icon = action.icon;
                return <button key={action.key} type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs transition hover:bg-black/5" style={{ color: action.danger ? "#ef4444" : theme.node.text }} onClick={action.run}><Icon className="size-4" />{action.label}</button>;
            })}
        </div>
    );
}
