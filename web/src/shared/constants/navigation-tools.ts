import { BookOpenText, Clapperboard, FileText, Frame, ImageIcon, Images, SendToBack, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavigationTool = {
    slug: string;
    label: string;
    icon: LucideIcon;
    adminOnly?: boolean;
    /** 企业版专属功能，在导航中展示 PRO 角标。 */
    pro?: boolean;
    group: "create" | "resources" | "settings";
};

export const navigationTools = [
    { slug: "image",   label: "图片",     icon: ImageIcon,    group: "create",    adminOnly: undefined, pro: undefined },
    { slug: "video",   label: "视频",     icon: Clapperboard, group: "create",    adminOnly: undefined, pro: undefined },
    { slug: "canvas",  label: "无限画布",   icon: SendToBack,    group: "create",    adminOnly: undefined, pro: undefined },
    { slug: "script",  label: "剧本创作",   icon: BookOpenText,  group: "create",    adminOnly: undefined, pro: true },
    { slug: "comic-drama", label: "漫剧创作", icon: Frame,       group: "create",    adminOnly: undefined, pro: true },
    { slug: "assets",  label: "我的资产",   icon: Images,       group: "resources", adminOnly: undefined, pro: undefined },
    { slug: "prompts", label: "提示词库",   icon: FileText,     group: "resources", adminOnly: undefined, pro: undefined },
    { slug: "admin/system", label: "管理后台", icon: Users,    group: "settings",  adminOnly: true,      pro: undefined },
] as const satisfies readonly NavigationTool[];

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];

export const NAV_GROUPS = [
    { key: "create",    label: "创作" },
    { key: "resources", label: "资源" },
    { key: "settings",  label: "设置" },
] as const;
