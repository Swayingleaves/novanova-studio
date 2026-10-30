import { BookOpenText, Clapperboard, FileText, Frame, ImageIcon, Images, SendToBack, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavigationTool = {
    slug: string;
    labelKey: string;
    icon: LucideIcon;
    adminOnly?: boolean;
    /** 企业版专属功能，在导航中展示 PRO 角标。 */
    pro?: boolean;
    group: "create" | "resources" | "settings";
};

export const navigationTools = [
    { slug: "image",   labelKey: "common.image",     icon: ImageIcon,    group: "create",    adminOnly: undefined, pro: undefined },
    { slug: "video",   labelKey: "common.video",     icon: Clapperboard, group: "create",    adminOnly: undefined, pro: undefined },
    { slug: "canvas",  labelKey: "common.infiniteCanvas",   icon: SendToBack,    group: "create",    adminOnly: undefined, pro: undefined },
    { slug: "script",  labelKey: "common.scriptCreation",   icon: BookOpenText,  group: "create",    adminOnly: undefined, pro: true },
    { slug: "comic-drama", labelKey: "common.comicDramaCreation", icon: Frame,       group: "create",    adminOnly: undefined, pro: true },
    { slug: "assets",  labelKey: "common.myAssets",   icon: Images,       group: "resources", adminOnly: undefined, pro: undefined },
    { slug: "prompts", labelKey: "common.promptLibrary",   icon: FileText,     group: "resources", adminOnly: undefined, pro: undefined },
    { slug: "admin/system", labelKey: "common.administration", icon: Users,    group: "settings",  adminOnly: true,      pro: undefined },
] as const satisfies readonly NavigationTool[];

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];

export const NAV_GROUPS = [
    { key: "create",    labelKey: "common.create" },
    { key: "resources", labelKey: "common.resources" },
    { key: "settings",  labelKey: "common.settings" },
] as const;
