
import { translateMessage as translate } from "@/features/locale/translate";
export type CanvasImageNodeActionId = "copyPrompt" | "replace" | "resize" | "crop" | "split" | "view";

export type CanvasImageToolAction = {
    id: CanvasImageNodeActionId;
    label: string;
    title: string;
    active: boolean;
};

const ACTION_ORDER: CanvasImageNodeActionId[] = ["copyPrompt", "replace", "resize", "crop", "split", "view"];

export function buildCanvasImageToolActions(context: { freeResize: boolean }): CanvasImageToolAction[] {
    const labels: Record<CanvasImageNodeActionId, Omit<CanvasImageToolAction, "id">> = {
        copyPrompt: { label: translate("canvas.copy"), title: translate("canvas.copyImagePrompt"), active: false },
        replace: { label: translate("canvas.replace"), title: translate("canvas.replaceImageContent"), active: false },
        resize: {
            label: context.freeResize ? translate("canvas.freeAspectRatio") : translate("canvas.lockAspectRatio"),
            title: context.freeResize ? translate("canvas.restoreAspectRatio") : translate("canvas.allowFreeResize"),
            active: context.freeResize,
        },
        crop: { label: translate("canvas.crop"), title: translate("canvas.cropIntoNewImageNode"), active: false },
        split: { label: translate("canvas.splitImage_cae534"), title: translate("canvas.splitImageIntoGrid"), active: false },
        view: { label: translate("canvas.largeImage"), title: translate("canvas.viewImageDetails"), active: false },
    };
    return ACTION_ORDER.map((id) => ({ id, ...labels[id] }));
}
