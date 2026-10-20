"use client";
import { translateMessage as translate } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";


import { type MouseEvent, type ReactNode, useMemo } from "react";
import { ConfigProvider } from "antd";
import { IMAGE_ASPECT_RATIOS } from "@/features/generation/lib/image-size-mappings";

import type { CanvasTheme } from "@/shared/lib/canvas-theme";
import type { AiConfig } from "@/features/settings/stores/use-config-store";

/** 图片设置面板支持的配置键。 */
type ImageConfigKey = "quality" | "imageResolution" | "size" | "count";

type ImageSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: ImageConfigKey, value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    showCount?: boolean;
};

/** 图片画质选项。 */
const createQualityPresets = (translator: typeof translate = translate) => ([
    { value: "low", get label() { return translator("generation.lowQuality_ebe981"); } },
    { value: "medium", get label() { return translator("generation.standardQuality_3da00d"); } },
    { value: "high", get label() { return translator("generation.highQuality_f31c44"); } },
]);

/** 图片清晰度选项。 */
const RESOLUTION_PRESETS = ["1K", "2K", "4K"] as const;

/** 宽高比预设。 */
type RatioPreset = {
    value: string;
    label: string;
    w: number;
    h: number;
};

const RATIO_PRESETS: RatioPreset[] = IMAGE_ASPECT_RATIOS.map((value) => {
    const [w, h] = value.split(":").map(Number);
    return { value, label: value, w, h };
});

const IMAGE_COUNT_PRESETS = [1, 2, 4] as const;

