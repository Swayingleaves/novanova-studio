"use client";
import { translateMessage as translate } from "@/features/locale/translate";


import { Cog } from "lucide-react";

import { normalizeVideoGenerationCount, VideoSettingsPanel, videoResolutionLabel, videoSecondsLabel, videoSizeLabel } from "@/features/generation/components/video-settings-panel";
import type { AiConfig } from "@/features/settings/stores/use-config-store";
import { SettingsPopoverShell } from "./settings-popover-shell";
import { useCanvasTheme } from "./canvas-theme-provider";

type CanvasVideoSettingsPopoverProps = {
    config: AiConfig;
    onConfigChange: (key: keyof AiConfig, value: string) => void;
    buttonClassName?: string;
    placement?: "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";
};

export function CanvasVideoSettingsPopover({
    config,
    onConfigChange,
    buttonClassName,
    placement = "topLeft",
}: CanvasVideoSettingsPopoverProps) {
    const theme = useCanvasTheme();

    return (
        <SettingsPopoverShell
            summary={buildVideoSettingsSummary(config)}
            icon={<Cog className="size-3.5 shrink-0" />}
            buttonClassName={buttonClassName}
            placement={placement}
            width={420}
        >
            <VideoSettingsPanel
                config={config}
                onConfigChange={(key, value) => onConfigChange(key, value)}
                theme={theme}
                showTitle={false}
                showCount
                onCountChange={(value) => onConfigChange("canvasVideoCount", value)}
                className="space-y-4"
            />
        </SettingsPopoverShell>
    );
}

function buildVideoSettingsSummary(config: AiConfig) {
    return translate("canvas.items", { value0: videoResolutionLabel(config.vquality), value1: videoSizeLabel(config.size), value2: videoSecondsLabel(config.videoSeconds, config), value3: normalizeVideoGenerationCount(config.canvasVideoCount) });
}
