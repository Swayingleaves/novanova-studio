"use client";

import { create } from "zustand";

import { getCurrentUserInfo, listAiTasks, subscribeAiTaskEvents, type ServerAiTask } from "@/services/api/server";
import { useUserStore } from "@/features/auth/stores/use-user-store";

type AiTaskStore = {
    tasks: Record<string, ServerAiTask>;
    subscribed: boolean;
    unsubscribe?: () => void;
    hydrateRunningTasks: () => Promise<void>;
    startSubscribe: () => void;
    stopSubscribe: () => void;
};

export const useAiTaskStore = create<AiTaskStore>()((set, get) => ({
    tasks: {},
    subscribed: false,
    hydrateRunningTasks: async () => {
        const tasks = await listAiTasks(["pending", "running"]);
        set((state) => ({ tasks: mergeTasks(state.tasks, tasks) }));
    },
    startSubscribe: () => {
        if (get().subscribed) return;
        const unsubscribe = subscribeAiTaskEvents((task) => {
            set((state) => ({ tasks: { ...state.tasks, [task.id]: task } }));
            if (task.status === "pending" || task.status === "failed" || task.status === "canceled") {
                // 任务创建扣费及失败退款完成后，同步左侧栏展示的可用积分。
                const currentUserId = useUserStore.getState().user?.id;
                if (!currentUserId) return;
                void getCurrentUserInfo()
                    .then((profile) => {
                        if (useUserStore.getState().user?.id === currentUserId) {
                            useUserStore.getState().setUser(profile);
                        }
                    })
                    .catch(() => undefined);
            }
        });
        set({ subscribed: true, unsubscribe });
    },
    stopSubscribe: () => {
        get().unsubscribe?.();
        set({ subscribed: false, unsubscribe: undefined });
    },
}));

function mergeTasks(current: Record<string, ServerAiTask>, tasks: ServerAiTask[]) {
    return tasks.reduce(
        (result, task) => ({
            ...result,
            [task.id]: task,
        }),
        { ...current },
    );
}
