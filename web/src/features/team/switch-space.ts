import { confirmPageNavigation } from "@/shared/lib/navigation-history-guard";

/** 选定目标后保存原空间并整页导航；返回是否已发起导航，保存失败时保留原空间。 */
export async function switchSpace(path: string) {
    try {
        const [{ useScriptStore }, { saveCanvasBeforeTeamSwitch }] = await Promise.all([
            import("@/features/script/stores/use-script-store"), import("@/features/canvas/stores/use-canvas-store"),
        ]);
        if (!await useScriptStore.getState().saveAll()) throw new Error("剧本保存失败，请保存后再切换空间");
        await saveCanvasBeforeTeamSwitch();
        if (!await confirmPageNavigation(path)) return false;
        window.location.assign(path);
        return true;
    } catch (error) {
        window.dispatchEvent(new CustomEvent("team-switch-error", { detail: error instanceof Error ? error.message : "空间切换失败" }));
        return false;
    }
}
