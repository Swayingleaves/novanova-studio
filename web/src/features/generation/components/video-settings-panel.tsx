"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Segmented, Slider } from "antd";

import { ImageSettingsTheme } from "@/features/generation/components/image-settings-panel";
import { agnesVideoRatioOptions, isAgnesVideoConfig, normalizeAgnesVideoRatio, normalizeAgnesVideoSeconds } from "@/features/generation/lib/agnes-video";
import { isMiniMaxH3VideoConfig, normalizeMiniMaxH3Duration, normalizeMiniMaxH3Ratio } from "@/features/generation/lib/minimax-h3-video";
import { isSeedanceVideoConfig, normalizeSeedanceRatio } from "@/features/generation/lib/seedance-video";
import { readVideoDurationRange } from "@/features/generation/lib/video-duration";
import { VIDEO_GENERATION_MODE_OPTIONS, VIDEO_RESOLUTION_OPTIONS, availableVideoResolutions } from "@/features/generation/lib/video-billing";
import type { CanvasTheme } from "@/shared/lib/canvas-theme";
import { resolveModelRequestConfig, type AiConfig, type VideoResolution } from "@/features/settings/stores/use-config-store";

/** 视频设置面板支持的配置键。 */
type VideoConfigKey = "videoGenerationMode" | "vquality" | "size" | "videoSeconds" | "videoWatermark";

type VideoSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: VideoConfigKey, value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    showGenerationMode?: boolean;
    showDuration?: boolean;
    resolutionOptions?: VideoResolution[];
    className?: string;
    showCount?: boolean;
    onCountChange?: (value: string) => void;
};

type RatioPreset = {
    value: "adaptive" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16" | "21:9";
    label: string;
    width: number;
    height: number;
};

const RATIO_PRESETS: RatioPreset[] = [
    { value: "adaptive", label: "Auto", width: 16, height: 9 },
    { value: "16:9", label: "16:9", width: 16, height: 9 },
    { value: "4:3", label: "4:3", width: 4, height: 3 },
    { value: "1:1", label: "1:1", width: 1, height: 1 },
    { value: "3:4", label: "3:4", width: 3, height: 4 },
    { value: "9:16", label: "9:16", width: 9, height: 16 },
    { value: "21:9", label: "21:9", width: 21, height: 9 },
];

const VIDEO_COUNT_PRESETS = [1, 2, 4] as const;
const AGNES_RATIOS = new Set<string>(agnesVideoRatioOptions.map((item) => item.value));
const GENERIC_SIZE_BY_RATIO: Record<RatioPreset["value"], string> = {
    adaptive: "auto",
    "16:9": "1280x720",
    "4:3": "960x720",
    "1:1": "720x720",
    "3:4": "720x960",
    "9:16": "720x1280",
    "21:9": "1680x720",
};

