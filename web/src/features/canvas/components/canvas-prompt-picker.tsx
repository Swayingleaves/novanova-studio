"use client";

import { useState } from "react";
import { Button, Tooltip } from "antd";
import { LibraryBig } from "lucide-react";

import { PromptSelectDialog } from "@/features/prompts/components/prompt-select-dialog";
import { useCanvasTheme } from "./canvas-theme-provider";

type CanvasPromptPickerProps = { onChoose: (content: string) => void };

export function CanvasPromptPicker({ onChoose }: CanvasPromptPickerProps) {
    const theme = useCanvasTheme();
    const [open, setOpen] = useState(false);
    const choosePrompt = (content: string) => {
        onChoose(content);
        setOpen(false);
    };
    return <><Tooltip title="从提示词库选择"><Button type="text" shape="circle" size="small" aria-label="打开提示词库" icon={<LibraryBig className="size-4" />} style={{ color: theme.node.text }} onClick={() => setOpen(true)} /></Tooltip><PromptSelectDialog open={open} onOpenChange={setOpen} onSelect={choosePrompt} /></>;
}
