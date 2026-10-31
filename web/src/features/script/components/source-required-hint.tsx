"use client";

import { Empty } from "antd";

import { useTranslation } from "@/features/locale/use-translation";

/** 未从原文导入的项目在原文、故事知识库与小说改编页共用的整页空状态。 */
export function SourceRequiredHint({ hint }: { hint: string }) {
    const translate = useTranslation();
    return (
        <section className="flex min-h-0 flex-1 items-center justify-center p-6">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate("script.thisProjectHasNoImportedSource")}>
                <p className="max-w-sm text-xs text-[var(--studio-muted)]">{hint}</p>
            </Empty>
        </section>
    );
}
