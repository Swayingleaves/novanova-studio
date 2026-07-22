import type { ReactNode } from "react";
import { Button, Tooltip } from "antd";
import { Eraser, FolderOpen, Hand, Image as ImageIcon, Redo2, Trash2, Type, Undo2, Upload, Video } from "lucide-react";

import type { CanvasTheme } from "@/shared/lib/canvas-theme";
import { useCanvasTheme } from "./canvas-theme-provider";

type ToolButtonStyle = {
    background?: string;
    color?: string;
    opacity?: number;
};

type CanvasToolbarProps = {
    selectedCount: number;
    canUndo: boolean;
    canRedo: boolean;
    onAddImage: () => void;
    onAddVideo: () => void;
    onAddText: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onUpload: () => void;
    onDelete: () => void;
    onClear: () => void;
    onDeselect: () => void;
    onOpenMyAssets: () => void;
};

type ToolbarAction = {
    key: string;
    label: string;
    icon: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    danger?: boolean;
    active?: boolean;
    dividerBefore?: boolean;
};

export function CanvasToolbar(props: CanvasToolbarProps) {
    const theme = useCanvasTheme();
    const toolActions = buildToolbarActions(props);

    return (
        <div
            className="absolute bottom-5 left-1/2 z-50 flex h-10 max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-xl px-1 thin-scrollbar [&>*]:shrink-0"
            style={{ background: theme.toolbar.panel, boxShadow: "0 10px 30px rgba(28,25,23,.10)" }}
        >
            {toolActions.map((action) => (
                <ToolbarActionItem key={action.key} action={action} />
            ))}
        </div>
    );
}

function buildToolbarActions(props: CanvasToolbarProps): ToolbarAction[] {
    const actions: ToolbarAction[] = [
        { key: "move", label: "移动/选择", icon: <Hand className="size-4" />, active: !props.selectedCount, onClick: props.onDeselect },
        { key: "undo", label: "撤销", icon: <Undo2 className="size-4" />, disabled: !props.canUndo, onClick: props.onUndo },
        { key: "redo", label: "重做", icon: <Redo2 className="size-4" />, disabled: !props.canRedo, onClick: props.onRedo, dividerBefore: false },
        { key: "text", label: "文本", icon: <Type className="size-4" />, dividerBefore: true, onClick: props.onAddText },
        { key: "image", label: "图片", icon: <ImageIcon className="size-4" />, onClick: props.onAddImage },
        { key: "video", label: "视频", icon: <Video className="size-4" />, onClick: props.onAddVideo },
        { key: "upload", label: "上传素材", icon: <Upload className="size-4" />, onClick: props.onUpload },
        { key: "assets", label: "我的资产", icon: <FolderOpen className="size-4" />, dividerBefore: true, onClick: props.onOpenMyAssets },
    ];

    if (props.selectedCount) {
        actions.push({
            key: "delete",
            label: `删除选中 ${props.selectedCount}`,
            icon: <Trash2 className="size-4" />,
            dividerBefore: true,
            danger: true,
            onClick: props.onDelete,
        });
    }

    actions.push({
        key: "clear",
        label: "清空画布",
        icon: <Eraser className="size-4" />,
        dividerBefore: true,
        danger: true,
        onClick: props.onClear,
    });

    return actions;
}

function ToolbarActionItem({ action }: { action: ToolbarAction }) {
    const theme = useCanvasTheme();

    return (
        <>
            {action.dividerBefore ? <ToolbarDivider /> : null}
            <Tooltip title={action.label} placement="top" mouseEnterDelay={0.4}>
                <Button
                    type="text"
                    aria-label={action.label}
                    className="!h-8 !w-8 !min-w-8 !p-0 transition-colors"
                    disabled={action.disabled}
                    style={resolveToolbarButtonStyle(action, theme)}
                    icon={action.icon}
                    onClick={action.onClick}
                    onMouseEnter={(event) => applyToolbarHover(event.currentTarget, action, theme)}
                    onMouseLeave={(event) => clearToolbarHover(event.currentTarget)}
                />
            </Tooltip>
        </>
    );
}

function ToolbarDivider() {
    const theme = useCanvasTheme();
    return <div className="mx-1 h-5 w-px" style={{ background: theme.toolbar.border }} />;
}

function resolveToolbarButtonStyle(action: ToolbarAction, theme: CanvasTheme): ToolButtonStyle {
    if (action.active) {
        return {
            background: theme.toolbar.activeBg,
            color: theme.toolbar.activeText,
        };
    }
    if (action.disabled) {
        return {
            color: theme.toolbar.item,
            opacity: 0.3,
        };
    }
    return {
        color: action.danger ? "#f87171" : theme.toolbar.item,
    };
}

function applyToolbarHover(element: HTMLElement, action: ToolbarAction, theme: CanvasTheme) {
    if (action.disabled || action.active) return;
    element.style.background = theme.toolbar.itemHover;
    if (!action.danger) {
        element.style.color = theme.toolbar.activeText;
    }
}

function clearToolbarHover(element: HTMLElement) {
    element.style.background = "transparent";
}