/** 渲染统一的视频设置面板，并按当前模型禁用不支持的配置。 */
export function VideoSettingsPanel({
    config,
    onConfigChange,
    theme,
    showTitle = true,
    showGenerationMode = true,
    showDuration = true,
    resolutionOptions,
    className = "w-[388px] space-y-4 px-1 py-0.5",
    showCount = false,
    onCountChange,
}: VideoSettingsPanelProps) {
    const resolved = resolveModelRequestConfig(config, config.videoModel || config.model);
    const seedance = isSeedanceVideoConfig(resolved);
    const agnes = isAgnesVideoConfig(resolved);
    const miniMaxH3 = isMiniMaxH3VideoConfig(resolved);
    const ratio = resolveRatio(resolved.size, seedance, agnes, miniMaxH3);
    const resolution = normalizeConfiguredResolution(resolved.vquality);
    const pricedResolutions = resolutionOptions || availableVideoResolutions(config, config.videoModel || config.model, config.videoGenerationMode);
    const resolutionPresets = [
        ...VIDEO_RESOLUTION_OPTIONS.filter((item) => pricedResolutions.includes(item.value)),
        ...(!pricedResolutions.includes(resolution as (typeof pricedResolutions)[number]) && VIDEO_RESOLUTION_OPTIONS.some((item) => item.value === resolution) ? VIDEO_RESOLUTION_OPTIONS.filter((item) => item.value === resolution) : []),
    ];
    const providerDurationRange = readVideoDurationRange(resolved);
    const billingMinimumDuration = config.videoModelBillingConfigurations.find((item) => item.model === (config.videoModel || config.model))?.videoBillingConfiguration?.minimumDurationSeconds || 1;
    const durationRange = { min: Math.max(providerDurationRange.min, billingMinimumDuration), max: providerDurationRange.max };
    const durationRangeAvailable = durationRange.min <= durationRange.max;
    const displayDurationRange = durationRangeAvailable ? durationRange : providerDurationRange;
    const seconds = resolveSeconds(resolved, seedance, agnes, miniMaxH3, displayDurationRange);
    const [durationDraft, setDurationDraft] = useState(seconds);
    const count = normalizeVideoGenerationCount(config.canvasVideoCount);

    useEffect(() => setDurationDraft(seconds), [seconds]);

    // 切换视频模型或生成模式后，当前分辨率可能不在新模型/模式的计费档位内，
    // 此时自动回退到首个可用分辨率，避免残留旧分辨率触发“当前模式未配置所选分辨率价格”。
    const previousModelMode = useRef<{ model: string; mode: VideoGenerationMode } | null>(null);
    useEffect(() => {
        const currentModel = config.videoModel || config.model;
        const currentMode = config.videoGenerationMode;
        const previous = previousModelMode.current;
        previousModelMode.current = { model: currentModel, mode: currentMode };
        if (!previous) return;
        if (previous.model === currentModel && previous.mode === currentMode) return;
        if (pricedResolutions.length === 0) return;
        if (!pricedResolutions.includes(resolution as VideoResolution)) {
            onConfigChange("vquality", pricedResolutions[0]);
        }
    }, [config.videoModel, config.videoGenerationMode, config.model, pricedResolutions, resolution, onConfigChange]);

    const commitDuration = (value: number) => {
        const normalized = String(normalizeDurationDraft(String(value), durationRange));
        if (normalized === config.videoSeconds) return;
        onConfigChange("videoSeconds", normalized);
    };

    const updateRatio = (value: RatioPreset["value"]) => {
        onConfigChange("size", seedance || agnes || miniMaxH3 ? value : GENERIC_SIZE_BY_RATIO[value]);
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={stopDown}>
                {showTitle ? <div className="text-base font-semibold">视频设置</div> : null}

                {showGenerationMode ? (
                    <Field label="生成模式" theme={theme}>
                        <Segmented block options={VIDEO_GENERATION_MODE_OPTIONS} value={config.videoGenerationMode} onChange={(value) => onConfigChange("videoGenerationMode", String(value))} />
                    </Field>
                ) : null}

                <Field label="比例" theme={theme}>
                    <div className="grid grid-cols-5 gap-2">
                        {RATIO_PRESETS.map((preset) => {
                            const disabled = !supportsRatio(preset.value, seedance, agnes, miniMaxH3);
                            return <RatioButton key={preset.value} preset={preset} active={ratio === preset.value} disabled={disabled} theme={theme} onClick={() => updateRatio(preset.value)} />;
                        })}
                    </div>
                </Field>

                <Field label="清晰度" theme={theme}>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {resolutionPresets.map((item) => {
                            const displayItem = item.label;
                            const configured = pricedResolutions.includes(item.value);
                            const disabled = !configured;
                            const disabledReason = "当前模式未配置该分辨率价格";
                            return (
                                <OptionButton key={item.value} active={resolution === item.value} disabled={disabled} disabledReason={disabledReason} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>
                                    {displayItem}
                                </OptionButton>
                            );
                        })}
                        {!resolutionPresets.length ? (
                            <span className="text-xs" style={{ color: theme.node.muted }}>
                                当前模式没有可用分辨率价格
                            </span>
                        ) : null}
                    </div>
                </Field>

                {showDuration ? (
                    <Field label="视频时长" theme={theme}>
                        {!durationRangeAvailable ? (
                            <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                                当前配置要求最少生成 {durationRange.min} 秒，但该模型最多支持 {durationRange.max} 秒，暂时无法生成
                            </div>
                        ) : (
                            <div className="flex h-8 items-center gap-3">
                                <div className="min-w-0 flex-1 px-0.5" onMouseDown={stopDown}>
                                    <Slider min={durationRange.min} max={durationRange.max} step={1} tooltip={{ open: false }} value={durationDraft} onChange={setDurationDraft} onChangeComplete={commitDuration} />
                                </div>
                                <input
                                    type="number"
                                    min={durationRange.min}
                                    max={durationRange.max}
                                    value={durationDraft}
                                    aria-label="视频时长"
                                    className="h-8 w-14 rounded-lg border bg-transparent px-2 text-center text-sm font-medium outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                    style={{ borderColor: theme.node.stroke, color: theme.node.text, background: theme.node.fill }}
                                    onMouseDown={stopDown}
                                    onChange={(event) => setDurationDraft(normalizeDurationDraft(event.currentTarget.value, durationRange))}
                                    onBlur={() => commitDuration(durationDraft)}
                                    onKeyDown={(event) => {
                                        if (event.key !== "Enter") return;
                                        event.currentTarget.blur();
                                    }}
                                />
                                <span className="text-sm" style={{ color: theme.node.muted }}>
                                    s
                                </span>
                            </div>
                        )}
                    </Field>
                ) : null}

                {showCount ? (
                    <Field label="生成数量" theme={theme}>
                        <div className="grid grid-cols-3 gap-2">
                            {VIDEO_COUNT_PRESETS.map((item) => (
                                <OptionButton key={item} active={count === item} theme={theme} onClick={() => onCountChange?.(String(item))}>
                                    {item}个
                                </OptionButton>
                            ))}
                        </div>
                    </Field>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

function Field({ label, theme, children }: { label: string; theme: CanvasTheme; children: ReactNode }) {
    return (
        <div className="space-y-2">
            <div className="text-sm font-semibold" style={{ color: theme.node.muted }}>
                {label}
            </div>
            {children}
        </div>
    );
}

function RatioButton({ preset, active, disabled, theme, onClick }: { preset: RatioPreset; active: boolean; disabled: boolean; theme: CanvasTheme; onClick: () => void }) {
    return (
        <button
            type="button"
            disabled={disabled}
            title={disabled ? "当前视频模型不支持该比例" : undefined}
            className="flex h-[78px] min-w-0 flex-col items-center justify-center gap-2 rounded-lg border text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-35"
            style={{ borderColor: active ? theme.node.activeStroke : theme.node.stroke, color: theme.node.text, background: active ? theme.node.fill : "transparent" }}
            onMouseDown={stopDown}
            onClick={onClick}
        >
            <RatioGlyph width={preset.width} height={preset.height} color={theme.node.text} />
            <span>{preset.label}</span>
        </button>
    );
}

function OptionButton({ active, disabled = false, disabledReason, theme, onClick, children }: { active: boolean; disabled?: boolean; disabledReason?: string; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            disabled={disabled}
            title={disabled ? disabledReason : undefined}
            className="h-10 rounded-lg border text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35"
            style={{ borderColor: active ? theme.node.activeStroke : theme.node.stroke, color: theme.node.text, background: active ? theme.node.fill : "transparent" }}
            onMouseDown={stopDown}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function RatioGlyph({ width, height, color }: { width: number; height: number; color: string }) {
    const ratio = width / height;
    const glyphWidth = ratio >= 1 ? 18 : Math.max(7, 18 * ratio);
    const glyphHeight = ratio >= 1 ? Math.max(7, 18 / ratio) : 18;
    return (
        <span className="grid h-5 w-6 place-items-center">
            <span className="rounded-[2px] border" style={{ width: glyphWidth, height: glyphHeight, borderColor: color }} />
        </span>
    );
}

function resolveRatio(size: string, seedance: boolean, agnes: boolean, miniMaxH3: boolean): RatioPreset["value"] {
    if (seedance) return normalizeSeedanceRatio(size) as RatioPreset["value"];
    if (agnes) return normalizeAgnesVideoRatio(size);
    if (miniMaxH3) return normalizeMiniMaxH3Ratio(size);
    if (size === "auto") return "adaptive";
    const matched = Object.entries(GENERIC_SIZE_BY_RATIO).find(([, value]) => value === size)?.[0];
    if (matched) return matched as RatioPreset["value"];
    const dimensions = size.match(/^(\d+)x(\d+)$/);
    if (!dimensions) return "16:9";
    return nearestRatio(Number(dimensions[1]) / Number(dimensions[2]));
}

function normalizeConfiguredResolution(value: string) {
    const normalized = value.trim().toLowerCase();
    if (normalized === "768") return "768p";
    if (normalized === "1080") return "1080p";
    if (normalized === "480") return "480p";
    if (normalized === "720") return "720p";
    if (normalized === "2160p") return "4k";
    return normalized;
}

function resolveSeconds(config: AiConfig, _seedance: boolean, _agnes: boolean, _miniMaxH3: boolean, range: { min: number; max: number }) {
    const raw = Number(config.videoSeconds);
    return Number.isSafeInteger(raw) ? raw : range.min;
}

function supportsRatio(ratio: RatioPreset["value"], seedance: boolean, agnes: boolean, miniMaxH3: boolean) {
    if (seedance || miniMaxH3) return true;
    if (agnes) return AGNES_RATIOS.has(ratio);
    return true;
}

function nearestRatio(value: number): RatioPreset["value"] {
    return RATIO_PRESETS.filter((item) => item.value !== "adaptive").reduce((best, item) => (Math.abs(item.width / item.height - value) < Math.abs(best.width / best.height - value) ? item : best)).value;
}

function normalizeDurationDraft(value: string, range: { min: number; max: number }) {
    const seconds = Math.floor(Number(value) || range.min);
    return Math.max(range.min, Math.min(range.max, seconds));
}

function stopDown(event: MouseEvent) {
    event.stopPropagation();
}

export function normalizeVideoGenerationCount(value: string | number): 1 | 2 | 4 {
    const count = Math.floor(Math.abs(Number(value)) || 1);
    return count === 2 || count === 4 ? count : 1;
}

export function videoResolutionLabel(value: string): string {
    const normalizedValue = value.trim().toLowerCase();
    if (normalizedValue === "auto") return "Auto";
    if (normalizedValue === "2k") return "2K";
    if (normalizedValue === "768p" || normalizedValue === "768") return "768P";
    const normalized = normalizeVideoResolutionValue(value);
    return normalized.toUpperCase() === "4K" ? "4K" : `${normalized}p`;
}

export function videoSizeLabel(value: string): string {
    if (value === "adaptive" || value === "auto") return "Auto";
    const ratio = RATIO_PRESETS.find((item) => item.value === value);
    if (ratio) return ratio.label;
    const genericRatio = Object.entries(GENERIC_SIZE_BY_RATIO).find(([, size]) => size === value)?.[0];
    return genericRatio === "adaptive" ? "Auto" : genericRatio || value;
}

export function videoSecondsLabel(value: string, config?: AiConfig): string {
    if (String(value).trim() === "-1") return "智能";
    if (config && isMiniMaxH3VideoConfig(config)) return `${normalizeMiniMaxH3Duration(value)}s`;
    if (config && isAgnesVideoConfig(config)) return `${normalizeAgnesVideoSeconds(value, config.vquality)}s`;
    return `${Math.max(1, Math.min(15, Math.floor(Number(value) || 6)))}s`;
}

export function normalizeVideoSizeValue(value: string): string {
    if (value === "auto") return "auto";
    if (/^\d+x\d+$/.test(value || "")) return value;
    return GENERIC_SIZE_BY_RATIO[value as RatioPreset["value"]] || GENERIC_SIZE_BY_RATIO["16:9"];
}

export function normalizeVideoResolutionValue(value: string): string {
    const normalized = value.toLowerCase();
    if (normalized === "480p" || normalized === "low") return "480";
    if (normalized === "720p" || normalized === "auto" || normalized === "high" || normalized === "medium") return "720";
    if (normalized === "4k" || normalized === "2160p") return "4K";
    return normalized.replace(/p$/i, "") || "720";
}
