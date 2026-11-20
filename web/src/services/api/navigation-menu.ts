import { serverGet, serverPost } from "./server";

export type NavigationMenuConfig = {
    menuKey: string;
    enabled: boolean;
    sortOrder: number;
};

export type NavigationMenuConfigInput = {
    menuKey: string;
    enabled: boolean;
};

/** 读取平台全局左侧导航菜单配置，公开接口且未登录也可访问。 */
export const listNavigationMenuConfigs = () =>
    serverGet<NavigationMenuConfig[]>("/platform/listNavigationMenuConfigs", { auth: false });

/** 平台管理员整批保存导航菜单配置，数组顺序即展示顺序。 */
export const saveNavigationMenuConfigs = (configs: NavigationMenuConfigInput[]) =>
    serverPost<string>("/admin/platform/saveNavigationMenuConfigs", { configs });
