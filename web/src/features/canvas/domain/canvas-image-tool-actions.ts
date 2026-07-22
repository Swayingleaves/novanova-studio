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
        copyPrompt: { label: "复制", title: "复制图片提示词", active: false },
        replace: { label: "替换", title: "替换图片内容", active: false },
        resize: {
            label: context.freeResize ? "自由比例" : "锁定比例",
            title: context.freeResize ? "恢复等比缩放" : "允许自由缩放",
            active: context.freeResize,
        },
        crop: { label: "裁剪", title: "裁剪为新图片节点", active: false },
        split: { label: "切图", title: "按网格拆分图片", active: false },
        view: { label: "大图", title: "查看图片详情", active: false },
    };
    return ACTION_ORDER.map((id) => ({ id, ...labels[id] }));
}
