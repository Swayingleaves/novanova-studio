import { listHomepageShowcases, type HomepageShowcase } from "@/services/api/server";

export const homepageFallbackEditorialShowcaseId = -1;
export const homepageFallbackEditorialVideoUrls = ["/homepage/novanova-black-editorial.mp4", "/homepage/novanova-black-editorial-2.mp4"] as const;

export const homepageFallbackShowcases: HomepageShowcase[] = [
    {
        id: homepageFallbackEditorialShowcaseId,
        title: "城市档案 / 视觉海报",
        description: "黑色编辑风格视觉作品。",
        category: "视觉海报",
        creatorName: "墨线工作室",
        mediaType: "video",
        mediaUrl: homepageFallbackEditorialVideoUrls[0],
        thumbnailUrl: "",
        targetType: "image",
        targetPath: "/image",
        promptContent: "一组黑色编辑风格的城市视觉海报，低饱和电影质感，克制构图",
        sortOrder: 10,
        status: 1,
    },
    {
        id: -2,
        title: "形态研究 / 动态影像",
        description: "时装概念影像作品。",
        category: "时尚影像",
        creatorName: "林夏",
        mediaType: "image",
        mediaUrl: "/homepage/novanova-black-fashion.jpg",
        thumbnailUrl: "",
        targetType: "video",
        targetPath: "/video",
        promptContent: "一支低饱和时装概念短片，俯拍构图，缓慢人物运动",
        sortOrder: 20,
        status: 1,
    },
    {
        id: -3,
        title: "材质实验 / 产品视觉",
        description: "未来产品视觉作品。",
        category: "产品视觉",
        creatorName: "Northline",
        mediaType: "image",
        mediaUrl: "/homepage/novanova-black-product.jpg",
        thumbnailUrl: "",
        targetType: "image",
        targetPath: "/image",
        promptContent: "一组未来产品视觉，深色材质、冷白光与广阔空间感",
        sortOrder: 30,
        status: 1,
    },
    ...[
        ["夜航纪事", "霓虹雨夜中的城市通勤视觉。", "视觉海报", "张默", "image", "image", "一组霓虹雨夜城市视觉海报，潮湿柏油路反射冷白灯光，电影级构图"],
        ["静默的远方", "辽阔荒原中的人物概念短片。", "概念短片", "Yuri Lin", "image", "video", "一支荒原旅行概念短片，远景人物与低饱和天空，缓慢镜头运动"],
        ["午夜餐桌", "夜间餐饮品牌的氛围广告。", "商业广告", "苏澈", "image", "image", "高端夜间餐饮品牌广告，深色餐桌与精确局部光线，克制构图"],
        ["机械花园", "异星生态世界的游戏设定。", "游戏美术", "Gao Yu", "image", "image", "异星机械花园游戏概念图，巨型机械花朵与薄雾，丰富层次"],
        ["红线裁片", "实验性时装系列的动态定格。", "时尚影像", "Vivi Chen", "image", "video", "实验时装动态影像，红色裁片在风中飘动，棚拍高对比光线"],
        ["折叠光源", "可穿戴灯具的产品概念。", "产品视觉", "Kite Workshop", "image", "image", "未来可穿戴灯具产品摄影，黑色背景，硬边冷光，细节清晰"],
        ["清晨之外", "极简居住空间的生活方式创作。", "生活方式", "顾明", "image", "image", "极简居住空间生活方式摄影，清晨侧光，植物与粗粝材质"],
        ["雾城回声", "浓雾未来都市的印刷视觉。", "视觉海报", "Ansel", "image", "image", "浓雾未来都市视觉海报，无文字，高层建筑若隐若现，银灰与荧光绿"],
    ].map(([title, description, category, creatorName, mediaType, targetType, promptContent], index) => ({
        id: -4 - index,
        title,
        description,
        category,
        creatorName,
        mediaType: mediaType as HomepageShowcase["mediaType"],
        mediaUrl: `/homepage/fantastic-show/fantastic-show-${String(index + 1).padStart(2, "0")}.jpg`,
        thumbnailUrl: "",
        targetType: targetType as HomepageShowcase["targetType"],
        targetPath: targetType === "video" ? "/video" : "/image",
        promptContent,
        sortOrder: 40 + index * 10,
        status: 1,
    })),
];

export const homepageTargetPaths: Record<HomepageShowcase["targetType"], string> = {
    image: "/image",
    video: "/video",
    canvas: "/canvas",
    asset: "/assets",
};

export function getHomepageTargetPath(targetType: HomepageShowcase["targetType"]) {
    return homepageTargetPaths[targetType];
}

export async function fetchHomepageShowcases() {
    const result = await listHomepageShowcases(24);
    const items = result.items || [];
    if (items.some((item) => !isValidHomepageShowcase(item))) {
        throw new Error("首页精选内容包含无效媒体或入口配置");
    }
    return items;
}

function isValidHomepageShowcase(item: HomepageShowcase) {
    return (
        (item.mediaType === "image" || item.mediaType === "video") &&
        (item.targetType === "image" || item.targetType === "video" || item.targetType === "canvas" || item.targetType === "asset") &&
        Boolean(item.mediaUrl) &&
        Boolean(item.targetPath) &&
        item.targetPath.startsWith("/") &&
        !item.targetPath.startsWith("//")
    );
}
