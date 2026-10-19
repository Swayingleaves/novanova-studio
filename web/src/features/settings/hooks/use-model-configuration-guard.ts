"use client";

import { useCallback } from "react";
import { App } from "antd";
import { useTranslation } from "@/features/locale/use-translation";
import { normalizeModelOptionValue, selectableModelsByCapability, useConfigStore, type ModelCapability } from "../stores/use-config-store";

/** 在修改创作内容或发起请求前检查当前空间的模型，只提示缺少配置，不恢复原操作。 */
export function useModelConfigurationGuard() {
    const { message } = App.useApp();
    const translate = useTranslation();
    return useCallback((capability: ModelCapability, model?: string) => {
        const { config } = useConfigStore.getState();
        const models = selectableModelsByCapability(config, capability);
        if (models.length && (model === undefined || models.includes(normalizeModelOptionValue(model, config.channels)))) return true;
        message.warning(translate("settings.contactAdministratorForModel"));
        return false;
    }, [message, translate]);
}
