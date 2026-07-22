import type { MouseEvent as ReactMouseEvent } from "react";

import { createCanvasConnectionPath, resolveCanvasConnectionAnchors } from "../domain/canvas-connection-geometry";
import type { CanvasConnection, CanvasNode, ConnectionHandle, CanvasPoint } from "../types";
import { useCanvasTheme } from "./canvas-theme-provider";

type ConnectionPathProps = {
    connection: CanvasConnection;
    from: CanvasNode;
    to: CanvasNode;
    active: boolean;
    onSelect: () => void;
    onContextMenu?: (event: ReactMouseEvent<SVGPathElement>) => void;
};

type ActiveConnectionPathProps = {
    node?: CanvasNode;
    handle: ConnectionHandle;
    mouseWorld: CanvasPoint;
    target?: CanvasNode;
};

export function ConnectionPath({ connection, from, to, active, onSelect, onContextMenu }: ConnectionPathProps) {
    const theme = useCanvasTheme();
    const path = createCanvasConnectionPath(resolveCanvasConnectionAnchors(from.frame, to.frame));
    const selectConnection = (event: ReactMouseEvent<SVGPathElement>) => {
        event.stopPropagation();
        onSelect();
    };
    const openConnectionMenu = (event: ReactMouseEvent<SVGPathElement>) => {
        event.preventDefault();
        event.stopPropagation();
        onContextMenu?.(event);
    };

    return (
        <g data-connection-id={connection.id}>
            <path d={path} fill="none" stroke="transparent" strokeWidth={18} className="cursor-pointer" style={{ pointerEvents: "stroke" }} onClick={selectConnection} onContextMenu={openConnectionMenu} />
            <path
                d={path}
                fill="none"
                stroke={active ? theme.node.activeStroke : theme.node.muted}
                strokeWidth={active ? 3 : 2}
                opacity={active ? 1 : 0.8}
                pointerEvents="none"
                style={active ? { filter: `drop-shadow(0 0 7px ${theme.node.activeStroke}70)` } : undefined}
            />
        </g>
    );
}

export function ActiveConnectionPath({ node, handle, mouseWorld, target }: ActiveConnectionPathProps) {
    const theme = useCanvasTheme();
    if (!node) return null;
    const anchors = resolveDraggingAnchors(node, handle, mouseWorld, target);
    return <path d={createCanvasConnectionPath({ ...anchors, minimumCurve: 0 })} fill="none" stroke={theme.node.activeStroke} strokeWidth={2} strokeDasharray="6 5" pointerEvents="none" />;
}

function resolveDraggingAnchors(node: CanvasNode, handle: ConnectionHandle, pointer: CanvasPoint, target?: CanvasNode) {
    const nodeAnchors = resolveCanvasConnectionAnchors(node.frame, node.frame);
    if (handle.handleType === "source") {
        return { start: nodeAnchors.start, end: target ? resolveCanvasConnectionAnchors(node.frame, target.frame).end : pointer };
    }
    return { start: target ? resolveCanvasConnectionAnchors(target.frame, node.frame).start : pointer, end: nodeAnchors.end };
}
