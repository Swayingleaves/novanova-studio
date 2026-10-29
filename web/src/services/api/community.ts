import { serverGet, serverPost } from "./server";

export type CommunityConfig = {
    name: string;
    imageUrl: string;
    sortOrder: number;
};

export type CommunityConfigInput = {
    name: string;
    imageUrl: string;
};

/** 读取平台全局社群配置，公开接口且未登录也可访问。 */
export const listCommunityConfigs = () => serverGet<CommunityConfig[]>("/community/listCommunityConfigs", { auth: false });

/** 平台管理员整批保存社群配置，数组顺序即展示顺序。 */
export const saveCommunityConfigs = (configs: CommunityConfigInput[]) => serverPost<string>("/admin/community/saveCommunityConfigs", { configs });
