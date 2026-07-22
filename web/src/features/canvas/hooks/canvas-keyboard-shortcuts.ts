import { useEffect } from "react";

export type CanvasKeyboardCommand = "undo" | "redo" | "selectAll" | "copy" | "paste" | "delete" | "cancel";

export type CanvasKeyboardInput = {
    key: string;
    control: boolean;
    meta: boolean;
    alt: boolean;
    shift: boolean;
};

type CanvasKeyboardHandlers = Record<CanvasKeyboardCommand, () => void>;

const MODIFIER_COMMANDS: Record<string, CanvasKeyboardCommand> = {
    a: "selectAll",
    c: "copy",
    v: "paste",
    y: "redo",
};

export function resolveCanvasKeyboardCommand(input: CanvasKeyboardInput): CanvasKeyboardCommand | null {
    const key = input.key.toLowerCase();
    const hasPrimaryModifier = input.control || input.meta;
    if (hasPrimaryModifier && !input.alt) {
        if (key === "z") return input.shift ? "redo" : "undo";
        return MODIFIER_COMMANDS[key] || null;
    }
    if (input.key === "Delete" || input.key === "Backspace") return "delete";
    if (input.key === "Escape") return "cancel";
    return null;
}

export function useCanvasKeyboardShortcuts(handlers: CanvasKeyboardHandlers): void {
    useEffect(() => {
        const executeCommand = (event: KeyboardEvent) => {
            const command = resolveCanvasKeyboardCommand({
                key: event.key,
                control: event.ctrlKey,
                meta: event.metaKey,
                alt: event.altKey,
                shift: event.shiftKey,
            });
            if (!command) return;
            if (shouldPreserveNativeKeyboardBehavior(event, command)) return;
            event.preventDefault();
            handlers[command]();
        };

        window.addEventListener("keydown", executeCommand);
        return () => window.removeEventListener("keydown", executeCommand);
    }, [handlers]);
}

function shouldPreserveNativeKeyboardBehavior(event: KeyboardEvent, command: CanvasKeyboardCommand): boolean {
    if (isEditableKeyboardTarget(event.target)) return true;
    if (event.target instanceof Element && event.target.closest("[data-agent-panel]")) return true;
    return command === "copy" && Boolean(window.getSelection()?.toString());
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
    return Boolean(target.closest("[contenteditable='true'],[data-canvas-no-zoom]"));
}
