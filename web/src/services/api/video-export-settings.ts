import { serverGet, serverPost } from "./server";

export type VideoExportSettings = {
    enabled: boolean;
};

/** 读取平台漫剧视觉分镜板导出视频开关配置，公开接口且未登录也可访问。 */
export const getVideoExportSettings = () =>
    serverGet<VideoExportSettings>("/platform/getVideoExportSettings", { auth: false });

/** 平台管理员保存漫剧视觉分镜板导出视频开关配置。 */
export const saveVideoExportSettings = (enabled: boolean) =>
    serverPost<VideoExportSettings>("/admin/platform/saveVideoExportSettings", { enabled });