export function ImageSettingsPanel({
    config,
    onConfigChange,
    theme,
    showTitle = true,
    className = "w-[320px] space-y-3.5 px-1 py-0.5",
    showCount = true,
}: ImageSettingsPanelProps) {
    const translate = useTranslation();
    const sizeRaw = config.size || "1:1";
    const matched = useMemo(() => matchRatio(sizeRaw), [sizeRaw, translate.locale]);
    const count = normalizeImageGenerationCount(config.count);
    const quality = config.quality || "medium";
    const imageResolution = normalizeImageResolution(config.imageResolution);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={stopAndBlur}>
                {showTitle ? <PanelHeading text={translate("generation.imageSettings")} theme={theme} /> : null}

                <Field label={translate("generation.quality")} theme={theme}>
                    <ChipRow columns={3} theme={theme}>
                        {createQualityPresets(translate).map((item) => (
                            <Chip key={item.value} active={quality === item.value} theme={theme} onMouseDown={stopDown} onClick={() => onConfigChange("quality", item.value)}>
                                {item.label}
                            </Chip>
                        ))}
                    </ChipRow>
                </Field>

                <Field label={translate("generation.resolution")} theme={theme}>
                    <ChipRow columns={3} theme={theme}>
                        {RESOLUTION_PRESETS.map((resolution) => (
                            <Chip key={resolution} active={imageResolution === resolution} theme={theme} onMouseDown={stopDown} onClick={() => onConfigChange("imageResolution", resolution)}>
                                {resolution}
                            </Chip>
                        ))}
                    </ChipRow>
                </Field>

                <Field label={translate("generation.aspectRatio")} theme={theme}>
                    <div className="grid grid-cols-5 gap-2">
                        {RATIO_PRESETS.map((preset) => {
                            const active = matched.value === preset.value;
                            return (
                                <button
                                    key={preset.value}
                                    type="button"
                                    className="flex h-20 flex-col items-center justify-center gap-1 rounded-lg border text-xs transition-colors"
                                    style={{ borderColor: active ? theme.node.activeStroke : theme.node.stroke, color: theme.node.text, background: active ? theme.node.fill : "transparent" }}
                                    onMouseDown={stopDown}
                                    onClick={() => onConfigChange("size", preset.value)}
                                >
                                    <RatioGlyph w={preset.w} h={preset.h} color={theme.node.text} />
                                    {preset.label}
                                </button>
                            );
                        })}
                    </div>
                </Field>

                {showCount ? (
                    <Field label={translate("generation.outputCount")} theme={theme}>
                        <div className="grid grid-cols-3 gap-2">
                            {IMAGE_COUNT_PRESETS.map((n) => (
                                <Chip key={n} active={count === n} theme={theme} onMouseDown={stopDown} onClick={() => onConfigChange("count", String(n))}>
                                    {n}{translate("generation.images")}</Chip>
                            ))}
                        </div>
                    </Field>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

/** 为子树内的 antd 控件注入画布主题 token。 */
export function ImageSettingsTheme({ theme, children }: { theme: CanvasTheme; children: ReactNode }) {
    return (
        <ConfigProvider
            theme={{
                token: {
                    colorBgContainer: theme.toolbar.panel,
                    colorBgElevated: theme.node.panel,
                    colorBorder: theme.node.stroke,
                    colorPrimary: theme.node.activeStroke,
                    colorText: theme.node.text,
                    colorTextLightSolid: "#ffffff",
                },
                components: {
                    Button: {
                        primaryColor: theme.toolbar.activeGradientText,
                        defaultBg: theme.toolbar.panel,
                        defaultBorderColor: theme.node.stroke,
                        defaultColor: theme.node.text,
                    },
                },
            }}
        >
            {children}
        </ConfigProvider>
    );
}

export function imageQualityLabel(value: string): string {
    return createQualityPresets().find((item) => item.value === value)?.label ?? value;
}

export function imageResolutionLabel(value: string): string {
    return normalizeImageResolution(value);
}

export function imageSizeLabel(size: string): string {
    return matchRatio(size).label ?? size;
}

// ---- 内部工具 ----

function PanelHeading({ text, theme }: { text: string; theme: CanvasTheme }) {
    return <div className="text-base font-semibold" style={{ color: theme.node.text }}>{text}</div>;
}

function Field({ label, theme, trailing, children }: { label: string; theme: CanvasTheme; trailing?: ReactNode; children: ReactNode }) {
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <span className="text-sm font-semibold" style={{ color: theme.node.muted }}>{label}</span>
                {trailing}
            </div>
            {children}
        </div>
    );
}

function ChipRow({ columns, theme: _theme, children }: { columns: number; theme: CanvasTheme; children: ReactNode }) {
    return <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>{children}</div>;
}

function Chip({ active, theme, onMouseDown, onClick, children }: { active: boolean; theme: CanvasTheme; onMouseDown: (e: MouseEvent) => void; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            className="h-10 rounded-lg border text-xs transition-colors"
            style={{ borderColor: active ? theme.node.activeStroke : theme.node.stroke, color: theme.node.text, background: active ? theme.node.fill : "transparent" }}
            onMouseDown={onMouseDown}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

/** 按真实宽高比绘制一个方框作为比例缩略。 */
function RatioGlyph({ w, h, color }: { w: number; h: number; color: string }) {
    if (!w || !h) return <span className="h-5 w-5" />;
    const r = w / h;
    const boxW = r >= 1 ? 22 : Math.max(8, 22 * r);
    const boxH = r >= 1 ? Math.max(8, 22 / r) : 22;
    return (
        <span className="grid h-5 w-6 place-items-center">
            <span className="rounded-[2px] border" style={{ width: boxW, height: boxH, borderColor: color }} />
        </span>
    );
}

function matchRatio(size: string): RatioPreset {
    return RATIO_PRESETS.find((preset) => preset.value === size) ?? RATIO_PRESETS[0];
}

export function normalizeImageGenerationCount(value: string | number): 1 | 2 | 4 {
    const count = Math.floor(Math.abs(Number(value)) || 1);
    return count === 2 || count === 4 ? count : 1;
}

function normalizeImageResolution(value: string): (typeof RESOLUTION_PRESETS)[number] {
    const normalized = value.toUpperCase();
    return RESOLUTION_PRESETS.includes(normalized as (typeof RESOLUTION_PRESETS)[number]) ? (normalized as (typeof RESOLUTION_PRESETS)[number]) : "2K";
}

function stopDown(event: MouseEvent) {
    event.stopPropagation();
}

function stopAndBlur(event: MouseEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (document.activeElement instanceof HTMLElement && event.currentTarget.contains(document.activeElement)) {
        document.activeElement.blur();
    }
}
