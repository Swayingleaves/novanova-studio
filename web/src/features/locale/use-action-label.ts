"use client";

import type { ServerSystemMessage } from "@/services/api/server";
import { useTranslation } from "./use-translation";

/** 固定系统操作沿用既有业务值，显示文案独立翻译。 */
const systemChoiceMessageKeys: Record<string, string> = {
    确认生成: "confirmGeneration",
    用这些图片生成视频: "generateVideoWithTheseImages",
    修改提示词重新生成: "editPromptAndRegenerate",
    我想调整提示词: "adjustPrompt",
};

/** 内置Agent操作按显示语言即时翻译，模型选项和业务值保持原文。 */
export function useActionLabel() {
    const translate = useTranslation();
    return (item: { label: string; value?: string; labelMessage?: ServerSystemMessage | null }) => {
        const key = item.labelMessage?.key.slice("business.".length) ?? (item.value ? systemChoiceMessageKeys[item.value] : undefined);
        return key ? translate(`agentActions.${key}`) : item.label;
    };
}
