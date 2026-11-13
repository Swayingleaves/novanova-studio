import { serverGet, serverPost } from "./server";

export type ExternalLinkConfig = {
    title: string;
    url: string;
    description: string;
    coverUrl: string;
};

/** 读取右上角展示外链配置，公开接口且未登录也可访问，未配置时返回 null。 */
export const getExternalLinkConfig = () => serverGet<ExternalLinkConfig | null>("/platform/getExternalLinkConfig", { auth: false });

/** 平台管理员保存展示外链配置，标题和链接同时为空表示移除入口。 */
export const saveExternalLinkConfig = (config: ExternalLinkConfig) => serverPost<string>("/admin/platform/saveExternalLinkConfig", config);
