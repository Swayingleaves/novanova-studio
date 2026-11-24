import { useConfigStore, type ModelCapability } from "@/features/settings/stores/use-config-store";

export type AnnouncementTargetPageOption = {
    value: string;
    label: string;
    capability?: ModelCapability;
};

/** 公告引导可跳转的站内目标页面清单及对应默认模型能力。 */
export const ANNOUNCEMENT_TARGET_PAGE_OPTIONS: readonly AnnouncementTargetPageOption[] = [
    { value: "/image", label: "图片生成 (/image)", capability: "image" },
    { value: "/video", label: "视频生成 (/video)", capability: "video" },
    { value: "/canvas", label: "无限画布 (/canvas)" },
    { value: "/script", label: "剧本创作 (/script)", capability: "text" },
    { value: "/comic-drama", label: "漫剧创作 (/comic-drama)" },
    { value: "/drama", label: "智能短剧 (/drama)" },
    { value: "/skill-market", label: "技能市场 (/skill-market)" },
    { value: "/prompts", label: "提示词库 (/prompts)" },
];

/** 推导目标页面对应的模型能力筛选，未限定时返回 undefined 表示可选全部能力模型。 */
export function announcementTargetCapability(targetPath?: string | null): ModelCapability | undefined {
    const normalized = targetPath?.trim();
    if (!normalized) return undefined;
    return ANNOUNCEMENT_TARGET_PAGE_OPTIONS.find((item) => item.value === normalized)?.capability;
}

/**
 * 在跳转前按公告配置的预选模型同步写入全局配置，使目标页面自动选中该模型。
 */
export function applyAnnouncementTargetModel(targetModel?: string | null, targetPath?: string | null): void {
    const model = targetModel?.trim();
    if (!model) return;
    const { config, updateConfig } = useConfigStore.getState();
    if (config.imageModels.includes(model)) {
        updateConfig("imageModel", model);
        return;
    }
    if (config.videoModels.includes(model)) {
        updateConfig("videoModel", model);
        return;
    }
    if (config.textModels.includes(model)) {
        updateConfig("textModel", model);
        return;
    }
    // 兜底：若模型目录尚未刷新完毕，按目标页面能力预置对应模型字段
    const capability = announcementTargetCapability(targetPath);
    if (capability === "image") updateConfig("imageModel", model);
    else if (capability === "video") updateConfig("videoModel", model);
    else if (capability === "text") updateConfig("textModel", model);
}
