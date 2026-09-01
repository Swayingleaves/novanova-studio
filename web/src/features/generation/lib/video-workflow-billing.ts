import type { AiConfig, VideoGenerationMode } from "@/features/settings/stores/use-config-store";
import { requestCreditCost } from "@/features/generation/constants/credit-calculation";

import { quoteVideoGeneration } from "./video-billing";

/** 单个视频工作流阶段的报价。 */
export type VideoWorkflowStageQuote = {
    role: string;
    displayName: string;
    taskType: "image" | "video";
    model: string;
    taskCount: number;
    credits: number;
};

/** 视频工作流报价结果。 */
export type VideoWorkflowQuote =
    | {
          available: true;
          workflowType: string;
          credits: number;
          stages: VideoWorkflowStageQuote[];
          requiredCapabilities: string[];
      }
    | { available: false; reason: string };

type VideoWorkflowQuoteInput = {
    config: AiConfig;
    workflowType?: string | null;
    model: string;
    resolution: string;
    seconds: string | number;
};

/** 可注册的视频工作流报价定义。 */
export type VideoWorkflowQuoteDefinition = {
    workflowType: string;
    imageStages: Array<{ role: string; displayName: string }>;
    videoStage: { role: string; displayName: string; modes: VideoGenerationMode[] };
};

/** 前端报价定义注册表，服务端报价仍是最终校验来源。 */
const workflowDefinitions = new Map<string, VideoWorkflowQuoteDefinition>([
    [
        "first-last-frame",
        {
            workflowType: "first-last-frame",
            imageStages: [
                { role: "first_frame", displayName: "生成首帧" },
                { role: "last_frame", displayName: "生成尾帧" },
            ],
            videoStage: { role: "video", displayName: "合成视频", modes: ["first-last-frame-to-video", "reference-to-video"] },
        },
    ],
]);

/** 注册前端报价定义，供新增视频工作流复用报价计算器。 */
export function registerVideoWorkflowQuoteDefinition(definition: VideoWorkflowQuoteDefinition) {
    workflowDefinitions.set(definition.workflowType, definition);
}

/**
 * 计算已注册视频工作流的阶段报价。
 *
 * 报价注册表按工作流类型维护，后续新增工作流时只需增加对应定义，普通视频报价仍走原有函数。
 * 工作流阶段由注册表定义，模式按定义顺序选择第一个可用报价。
 */
export function quoteVideoWorkflow(input: VideoWorkflowQuoteInput): VideoWorkflowQuote {
    if (!input.workflowType) return { available: false, reason: "未选择视频工作流" };
    const definition = workflowDefinitions.get(input.workflowType);
    if (!definition) return { available: false, reason: `未注册视频工作流：${input.workflowType}` };

    const imageModel = input.config.imageModel?.trim();
    if (definition.imageStages.length && !imageModel) return { available: false, reason: "该视频工作流需要选择图片生成模型" };
    const imageStageCredits = requestCreditCost({
        modelCosts: input.config.modelCosts,
        model: imageModel || "",
        taskType: "image",
        count: 1,
    });
    if (definition.imageStages.length && !input.config.modelCosts.some((item) => item.model === imageModel && item.taskType === "image")) {
        return { available: false, reason: "当前图片模型未配置图片生成计费价格" };
    }
    const imageCredits = imageStageCredits * definition.imageStages.length;
    let videoQuote: ReturnType<typeof quoteVideoGeneration> | null = null;
    let selectedMode: VideoGenerationMode | null = null;
    const modeReasons: string[] = [];
    for (const mode of definition.videoStage.modes) {
        const candidate = quoteVideoGeneration({
            config: input.config,
            model: input.model,
            mode,
            resolution: input.resolution,
            seconds: input.seconds,
            imageReferenceCount: definition.imageStages.length,
            requireReferences: false,
        });
        if (candidate.available) {
            videoQuote = candidate;
            selectedMode = mode;
            break;
        }
        modeReasons.push(`${mode}: ${candidate.reason}`);
    }
    if (!videoQuote || !selectedMode) {
        return { available: false, reason: modeReasons.join("；") || "该视频工作流没有可用的视频生成模式" };
    }

    const credits = imageCredits + videoQuote.credits;
    if (!Number.isSafeInteger(credits)) return { available: false, reason: "本次工作流积分计算超出范围" };
    return {
        available: true,
        workflowType: input.workflowType,
        credits,
        requiredCapabilities: ["text-to-image", selectedMode],
        stages: [
            ...definition.imageStages.map((stage) => ({ role: stage.role, displayName: stage.displayName, taskType: "image" as const, model: imageModel || "", taskCount: 1, credits: imageStageCredits })),
            { role: definition.videoStage.role, displayName: definition.videoStage.displayName, taskType: "video", model: input.model, taskCount: 1, credits: videoQuote.credits },
        ],
    };
}
