import { create } from "zustand";
import type { SharedWorkSource } from "@/services/api/shared-work";

/** 分享操作只保存来源标识，公开内容始终由服务端读取。 */
export const useSharedWorkStore = create<{
    source: SharedWorkSource | null;
    beforePreview?: () => Promise<void>;
    generationSources: Record<string, SharedWorkSource>;
    open: (source: SharedWorkSource, beforePreview?: () => Promise<void>) => void;
    close: () => void;
}>((set) => ({ source: null, generationSources: {}, open: (source, beforePreview) => set({ source, beforePreview }), close: () => set({ source: null, beforePreview: undefined }) }));
