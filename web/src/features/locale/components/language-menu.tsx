"use client";

import { Dropdown } from "antd";
import { Check, Languages } from "lucide-react";
import { useLocale } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useLanguageStore } from "../language-store";
import { isWebsiteLocale, websiteLocales } from "../locale";
import { cn } from "@/shared/lib/utils";

/** 全站共用语言入口，文档切换保留当前文章和锚点。 */
export function LanguageMenu({ className }: { className?: string }) {
    const locale = useLocale();
    const pathname = usePathname();
    const router = useRouter();
    const setLocale = useLanguageStore((state) => state.setLocale);
    const label = locale === "en" ? "Language" : "语言";
    return (
        <Dropdown trigger={["click"]} menu={{
            selectable: true,
            selectedKeys: [locale],
            items: websiteLocales.map((value) => ({ key: value, label: value === "en" ? "English" : "简体中文", icon: locale === value ? <Check className="size-4" aria-hidden="true" /> : <span className="size-4" /> })),
            onClick: ({ key }) => {
                if (!isWebsiteLocale(key) || key === locale) return;
                setLocale(key);
                if (/^\/docs\/(zh-cn|en)(?:\/|$)/.test(pathname)) {
                    router.push(`${pathname.replace(/^\/docs\/(zh-cn|en)/, `/docs/${key}`)}${window.location.search}${window.location.hash}`);
                }
            },
        }}>
            <button type="button" title={label} aria-label={label} className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-md text-[var(--studio-muted)] transition-colors hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--studio-action)]", className)}>
                <Languages className="size-4.5" aria-hidden="true" />
            </button>
        </Dropdown>
    );
}
