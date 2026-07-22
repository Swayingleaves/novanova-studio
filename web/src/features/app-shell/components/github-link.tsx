"use client";

import { GithubOutlined } from "@ant-design/icons";

import { cn } from "@/shared/lib/utils";

type GitHubLinkProps = {
    className?: string;
    style?: React.CSSProperties;
};

function normalizeGitHubUrl(value: string | undefined): string {
    if (!value?.trim()) return "";
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
    } catch {
        return "";
    }
}

/**
 * 项目 GitHub 仓库跳转按钮。
 * <p>
 * 仓库地址由环境变量 NEXT_PUBLIC_GITHUB_URL 注入；未配置时不渲染（避免指向任意外部仓库）。
 *
 * @param props 样式属性
 * @return 渲染结果，未配置地址时返回 null
 */
export function GitHubLink({ className, style }: GitHubLinkProps) {
    const href = normalizeGitHubUrl(process.env.NEXT_PUBLIC_GITHUB_URL);
    if (!href) return null;
    return (
        <a
            className={cn(
                "inline-flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--studio-muted)] transition hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]",
                className,
            )}
            style={style}
            href={href}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            title="GitHub"
        >
            <GithubOutlined className="text-base" />
        </a>
    );
}
