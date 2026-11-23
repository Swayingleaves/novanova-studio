import { modelOptionName, resolveModelRequestConfig, type AiConfig, type VideoGenerationMode } from "@/features/settings/stores/use-config-store";
import { readVideoModelConfiguration } from "./video-generation-constraints";

/**
 * 视频模型的声音能力：switchable 接口能开关；always 接口没有开关、成片固定带声；none 不能出声；unknown 判断不了，按模型默认、不能开关。
 * 规则只在两处实现，改一边同步另一边：这里与后端 ai/VideoAudioSupport.java（依据见那边的类注释）。
 */
export type VideoAudioOutput = "switchable" | "always" | "none" | "unknown";

/** Seedance 1.0（pro / pro fast / lite）：无声模型。 */
const SEEDANCE_SILENT = /seedance-?1[-.]0(?!\d)/;
/** Seedance 1.5 pro、2.0、2.5 系列：generate_audio 可开关。 */
const SEEDANCE_AUDIBLE = /seedance-?(?:1[-.]5|2(?:[-.]\d)?)(?!\d)/;
/** 模型名里单独的 h3（MiniMax-H3、minimax-h3-reference-to-video、h3_video）。 */
const H3 = /(?:^|[^a-z0-9])h3(?:[^a-z0-9]|$)/;

/** 非自定义模型按渠道格式与模型名判断。 */
export function videoAudioOutput(apiFormat: string, model: string): VideoAudioOutput {
    const name = model.trim().toLowerCase();
    switch (apiFormat.trim().toLowerCase()) {
        case "agnes":
        case "minimax":
        case "wenew":
            return "always";
        case "seedance":
            return seedanceAudioOutput(name);
        case "evolink":
        case "newapi":
            return name.includes("seedance") ? seedanceAudioOutput(name) : alwaysAudible(name) ? "always" : "unknown";
        case "openai":
            return alwaysAudible(name) ? "always" : "unknown";
        default:
            return "unknown";
    }
}

/** 自定义模型约束里能填的值（不填为 unknown）。 */
export const CONFIGURABLE_VIDEO_AUDIO_OUTPUTS = ["switchable", "always", "none"] as const;

/** 当前（或指定）视频模型在当前（或指定）模式下的声音能力；自定义模型看该模式的「生成音频」约束，不看模型名。 */
export function readVideoAudioOutput(config: AiConfig, model = config.videoModel || config.model, mode: VideoGenerationMode = config.videoGenerationMode): VideoAudioOutput {
    const configuration = readVideoModelConfiguration(config, model);
    if (configuration?.isCustomModel) {
        const value = configuration.videoGenerationConstraints?.[mode]?.audioOutput;
        return value && (CONFIGURABLE_VIDEO_AUDIO_OUTPUTS as readonly string[]).includes(value) ? value : "unknown";
    }
    const resolved = resolveModelRequestConfig(config, model);
    return videoAudioOutput(resolved.apiFormat, modelOptionName(resolved.model));
}

/** 实际会不会出声：能开关时按设置（没设按开启），固定有声算开，不能出声算关，按模型默认时为 undefined。 */
export function videoAudioOn(config: AiConfig, model?: string, mode?: VideoGenerationMode): boolean | undefined {
    const output = readVideoAudioOutput(config, model, mode);
    if (output === "switchable") return String(config.videoAudio ?? "").trim().toLowerCase() !== "false";
    return output === "always" ? true : output === "none" ? false : undefined;
}

/** 任务参数里的生成音频：只有能开关的模型才带，其余按模型默认（服务端会拒绝关不掉、开不了的要求）。 */
export function videoAudioParameter(config: AiConfig, model?: string, mode?: VideoGenerationMode): { generateAudio?: boolean } {
    return readVideoAudioOutput(config, model, mode) === "switchable" ? { generateAudio: videoAudioOn(config, model, mode) !== false } : {};
}

function seedanceAudioOutput(name: string): VideoAudioOutput {
    if (SEEDANCE_SILENT.test(name)) return "none";
    return SEEDANCE_AUDIBLE.test(name) ? "switchable" : "unknown";
}

/** 中转渠道上认得出、固定带声的模型族：Agnes、H3、Sora。 */
function alwaysAudible(name: string) {
    return name.includes("agnes") || name.includes("sora") || H3.test(name);
}