import { translateMessage, type TranslationKey } from "@/features/locale/translate";

/** 景别与运镜的存储值保持原样，只翻译已知的界面名称。 */
const parameterLabels: Record<string, TranslationKey> = {
    "远景": "comicDrama.extremeLongShot",
    "全景": "comicDrama.longShot",
    "中景": "comicDrama.mediumShot",
    "近景": "comicDrama.mediumCloseUp",
    "特写": "comicDrama.closeUp",
    "大特写": "comicDrama.extremeCloseUp",
    "固定镜头": "comicDrama.staticCamera",
    "缓慢推进": "comicDrama.slowPushInEmotionalFocus",
    "缓慢拉远": "comicDrama.slowPullOutRevealSurroundings",
    "横向摇摄": "comicDrama.panSurveyTheScene",
    "纵向俯仰": "comicDrama.tiltHeightOrPressure",
    "跟随移动": "comicDrama.trackingFollowAction",
    "环绕旋转": "comicDrama.orbitDynamicTension",
    "固定": "comicDrama.static",
    "推近": "comicDrama.pushIn",
    "拉远": "comicDrama.pullOut",
    "环绕": "comicDrama.orbit",
    "摇镜头": "comicDrama.pan",
    "移镜头": "comicDrama.track",
    "俯冲": "comicDrama.dive",
    "仰视": "comicDrama.lowAngle",
};

/** 用户手写的运镜描述保留原文，不改写业务内容。 */
export function productionParameterLabel(value: string, translate = translateMessage): string {
    const key = parameterLabels[value];
    return key ? translate(key) : value;
}

/** 保持选项的原始值，在每次渲染时计算当前语言的标签。 */
export function cameraMovementOptions(translate = translateMessage) {
    return ["固定", "推近", "拉远", "环绕", "摇镜头", "移镜头", "俯冲", "仰视"]
        .map((value) => ({ value, label: productionParameterLabel(value, translate) }));
}
