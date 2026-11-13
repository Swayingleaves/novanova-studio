"use client";

import { useCallback, useEffect, useState } from "react";
import { App, Button, Empty, Input, Pagination, Segmented, Spin, Tag } from "antd";

import { SkillEditorModal } from "@/features/skill-market/components/skill-editor-modal";
import { SkillMarketCardView } from "@/features/skill-market/components/skill-market-card";
import { SkillMarketSectionNav } from "@/features/skill-market/components/skill-market-section-nav";
import { useTranslation } from "@/features/locale/use-translation";
import { useRouter } from "@/shared/lib/team-navigation";
import { deleteUserSkill, getSkillDetail, listMySkills, submitSkillReview, unfavoriteSkill, withdrawSkill, type SkillMarketDetail, type SkillMineCard, type SkillReviewStatus } from "@/services/api/server";

const statusKey: Record<SkillReviewStatus, string> = {
    private: "skillMarket.private",
    pending: "skillMarket.pending",
    published: "skillMarket.published",
    rejected: "skillMarket.rejected",
};

export default function MySkillsPage() {
    const translate = useTranslation();
    const router = useRouter();
    const { message, modal } = App.useApp();
    const [tab, setTab] = useState<"created" | "favorite">("created");
    const [keyword, setKeyword] = useState("");
    const [query, setQuery] = useState("");
    const [page, setPage] = useState(1);
    const [skills, setSkills] = useState<SkillMineCard[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editing, setEditing] = useState<SkillMarketDetail | null>(null);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setQuery(keyword.trim());
            setPage(1);
        }, 300);
        return () => window.clearTimeout(timer);
    }, [keyword]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const result = await listMySkills({ tab, keyword: query || undefined, page, pageSize: 12 });
            setSkills(result.skills);
            setTotal(result.total);
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("skillMarket.loadFailed"));
        } finally {
            setLoading(false);
        }
    }, [message, page, query, tab, translate]);

    useEffect(() => {
        void load();
    }, [load]);

    const openCreate = () => {
        setEditing(null);
        setEditorOpen(true);
    };

    const openEdit = async (skill: SkillMineCard) => {
        try {
            setEditing(await getSkillDetail(skill.id));
            setEditorOpen(true);
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("skillMarket.loadFailed"));
        }
    };

    const confirmAction = (title: string, content: string, action: () => Promise<unknown>) => {
        modal.confirm({
            title,
            content,
            okText: title,
            cancelText: translate("skillMarket.cancel"),
            onOk: action,
        });
    };

    const run = async (action: () => Promise<unknown>, success: string) => {
        try {
            await action();
            message.success(success);
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("skillMarket.loadFailed"));
        }
    };

    return (
        <main className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6">
            <header>
                <h1 className="studio-title text-2xl font-semibold">{translate("common.skillMarket")}</h1>
                <p className="studio-subtitle mt-2 text-sm">{translate("skillMarket.mineHint")}</p>
                <SkillMarketSectionNav />
            </header>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <Segmented
                    value={tab}
                    options={[
                        { label: translate("skillMarket.created"), value: "created" },
                        { label: translate("skillMarket.favorited"), value: "favorite" },
                    ]}
                    onChange={(value) => {
                        setTab(value as "created" | "favorite");
                        setPage(1);
                    }}
                />
                <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center lg:w-auto">
                    <Input.Search value={keyword} allowClear placeholder={translate("skillMarket.searchPlaceholder")} className="w-full lg:w-72" onChange={(event) => setKeyword(event.target.value)} />
                    <Button type="primary" className="shrink-0" onClick={openCreate}>{translate("skillMarket.createSkill")}</Button>
                </div>
            </div>
            {loading ? <div className="flex h-60 items-center justify-center"><Spin /></div> : null}
            {!loading && skills.length ? (
                <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {skills.map((skill) => (
                        <SkillMarketCardView
                            key={skill.id}
                            item={skill}
                            status={tab === "created" ? <Tag className="m-0">{translate(skill.reviewStatus === "published" && skill.revisionStatus === "pending" ? "skillMarket.updatePending" : skill.reviewStatus === "published" && skill.revisionStatus === "rejected" ? "skillMarket.updateRejected" : statusKey[skill.reviewStatus])}</Tag> : undefined}
                            onOpen={() => router.push(`/skill-market/${skill.id}`)}
                            onFavorite={tab === "favorite" ? () => void run(() => unfavoriteSkill(skill.id), translate("skillMarket.unfavoritedSuccess")) : undefined}
                            extra={tab === "created" ? (
                                <>
                                    <Button size="small" onClick={() => void openEdit(skill)}>{translate("skillMarket.edit")}</Button>
                                    {skill.reviewStatus === "private" || skill.reviewStatus === "rejected" ? (
                                        <Button size="small" type="primary" onClick={() => confirmAction(translate("skillMarket.submitReview"), translate("skillMarket.submitConfirm"), () => run(() => submitSkillReview(skill.id), translate("skillMarket.submitted")))}>{translate("skillMarket.submitReview")}</Button>
                                    ) : null}
                                    {skill.reviewStatus === "pending" || skill.reviewStatus === "published" ? (
                                        <Button size="small" onClick={() => confirmAction(translate("skillMarket.withdraw"), translate("skillMarket.withdrawConfirm"), () => run(() => withdrawSkill(skill.id), translate("skillMarket.withdrawn")))}>{translate("skillMarket.withdraw")}</Button>
                                    ) : null}
                                    <Button size="small" danger onClick={() => confirmAction(translate("skillMarket.delete"), translate("skillMarket.deleteConfirm"), () => run(() => deleteUserSkill(skill.id), translate("skillMarket.deletedSuccess")))}>{translate("skillMarket.delete")}</Button>
                                </>
                            ) : undefined}
                        />
                    ))}
                </section>
            ) : null}
            {!loading && !skills.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate("skillMarket.empty")} className="py-16" /> : null}
            {total > 12 ? <Pagination current={page} pageSize={12} total={total} showSizeChanger={false} onChange={setPage} className="self-center" /> : null}
            <SkillEditorModal open={editorOpen} skill={editing} onClose={() => setEditorOpen(false)} onSaved={() => void load()} />
        </main>
    );
}
