"use client";

import { Cog } from "lucide-react";

import type { AiConfig } from "@/features/settings/stores/use-config-store";
import { ImageSettingsPanel, imageQualityLabel, imageResolutionLabel, imageSizeLabel, normalizeImageGenerationCount } from "@/features/generation/components/image-settings-panel";
import { SettingsPopoverShell } from "./settings-popover-shell";
import { useCanvasTheme } from "./canvas-theme-provider";

type CanvasImageSettingsPopoverProps = {
    config: AiConfig;
    onConfigChange: (key: keyof AiConfig, value: string) => void;
    onOpenChange?: (open: boolean) => void;
    buttonClassName?: string;
    placement?: "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";
    autoAdjustOverflow?: boolean;
    getPopupContainer?: (triggerNode: HTMLElement) => HTMLElement;
};

export function CanvasImageSettingsPopover({
    config,
    onConfigChange,
    onOpenChange,
    buttonClassName,
    placement = "topLeft",
}: CanvasImageSettingsPopoverProps) {
    const theme = useCanvasTheme();
    const summary = buildImageSettingsSummary(config);

    return (
        <SettingsPopoverShell
            summary={summary}
            icon={<Cog className="size-3.5 shrink-0" />}
            buttonClassName={buttonClassName}
            placement={placement}
            onOpenChange={onOpenChange}
            width={420}
        >
            <ImageSettingsPanel
                config={config}
                onConfigChange={(key, value) => onConfigChange(key, value)}
                theme={theme}
                showTitle={false}
                className="space-y-3.5"
            />
        </SettingsPopoverShell>
    );
}

function buildImageSettingsSummary(config: AiConfig) {
    const quality = config.quality || "auto";
    const resolution = config.imageResolution || "2K";
    const size = config.size || "auto";
    const count = normalizeImageGenerationCount(config.count);
    return `${imageQualityLabel(quality)} · ${imageResolutionLabel(resolution)} · ${imageSizeLabel(size)} · ${count} 张`;
}
