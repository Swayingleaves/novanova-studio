"use client";

import { useEffect, useRef, type ComponentType } from "react";
import { Copy, Frame, Image, Trash2, Type, Video } from "lucide-react";

import type { CanvasNodeKind, ContextMenuState } from "../types";
import { useCanvasTheme } from "./canvas-theme-provider";

type CanvasNodeContextMenuProps = { menu: ContextMenuState; onClose: () => void; onCreateNode: (kind: CanvasNodeKind) => void; onDuplicate: () => void; onDelete: () => void };
type MenuAction = { key: string; label: string; icon: ComponentType<{ className?: string }>; danger?: boolean; run: () => void };

export function CanvasNodeContextMenu({ menu, onClose, onCreateNode, onDuplicate, onDelete }: CanvasNodeContextMenuProps) {
    const theme = useCanvasTheme();
    const menuRef = useRef<HTMLDivElement>(null);
    const actions: MenuAction[] = menu.type === "canvas"
        ? [
              { key: "add-text", label: "添加文本节点", icon: Type, run: () => onCreateNode("text") },
              { key: "add-image", label: "添加图片节点", icon: Image, run: () => onCreateNode("image") },
              { key: "add-video", label: "添加视频节点", icon: Video, run: () => onCreateNode("video") },
              { key: "add-background", label: "添加背景板", icon: Frame, run: () => onCreateNode("background") },
          ]
        : [
              ...(menu.type === "node" ? [{ key: "duplicate", label: "创建副本", icon: Copy, run: onDuplicate }] : []),
              { key: "delete", label: menu.type === "selection" ? `删除选中节点（${menu.nodeIds.length}）` : menu.type === "node" ? "删除节点" : "删除连线", icon: Trash2, danger: true, run: onDelete },
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
        <div ref={menuRef} role="menu" aria-label={menu.type === "canvas" ? "添加画布节点" : menu.type === "node" ? "节点操作" : menu.type === "selection" ? "选中节点操作" : "连线操作"} className="fixed z-[80] min-w-40 rounded-lg border p-1 shadow-xl" style={{ left: menu.x, top: menu.y, background: theme.node.panel, borderColor: theme.toolbar.border }} onPointerDown={(event) => event.stopPropagation()}>
            {actions.map((action) => {
                const Icon = action.icon;
                return <button key={action.key} type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs transition hover:bg-black/5" style={{ color: action.danger ? "#ef4444" : theme.node.text }} onClick={action.run}><Icon className="size-4" />{action.label}</button>;
            })}
        </div>
    );
}
