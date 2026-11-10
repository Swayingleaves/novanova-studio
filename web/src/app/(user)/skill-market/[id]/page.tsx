"use client";

import { use, useEffect, useState } from "react";
import { App, Button, Empty, Spin } from "antd";
import { ArrowLeft } from "lucide-react";

import { SkillMarketCardView } from "@/features/skill-market/components/skill-market-card";
import { storeSkillCreationHandoff } from "@/features/skill-market/lib/skill-creation-handoff";
import { useTranslation } from "@/features/locale/use-translation";
import Link, { useRouter } from "@/shared/lib/team-navigation";
import { getSkillDetail, type SkillMarketDetail } from "@/services/api/server";

export default function SkillDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const translate = useTranslation();
    const router = useRouter();
    const { message } = App.useApp();
    const { id } = use(params);
    const skillId = Number(id);
    const [detail, setDetail] = useState<SkillMarketDetail | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!Number.isFinite(skillId) || skillId <= 0) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        void getSkillDetail(skillId)
            .then((result) => {
                if (!cancelled) setDetail(result);
            })
            .catch((error) => {
                if (!cancelled) {
                    setDetail(null);
                    message.error(error instanceof Error ? error.message : translate("skillMarket.loadFailed"));
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [message, skillId, translate]);

    const goCreate = () => {
        if (!detail || (detail.targetType !== "image" && detail.targetType !== "video")) return;
        if (detail.status !== 1) {
            message.warning(translate("skillMarket.disabledSkill"));
            return;
        }
        const stored = storeSkillCreationHandoff({
            target: detail.targetType,
            skill: {
                id: detail.id,
                name: detail.name,
                description: detail.description,
                targetType: detail.targetType,
                coverUrl: detail.coverUrl,
                aspectRatio: detail.aspectRatio,
                workflowType: detail.workflowType,
            },
        });
        if (!stored) {
            message.error(translate("skillMarket.loadFailed"));
            return;
        }
        router.push(detail.targetType === "video" ? "/video" : "/image");
    };

    if (loading) return <div className="flex h-60 items-center justify-center"><Spin /></div>;
    if (!detail) return <Empty description={translate("skillMarket.notFound")} className="py-20" />;

    const author = detail.official || !detail.authorName ? translate("skillMarket.official") : detail.authorName;
    return (
        <main className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-6 sm:px-6">
            <Link href="/skill-market" className="inline-flex w-fit items-center gap-1 text-sm text-[var(--studio-muted)] hover:text-[var(--studio-ink)]">
                <ArrowLeft className="size-4" />
                {translate("common.skillMarket")}
            </Link>
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-4">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-[var(--studio-line)] bg-[var(--studio-media)]">
                        {detail.coverUrl ? <img src={detail.coverUrl} alt="" className="size-full object-cover" /> : null}
                    </div>
                    <div className="min-w-0">
                        <h1 className="studio-title text-2xl font-semibold">{detail.name}</h1>
                        {detail.subtitle ? <p className="studio-subtitle mt-2 text-sm">{detail.subtitle}</p> : null}
                        <p className="studio-caption mt-3 text-xs">{detail.category ? `${translate(`skillMarket.${detail.category}`)} · ` : ""}{author}</p>
                    </div>
                </div>
                <Button type="primary" onClick={goCreate}>{translate("skillMarket.goCreate")}</Button>
            </header>
            {detail.owned && detail.rejectReason ? <p className="text-sm text-[var(--studio-danger)]">{translate("skillMarket.rejectReason")}：{detail.rejectReason}</p> : null}
            <section className="flex flex-col gap-3">
                <h2 className="studio-title text-lg font-semibold">{translate("skillMarket.showcase")}</h2>
                <div className="grid gap-4 lg:grid-cols-2">
                    <div className="studio-panel-solid overflow-hidden">
                        {detail.coverUrl ? <img src={detail.coverUrl} alt="" className="aspect-[4/3] w-full object-cover" /> : <div className="studio-empty flex aspect-[4/3] items-center justify-center px-6 text-center text-sm">{detail.subtitle || detail.name}</div>}
                    </div>
                    <div className="studio-panel-solid flex flex-col justify-center gap-3 bg-[var(--studio-primary-soft)] p-6">
                        {(detail.usageSteps.length ? detail.usageSteps : [{ title: detail.subtitle || detail.name, detail: detail.description }]).map((step, index) => (
                            <div key={`${step.title}-${index}`}>
                                <p className="text-sm font-medium text-[var(--studio-ink)]">{index + 1}. {step.title || translate("skillMarket.howToUse")}</p>
                                {step.detail ? <p className="studio-subtitle mt-1 text-sm leading-6">{step.detail}</p> : null}
                            </div>
                        ))}
                    </div>
                </div>
            </section>
            <section className="flex flex-col gap-3">
                <h2 className="studio-title text-lg font-semibold">{translate("skillMarket.description")}</h2>
                <p className="studio-subtitle whitespace-pre-wrap text-sm leading-7">{detail.description || translate("skillMarket.noDescription")}</p>
            </section>
            <section className="flex flex-col gap-3">
                <h2 className="studio-title text-lg font-semibold">{translate("skillMarket.audience")}</h2>
                <p className="studio-subtitle whitespace-pre-wrap text-sm leading-7">{detail.audience || translate("skillMarket.noAudience")}</p>
            </section>
            <section className="flex flex-col gap-4">
                <h2 className="studio-title text-lg font-semibold">{translate("skillMarket.howToUse")}</h2>
                {detail.usageSteps.length ? detail.usageSteps.map((step, index) => (
                    <div key={`${step.title}-${index}`} className="flex gap-3">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--studio-primary-soft)] text-sm font-medium text-[var(--studio-action)]">{index + 1}</span>
                        <div>
                            <p className="text-sm font-medium text-[var(--studio-ink)]">{step.title}</p>
                            {step.detail ? <p className="studio-subtitle mt-1 text-sm leading-6">{step.detail}</p> : null}
                        </div>
                    </div>
                )) : <p className="studio-subtitle text-sm">{translate("skillMarket.noSteps")}</p>}
            </section>
            {detail.related.length ? (
                <section className="flex flex-col gap-3">
                    <h2 className="studio-title text-lg font-semibold">{translate("skillMarket.related")}</h2>
                    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
                        {detail.related.map((skill) => <SkillMarketCardView key={skill.id} item={skill} onOpen={() => router.push(`/skill-market/${skill.id}`)} />)}
                    </div>
                </section>
            ) : null}
        </main>
    );
}
