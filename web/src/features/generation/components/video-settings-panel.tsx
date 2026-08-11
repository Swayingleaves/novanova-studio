"use client";

import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { Slider } from "antd";

import { ImageSettingsTheme } from "@/features/generation/components/image-settings-panel";
import { agnesVideoRatioOptions, isAgnesVideoConfig, normalizeAgnesVideoRatio, normalizeAgnesVideoResolution, normalizeAgnesVideoSeconds } from "@/features/generation/lib/agnes-video";
import { isMiniMaxH3VideoConfig, miniMaxH3ResolutionOptions, normalizeMiniMaxH3Duration, normalizeMiniMaxH3Ratio, normalizeMiniMaxH3Resolution, normalizeMiniMaxH3VideoSettings } from "@/features/generation/lib/minimax-h3-video";
import { isSeedanceFastModel, isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution } from "@/features/generation/lib/seedance-video";
import { readVideoDurationRange } from "@/features/generation/lib/video-duration";
import type { CanvasTheme } from "@/shared/lib/canvas-theme";
import { modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/features/settings/stores/use-config-store";

/** 视频设置面板支持的配置键。 */
type VideoConfigKey = "vquality" | "size" | "videoSeconds" | "videoWatermark";

type VideoSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: VideoConfigKey, value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    showDuration?: boolean;
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

const GENERIC_RESOLUTION_PRESETS = ["480P", "720P", "1080P", "4K"] as const;
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
export function VideoSettingsPanel({ config, onConfigChange, theme, showTitle = true, showDuration = true, className = "w-[388px] space-y-4 px-1 py-0.5", showCount = false, onCountChange }: VideoSettingsPanelProps) {
    const resolved = resolveModelRequestConfig(config, config.videoModel || config.model);
    const seedance = isSeedanceVideoConfig(resolved);
    const agnes = isAgnesVideoConfig(resolved);
    const miniMaxH3 = isMiniMaxH3VideoConfig(resolved);
    const model = modelOptionName(resolved.model || resolved.videoModel);
    const ratio = resolveRatio(resolved.size, seedance, agnes, miniMaxH3);
    const resolution = resolveResolution(resolved.vquality, model, seedance, agnes, miniMaxH3);
    const resolutionPresets = miniMaxH3 ? miniMaxH3ResolutionOptions : GENERIC_RESOLUTION_PRESETS;
    const durationRange = readVideoDurationRange(resolved);
    const seconds = resolveSeconds(resolved, seedance, agnes, miniMaxH3, durationRange);
    const [durationDraft, setDurationDraft] = useState(seconds);
    const count = normalizeVideoGenerationCount(config.canvasVideoCount);

    useEffect(() => setDurationDraft(seconds), [seconds]);

    useEffect(() => {
        if (!miniMaxH3) return;
        const normalized = normalizeMiniMaxH3VideoSettings(config.vquality, config.size, config.videoSeconds);
        if (normalized.vquality !== config.vquality) onConfigChange("vquality", normalized.vquality);
        if (normalized.size !== config.size) onConfigChange("size", normalized.size);
        if (normalized.videoSeconds !== config.videoSeconds) onConfigChange("videoSeconds", normalized.videoSeconds);
    }, [config.size, config.videoSeconds, config.vquality, miniMaxH3, onConfigChange]);

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

                <Field label="比例" theme={theme}>
                    <div className="grid grid-cols-5 gap-2">
                        {RATIO_PRESETS.map((preset) => {
                            const disabled = !supportsRatio(preset.value, seedance, agnes, miniMaxH3);
                            return <RatioButton key={preset.value} preset={preset} active={ratio === preset.value} disabled={disabled} theme={theme} onClick={() => updateRatio(preset.value)} />;
                        })}
                    </div>
                </Field>

                <Field label="清晰度" theme={theme}>
                    <div className={`grid gap-2 ${miniMaxH3 ? "grid-cols-2" : "grid-cols-4"}`}>
                        {resolutionPresets.map((item) => {
                            const displayItem = miniMaxH3 ? item.toUpperCase() : item;
                            const disabled = !miniMaxH3 && (item === "4K" || (item === "1080P" && seedance && isSeedanceFastModel(model)));
                            const disabledReason = item === "4K" ? "当前视频模型不支持 4K" : "当前 fast 模型不支持 1080P";
                            return (
                                <OptionButton key={item} active={resolution === displayItem} disabled={disabled} disabledReason={disabledReason} theme={theme} onClick={() => onConfigChange("vquality", item.toLowerCase())}>
                                    {displayItem}
                                </OptionButton>
                            );
                        })}
                    </div>
                </Field>

                {showDuration ? (
                    <Field label="视频时长" theme={theme}>
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

function resolveResolution(value: string, model: string, seedance: boolean, agnes: boolean, miniMaxH3: boolean): string {
    const normalized = miniMaxH3 ? normalizeMiniMaxH3Resolution(value) : seedance ? normalizeSeedanceResolution(value, model) : agnes ? normalizeAgnesVideoResolution(value) : `${normalizeVideoResolutionValue(value)}p`;
    const upper = normalized.toUpperCase();
    return miniMaxH3 || GENERIC_RESOLUTION_PRESETS.includes(upper as (typeof GENERIC_RESOLUTION_PRESETS)[number]) ? upper : "720P";
}

function resolveSeconds(config: AiConfig, seedance: boolean, agnes: boolean, miniMaxH3: boolean, range: { min: number; max: number }) {
    const raw = miniMaxH3 ? normalizeMiniMaxH3Duration(config.videoSeconds) : seedance ? normalizeSeedanceDuration(config.videoSeconds) : agnes ? Number(normalizeAgnesVideoSeconds(config.videoSeconds, config.vquality)) : Number(config.videoSeconds || 6);
    return Math.max(range.min, Math.min(range.max, raw));
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
