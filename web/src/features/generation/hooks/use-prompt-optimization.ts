"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { App } from "antd";

import { optimizeGenerationPrompt } from "@/features/generation/api/prompt-optimization";
import type { PromptOptimizationType } from "@/services/api/server";

type OptimizePromptOptions = {
    operationId: string;
    generationType: PromptOptimizationType;
    prompt: string;
    generationStyleIds?: number[];
    onSuccess: (prompt: string) => void;
};

/**
 * 统一管理提示词优化请求、加载状态和用户反馈。
 *
 * @returns 当前优化标识与优化方法
 */
export function usePromptOptimization() {
    const { message } = App.useApp();
    const [optimizingOperationId, setOptimizingOperationId] = useState<string | null>(null);
    const optimizingOperationIdRef = useRef<string | null>(null);
    const controllerRef = useRef<AbortController | null>(null);

    useEffect(() => () => controllerRef.current?.abort(), []);

    const optimizePrompt = useCallback(
        async ({ operationId, generationType, prompt, generationStyleIds, onSuccess }: OptimizePromptOptions) => {
            const normalizedPrompt = prompt.trim();
            if (!normalizedPrompt || optimizingOperationIdRef.current) return;

            const controller = new AbortController();
            controllerRef.current = controller;
            optimizingOperationIdRef.current = operationId;
            setOptimizingOperationId(operationId);

            try {
                const optimizedPrompt = await optimizeGenerationPrompt(generationType, normalizedPrompt, generationStyleIds, controller.signal);
                onSuccess(optimizedPrompt);
                message.success("提示词已优化");
            } catch (error) {
                if (error instanceof DOMException && error.name === "AbortError") return;
                message.error(error instanceof Error ? error.message : "提示词优化失败");
            } finally {
                if (controllerRef.current === controller) controllerRef.current = null;
                if (optimizingOperationIdRef.current === operationId) optimizingOperationIdRef.current = null;
                setOptimizingOperationId((current) => (current === operationId ? null : current));
            }
        },
        [message],
    );

    return { optimizingOperationId, optimizePrompt };
}
