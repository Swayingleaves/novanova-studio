import {
    Award,
    BookOpenText,
    Bookmark,
    Bot,
    Brush,
    Camera,
    Clapperboard,
    Compass,
    Cpu,
    Crown,
    FileText,
    Film,
    Flame,
    FolderOpen,
    Frame,
    Gem,
    Globe,
    Headphones,
    ImageIcon,
    Images,
    Layers,
    LayoutGrid,
    Lightbulb,
    MessageSquare,
    Mic,
    Music,
    Palette,
    Rocket,
    SendToBack,
    ShoppingBag,
    Sparkles,
    Star,
    Store,
    Tag,
    Video,
    Wand2,
    Zap,
    type LucideIcon,
} from "lucide-react";

export type NavigationMenuIconOption = {
    key: string;
    label: string;
    keywords: string;
    icon: LucideIcon;
};

/** 菜单管理可选图标库（Lucide 图标集，覆盖创作、媒体、工具与运营场景）。 */
export const NAVIGATION_MENU_ICON_OPTIONS: readonly NavigationMenuIconOption[] = [
    { key: "film", label: "胶片 / 短剧", keywords: "film drama movie 胶片 短剧 影视", icon: Film },
    { key: "image", label: "图片", keywords: "image photo picture 图片 图像", icon: ImageIcon },
    { key: "clapperboard", label: "场记板 / 视频", keywords: "clapperboard video 场记板 视频", icon: Clapperboard },
    { key: "video", label: "摄像机", keywords: "video camera 摄像机 视频", icon: Video },
    { key: "send-to-back", label: "画布", keywords: "canvas layers send-to-back 画布 无限画布", icon: SendToBack },
    { key: "book-open-text", label: "剧本", keywords: "book script 剧本 书本 阅读", icon: BookOpenText },
    { key: "frame", label: "分镜 / 漫剧", keywords: "frame comic storyboard 分镜 漫剧", icon: Frame },
    { key: "images", label: "相册 / 资产", keywords: "images gallery assets 相册 资产 图库", icon: Images },
    { key: "file-text", label: "文档 / 提示词", keywords: "file text prompt 文档 提示词", icon: FileText },
    { key: "store", label: "商店 / 市场", keywords: "store market shop 商店 市场 技能", icon: Store },
    { key: "sparkles", label: "AI 灵感", keywords: "sparkles ai magic 灵感 魔法 星光", icon: Sparkles },
    { key: "wand-2", label: "魔法棒", keywords: "wand magic 魔法 生成 特效", icon: Wand2 },
    { key: "palette", label: "调色盘", keywords: "palette color art 调色盘 风格 艺术", icon: Palette },
    { key: "brush", label: "画笔", keywords: "brush paint draw 画笔 绘画 设计", icon: Brush },
    { key: "camera", label: "相机", keywords: "camera photo shoot 相机 摄影", icon: Camera },
    { key: "layers", label: "图层", keywords: "layers stack 图层 叠层", icon: Layers },
    { key: "layout-grid", label: "网格 / 广场", keywords: "grid layout gallery 网格 广场 模板", icon: LayoutGrid },
    { key: "folder-open", label: "文件夹", keywords: "folder files 文件夹 目录 素材", icon: FolderOpen },
    { key: "bot", label: "机器人 / Agent", keywords: "bot agent ai 机器人 助手", icon: Bot },
    { key: "cpu", label: "芯片 / 模型", keywords: "cpu model chip 芯片 模型 算力", icon: Cpu },
    { key: "music", label: "音乐", keywords: "music audio song 音乐 音频 配乐", icon: Music },
    { key: "mic", label: "麦克风 / 配音", keywords: "mic voice audio 麦克风 配音 语音", icon: Mic },
    { key: "headphones", label: "耳机 / 听觉", keywords: "headphones audio 耳机 音效", icon: Headphones },
    { key: "message-square", label: "对话", keywords: "message chat 对话 聊天 问答", icon: MessageSquare },
    { key: "compass", label: "探索 / 发现", keywords: "compass explore 探索 发现 导航", icon: Compass },
    { key: "globe", label: "全球 / 社区", keywords: "globe web community 社区 全球 广场", icon: Globe },
    { key: "rocket", label: "火箭 / 加速", keywords: "rocket fast launch 火箭 加速 上新", icon: Rocket },
    { key: "flame", label: "热门", keywords: "flame hot fire 热门 爆款 推荐", icon: Flame },
    { key: "star", label: "精选 / 收藏", keywords: "star favorite 精选 收藏 星星", icon: Star },
    { key: "zap", label: "闪电 / 极速", keywords: "zap flash fast 闪电 极速 快捷", icon: Zap },
    { key: "lightbulb", label: "创意 / 想法", keywords: "lightbulb idea 创意 灵感 灯泡", icon: Lightbulb },
    { key: "crown", label: "会员 / 尊享", keywords: "crown vip pro 会员 皇冠 尊享", icon: Crown },
    { key: "gem", label: "宝石 / 精品", keywords: "gem diamond pro 宝石 精品 高级", icon: Gem },
    { key: "award", label: "徽章 / 排行", keywords: "award badge rank 徽章 榜单 活动", icon: Award },
    { key: "shopping-bag", label: "购物袋", keywords: "shopping bag store 购物 商城 套餐", icon: ShoppingBag },
    { key: "tag", label: "标签", keywords: "tag label price 标签 活动 优惠", icon: Tag },
    { key: "bookmark", label: "书签", keywords: "bookmark save 书签 收藏 专栏", icon: Bookmark },
];

const iconByKey = new Map<string, LucideIcon>(
    NAVIGATION_MENU_ICON_OPTIONS.map((option) => [option.key, option.icon]),
);

/** 根据图标标识解析对应 Lucide 图标组件，未配置或未命中时回退菜单默认图标。 */
export function resolveNavigationMenuIcon(iconKey: string | null | undefined, fallbackIcon: LucideIcon): LucideIcon {
    const normalized = iconKey?.trim();
    if (!normalized) return fallbackIcon;
    return iconByKey.get(normalized) || fallbackIcon;
}

/** 菜单右上角标预设颜色选项。 */
export const NAVIGATION_BADGE_COLOR_PRESETS = [
    "#ef4444",
    "#f97316",
    "#f59e0b",
    "#10b981",
    "#06b6d4",
    "#3b82f6",
    "#8b5cf6",
    "#ec4899",
] as const;

/** 菜单右上角标快捷文案。 */
export const NAVIGATION_BADGE_TEXT_PRESETS = ["NEW", "HOT", "BETA", "VIP", "PRO"] as const;
