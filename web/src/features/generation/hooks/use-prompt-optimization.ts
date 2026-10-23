"use client";
import { translateMessage as translate } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";


import { useCallback, useEffect, useRef, useState } from "react";
import { App } from "antd";

import { optimizeGenerationPrompt } from "@/features/generation/api/prompt-optimization";
import { normalizeOptimizedImageMentions, type PromptImageReference } from "@/features/generation/lib/image-reference-mentions";
import { useModelConfigurationGuard } from "@/features/settings/hooks/use-model-configuration-guard";
import type { PromptOptimizationType } from "@/services/api/server";

type OptimizePromptOptions = {
    operationId: string;
    generationType: PromptOptimizationType;
    prompt: string;
    generationStyleIds?: number[];
    imageReferences?: PromptImageReference[];
    onSuccess: (prompt: string) => void;
};

/**
 * 统一管理提示词优化请求、加载状态和用户反馈。
 *
 * @returns 当前优化标识与优化方法
 */
export function usePromptOptimization() {
    const translate = useTranslation();
    const { message } = App.useApp();
    const ensureModelConfiguration = useModelConfigurationGuard();
    const [optimizingOperationId, setOptimizingOperationId] = useState<string | null>(null);
    const optimizingOperationIdRef = useRef<string | null>(null);
    const controllerRef = useRef<AbortController | null>(null);

    useEffect(() => () => controllerRef.current?.abort(), []);

    const optimizePrompt = useCallback(
        async ({ operationId, generationType, prompt, generationStyleIds, imageReferences, onSuccess }: OptimizePromptOptions) => {
            const normalizedPrompt = prompt.trim();
            if (!normalizedPrompt || optimizingOperationIdRef.current) return;
            if (!ensureModelConfiguration("text")) return;

            const controller = new AbortController();
            controllerRef.current = controller;
            optimizingOperationIdRef.current = operationId;
            setOptimizingOperationId(operationId);

            try {
                const optimizedPrompt = await optimizeGenerationPrompt(generationType, normalizedPrompt, generationStyleIds, controller.signal);
                // 优化结果复用输入框的引用格式；缺失引用时明确报错，避免丢失用户选定的图片关系。
                const nextPrompt = imageReferences ? normalizeOptimizedImageMentions(optimizedPrompt, normalizedPrompt, imageReferences) : optimizedPrompt;
                if (nextPrompt === null) throw new Error(translate("generation.optimizationMissingImageReferences"));
                onSuccess(nextPrompt);
                message.success(translate("generation.promptOptimized"));
            } catch (error) {
                if (error instanceof DOMException && error.name === "AbortError") return;
                message.error(error instanceof Error ? error.message : translate("generation.failedToOptimizePrompt"));
            } finally {
                if (controllerRef.current === controller) controllerRef.current = null;
                if (optimizingOperationIdRef.current === operationId) optimizingOperationIdRef.current = null;
                setOptimizingOperationId((current) => (current === operationId ? null : current));
            }
        },
        [ensureModelConfiguration, message],
    );

    return { optimizingOperationId, optimizePrompt };
}
