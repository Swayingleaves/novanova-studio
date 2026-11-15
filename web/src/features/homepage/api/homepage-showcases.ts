import type { HomepageShowcase } from "@/services/api/server";

export const homepageTargetPaths: Record<HomepageShowcase["targetType"], string> = {
    image: "/image",
    video: "/video",
    canvas: "/canvas",
    asset: "/assets",
};

export function getHomepageTargetPath(targetType: HomepageShowcase["targetType"]) {
    return homepageTargetPaths[targetType];
}
