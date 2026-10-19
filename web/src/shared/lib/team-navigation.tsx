"use client";

import OriginalLink from "next/link";
import { usePathname as useOriginalPathname, useRouter as useOriginalRouter } from "next/navigation";
import { useMemo, type ComponentProps } from "react";
import { teamPath, useTeamStore } from "@/features/team/stores/use-team-store";
import { parseSpacePath } from "@/features/team/space-path";

export { useSearchParams, useParams, useSelectedLayoutSegment, useSelectedLayoutSegments, redirect, notFound } from "next/navigation";

/** 页面仍按既有业务路径选择导航状态，浏览器地址始终保留团队前缀。 */
export function usePathname() {
    return parseSpacePath(useOriginalPathname()).pathname;
}

/** 所有程序化业务导航统一保留当前团队，不修改已指定团队的目标。 */
export function useRouter() {
    const router = useOriginalRouter();
    return useMemo(() => ({ ...router, push: (href: string, options?: Parameters<typeof router.push>[1]) => router.push(teamPath(href), options), replace: (href: string, options?: Parameters<typeof router.replace>[1]) => router.replace(teamPath(href), options) }), [router]);
}

/** 链接在渲染时解析当前团队，同时供移动导航和桌面导航复用。 */
export default function TeamLink({ href, ...props }: ComponentProps<typeof OriginalLink>) {
    useTeamStore((state) => state.team?.id);
    const scoped = typeof href === "string" ? teamPath(href) : { ...href, pathname: href.pathname ? teamPath(href.pathname) : href.pathname };
    return <OriginalLink {...props} href={scoped} />;
}
