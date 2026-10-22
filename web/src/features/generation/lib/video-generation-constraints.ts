import { translateMessage as translate } from "@/features/locale/translate";
import type { AiConfig, VideoGenerationConstraints, VideoGenerationMode } from "@/features/settings/stores/use-config-store";

/** 比例值同时用于配置、任务参数和模板，自动比例统一使用 auto。 */
export const VIDEO_ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "auto"] as const;
export type VideoConstraintField = keyof VideoGenerationConstraints;
export type VideoConstraintIssue = { field: VideoConstraintField; message: string };

/** 读取选中模型的公开运行配置，不通过渠道格式推断自定义模型。 */
export function readVideoModelConfiguration(config: AiConfig, model = config.videoModel || config.model) {
    return config.videoModelBillingConfigurations.find((item) => item.model === model);
}

/** 返回约束配置字段的当前语言名称。 */
export function videoConstraintFieldLabel(field: VideoConstraintField) {
    return translate(`generation.videoConstraintField_${field}`);
}

/** 校验配置草稿，保留字段位置供表单显示错误。 */
export function videoConstraintConfigurationIssues(mode: VideoGenerationMode, constraints: VideoGenerationConstraints | null | undefined, audioEnabled: boolean, billingMinimum = 1): VideoConstraintIssue[] {
    const issues: VideoConstraintIssue[] = [];
    const add = (field: VideoConstraintField, message: string) => issues.push({ field, message });
    const fields: VideoConstraintField[] = ["minimumDurationSeconds", "maximumDurationSeconds", "minimumImageCount", "maximumImageCount"];
    if (mode === "reference-to-video") fields.push("maximumVideoCount", "maximumAudioCount");
    for (const field of fields) {
        const value = constraints?.[field];
        if (typeof value !== "number" || !Number.isSafeInteger(value) || value > 2147483647 || value < (field.includes("Duration") ? 1 : 0)) {
            add(field, translate("generation.videoConstraintInteger", { field: videoConstraintFieldLabel(field), minimum: field.includes("Duration") ? 1 : 0 }));
        }
    }
    const ratios = constraints?.supportedAspectRatios;
    if (!ratios?.length || ratios.some((ratio) => !VIDEO_ASPECT_RATIOS.includes(ratio as typeof VIDEO_ASPECT_RATIOS[number]))) {
        add("supportedAspectRatios", translate("generation.videoConstraintRatiosRequired"));
    }
    if (issues.length || !constraints) return issues;
    const { minimumDurationSeconds: minimum, maximumDurationSeconds: maximum, minimumImageCount: minimumImages, maximumImageCount: maximumImages } = constraints as Required<VideoGenerationConstraints>;
    if (minimum! > maximum!) add("maximumDurationSeconds", translate("generation.videoConstraintRangeOrder"));
    else if (Math.max(minimum!, billingMinimum) > maximum!) add("maximumDurationSeconds", translate("generation.videoConstraintBillingConflict", { minimum: billingMinimum }));
    if (minimumImages! > maximumImages!) add("maximumImageCount", translate("generation.videoConstraintRangeOrder"));
    if (mode === "text-to-video" && (minimumImages !== 0 || maximumImages !== 0)
        || mode === "first-last-frame-to-video" && (minimumImages !== 2 || maximumImages !== 2)
        || mode === "image-to-video" && minimumImages! < 1) add("minimumImageCount", translate("generation.videoConstraintImageModeConflict"));
    if (mode === "reference-to-video") {
        if (audioEnabled ? constraints.maximumAudioCount! < 1 : constraints.maximumAudioCount !== 0) add("maximumAudioCount", translate("generation.videoConstraintAudioSwitchConflict"));
        if (maximumImages! + constraints.maximumVideoCount! + constraints.maximumAudioCount! < 1) add("maximumImageCount", translate("generation.videoConstraintReferenceRequired"));
    }
    return issues;
}

/** 读取自定义模式限制，缺失值保持缺失以便明确报错。 */
export function readCustomVideoConstraints(config: AiConfig, mode = config.videoGenerationMode, model = config.videoModel || config.model) {
    return readVideoModelConfiguration(config, model)?.videoGenerationConstraints?.[mode];
}

type VideoConstraintInput = {
    config: AiConfig;
    model?: string;
    mode?: VideoGenerationMode;
    size?: string;
    seconds?: string | number;
    imageCount?: number;
    videoCount?: number;
    audioCount?: number;
    /** 添加素材时只校验上限，允许用户逐步补足最小数量。 */
    addingReferences?: boolean;
    /** 纯报价预览可以缺少素材，但已有素材仍需要满足上限。 */
    requireReferences?: boolean;
};

/** 按同一份公开配置检查参数和素材，非自定义模型继续使用既有协议规则。 */
export function readVideoGenerationConstraintIssue(input: VideoConstraintInput): string {
    const { config } = input;
    const model = readVideoModelConfiguration(config, input.model);
    if (!model?.isCustomModel) return "";
    const mode = input.mode || config.videoGenerationMode;
    if (!model.capabilities.includes(mode)) return translate("generation.selectedVideoModeIsNotConfigured");
    const constraints = model.videoGenerationConstraints?.[mode];
    const configurationIssue = videoConstraintConfigurationIssues(mode, constraints, model.capabilities.includes("audio-input"), model.videoBillingConfiguration?.minimumDurationSeconds || 1)[0];
    if (configurationIssue || !constraints) return translate("generation.videoConstraintConfigurationMissing", { mode, reason: configurationIssue?.message || "" });
    if (!input.addingReferences) {
        const minimum = Math.max(constraints.minimumDurationSeconds!, model.videoBillingConfiguration?.minimumDurationSeconds || 1);
        const seconds = Number(input.seconds ?? config.videoSeconds);
        if (!Number.isSafeInteger(seconds) || seconds < minimum || seconds > constraints.maximumDurationSeconds!) return translate("generation.videoConstraintDurationRange", { minimum, maximum: constraints.maximumDurationSeconds!, current: String(input.seconds ?? config.videoSeconds) });
        const size = input.size ?? config.size;
        if (!constraints.supportedAspectRatios!.includes(size)) return translate("generation.videoConstraintAspectRatio", { supported: constraints.supportedAspectRatios!.map((ratio) => ratio === "auto" ? translate("generation.videoConstraintAutomatic") : ratio).join("、"), current: size });
    }
    const images = input.imageCount ?? 0;
    const videos = input.videoCount ?? 0;
    const audios = input.audioCount ?? 0;
    if (images > constraints.maximumImageCount! || !input.addingReferences && input.requireReferences !== false && images < constraints.minimumImageCount!) return translate("generation.videoConstraintImageRange", { minimum: constraints.minimumImageCount!, maximum: constraints.maximumImageCount!, current: images });
    if (mode === "reference-to-video") {
        if (videos > constraints.maximumVideoCount!) return translate("generation.videoConstraintVideoMaximum", { maximum: constraints.maximumVideoCount!, current: videos });
        if (audios > constraints.maximumAudioCount!) return translate("generation.videoConstraintAudioMaximum", { maximum: constraints.maximumAudioCount!, current: audios });
    }
    if (!input.addingReferences && input.requireReferences !== false && mode === "reference-to-video" && images + videos + audios === 0) return translate("generation.universalReferenceNeedsAtLeastOneAsset");
    if (mode !== "reference-to-video" && videos > 0) return translate("generation.imageToVideoCannotIncludeVideoReferences");
    if (mode !== "reference-to-video" && audios > 0) return translate("generation.audioInputRequiresUniversalReferenceMode");
    return "";
}
