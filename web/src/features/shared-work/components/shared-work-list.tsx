"use client";
import { useEffect, useState } from "react";
import { Alert, App, Button, Empty, Input, Modal, Pagination, Select, Spin, Tag } from "antd";
import { Copy, Eye, RefreshCw } from "lucide-react";
import { useTeamStore } from "@/features/team/stores/use-team-store";
import { useCopyText } from "@/shared/hooks/use-copy-text";
import { getSharedWork, listSharedWorks, reviewSharedWork, sharedWorkStatusNames, sharedWorkTypeNames, withdrawSharedWork, type SharedWork, type SharedWorkDetail, type SharedWorkPage, type SharedWorkStatus } from "@/services/api/shared-work";
import { SharedContent } from "./shared-content";

/** 作者列表和管理员队列共享状态展示及详情，服务端按当前空间强制限定权限。 */
export function SharedWorkList({ review = false }: { review?: boolean }) {
    const team = useTeamStore((state) => state.team);
    const { message, modal } = App.useApp();
    const copyText = useCopyText();
    const [status, setStatus] = useState(review ? "pending" : "");
    const [page, setPage] = useState(1);
    const [revision, setRevision] = useState(0);
    const [data, setData] = useState<SharedWorkPage | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [detail, setDetail] = useState<SharedWorkDetail | null>(null);
    const [previewing, setPreviewing] = useState("");
    const [busy, setBusy] = useState("");
    const [decision, setDecision] = useState<{ work: SharedWork; action: "reject" | "takeDown" } | null>(null);
    const [reason, setReason] = useState("");
    useEffect(() => {
        const controller = new AbortController();
        setLoading(true); setError("");
        void listSharedWorks(review, page, status, controller.signal).then((result) => { if (!controller.signal.aborted) setData(result); }).catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "查询分享失败"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, [review, page, status, revision, team?.id]);
    const act = async (work: SharedWork, action: "approve" | "reject" | "takeDown" | "withdraw", explanation = "") => {
        setBusy(work.shareCode);
        try {
            if (action === "withdraw") await withdrawSharedWork(work.shareCode);
            else await reviewSharedWork(work.shareCode, action, explanation.trim());
            message.success("操作成功"); setDecision(null); setDetail(null); setRevision((value) => value + 1);
        } catch (failure) { message.error(failure instanceof Error ? failure.message : "操作失败"); }
        finally { setBusy(""); }
    };
    const preview = async (work: SharedWork) => {
        setPreviewing(work.shareCode);
        try { setDetail(await getSharedWork(work.shareCode, false)); }
        catch (failure) { message.error(failure instanceof Error ? failure.message : "读取预览失败"); }
        finally { setPreviewing(""); }
    };
    return <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-[var(--studio-muted)]">{review ? team ? `仅审核「${team.name}」的团队投稿` : "仅审核个人空间投稿" : team ? `「${team.name}」中由我提交的作品` : "我的个人作品投稿"}</p>
            <div className="flex gap-2"><Select aria-label="分享状态" value={status} className="min-w-32" onChange={(value) => { setStatus(value); setPage(1); }} options={[{ value: "", label: "全部状态" }, ...Object.entries(sharedWorkStatusNames).filter(([value]) => !review || (value !== "preparing" && value !== "failed")).map(([value, label]) => ({ value, label }))]} /><Button icon={<RefreshCw className="size-4" />} onClick={() => setRevision((value) => value + 1)}>刷新</Button></div>
        </div>
        {error ? <Alert type="error" title={error} showIcon /> : loading ? <div className="grid min-h-60 place-items-center"><Spin /></div> : !data?.items.length ? <Empty description="暂无分享作品" /> : <div className="divide-y divide-[var(--studio-line)] rounded-lg border border-[var(--studio-line)]">
            {data.items.map((work) => <article key={work.shareCode} className="flex flex-col gap-4 p-4 sm:flex-row sm:p-5">
                {work.status !== "withdrawn" ? <button type="button" aria-label={`预览 ${work.title}`} className="h-28 w-full shrink-0 overflow-hidden rounded-lg border border-[var(--studio-line)] bg-[var(--studio-media)] sm:w-40" onClick={() => void preview(work)}>{work.previewUrl ? work.workType === "video" ? <video src={work.previewUrl} muted playsInline preload="metadata" className="size-full object-cover" /> : <img src={work.previewUrl} alt="" className="size-full object-cover" /> : <span className="grid size-full place-items-center px-3 text-xs text-[var(--studio-muted)]">{work.status === "preparing" ? "画面准备中" : "查看作品"}</span>}</button> : null}
                <div className="min-w-0 flex-1 space-y-3">
                <div className="flex flex-wrap items-center gap-2"><Tag>{sharedWorkTypeNames[work.workType]}</Tag><h3 className="min-w-0 break-words font-medium">{work.title}</h3><Tag color={work.status === "published" ? "success" : work.status === "failed" ? "error" : work.status === "pending" || work.status === "preparing" ? "processing" : "default"}>{sharedWorkStatusNames[work.status]}</Tag></div>
                <p className="text-xs text-[var(--studio-muted)]">{work.creatorName} · {work.category} · {new Date(work.createdAt).toLocaleString("zh-CN")}</p>
                {work.description ? <p className="whitespace-pre-wrap break-words text-sm">{work.description}</p> : null}
                {work.reviewReason ? <p className="rounded bg-[var(--studio-surface-hover)] p-3 text-sm">原因：{work.reviewReason}</p> : null}
                <div className="flex flex-wrap gap-2">
                    {work.status !== "withdrawn" ? <Button size="small" icon={<Eye className="size-3.5" />} loading={previewing === work.shareCode} onClick={() => void preview(work)}>预览</Button> : null}
                    {work.status === "published" ? <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => copyText(`${window.location.origin}/share/${work.shareCode}`, "公开链接已复制")}>复制公开链接</Button> : null}
                    {review && work.status === "pending" ? <><Button size="small" type="primary" loading={busy === work.shareCode} onClick={() => modal.confirm({ title: "通过这条投稿？", content: "通过后作品将公开展示在 Fantastic Show。", onOk: () => act(work, "approve") })}>通过</Button><Button size="small" danger onClick={() => { setReason(""); setDecision({ work, action: "reject" }); }}>驳回</Button></> : null}
                    {review && work.status === "published" ? <Button size="small" danger onClick={() => { setReason(""); setDecision({ work, action: "takeDown" }); }}>下架</Button> : null}
                    {!review && work.status !== "withdrawn" && work.status !== "preparing" && work.status !== "failed" ? <Button size="small" danger loading={busy === work.shareCode} onClick={() => modal.confirm({ title: "撤回这条投稿？", content: "撤回后公开链接停止访问，分享副本将异步清理。需要再次发布时请创建新投稿。", onOk: () => act(work, "withdraw") })}>撤回</Button> : null}
                </div>
                </div>
            </article>)}
        </div>}
        {data && data.total > 20 ? <Pagination current={page} total={data.total} pageSize={20} showSizeChanger={false} onChange={setPage} /> : null}
        <Modal title={detail?.work.title} open={Boolean(detail)} onCancel={() => setDetail(null)} footer={null} width={960} destroyOnHidden styles={{ body: { maxHeight: "calc(100dvh - 140px)", overflowY: "auto" } }}>{detail ? <div className="space-y-4">{JSON.stringify(detail.snapshot).includes("shared-asset:") ? <Alert type={detail.work.status === "failed" ? "warning" : "info"} showIcon title={detail.work.status === "failed" ? "画面副本没有准备成功，下面是已保存的内容" : "画面仍在后台准备，完成后可刷新再看"} /> : null}<SharedContent snapshot={detail.snapshot} /></div> : null}</Modal>
        <Modal title={decision?.action === "reject" ? "驳回投稿" : "下架作品"} open={Boolean(decision)} onCancel={() => { if (!busy) setDecision(null); }} mask={{ closable: !busy }} confirmLoading={Boolean(busy)} okButtonProps={{ disabled: !reason.trim() }} onOk={() => decision && act(decision.work, decision.action, reason)}>
            <label htmlFor="shared-work-review-reason" className="mb-2 block text-sm">请填写原因，作者可查看</label><Input.TextArea id="shared-work-review-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} showCount rows={4} />
        </Modal>
    </div>;
}
