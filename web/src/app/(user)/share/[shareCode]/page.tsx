"use client";
import { use, useEffect, useRef, useState } from "react";
import { Alert, App, Button, Spin, Tag } from "antd";
import { Copy, RefreshCw } from "lucide-react";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { SharedContent } from "@/features/shared-work/components/shared-content";
import { copySharedCanvas, getSharedWork, sharedWorkTypeNames, type SharedWorkDetail } from "@/services/api/shared-work";
import { useCopyText } from "@/shared/hooks/use-copy-text";

export default function SharedWorkPage({ params }: { params: Promise<{ shareCode: string }> }) {
    const { shareCode } = use(params);
    const user = useUserStore((state) => state.user);
    const openAuthModal = useUserStore((state) => state.openAuthModal);
    const { message } = App.useApp();
    const copyText = useCopyText();
    const [detail, setDetail] = useState<SharedWorkDetail | null>(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [copying, setCopying] = useState(false);
    const [revision, setRevision] = useState(0);
    const lastLoadedAt = useRef(0);
    useEffect(() => {
        const controller = new AbortController();
        setLoading(true); setError(""); setDetail(null);
        lastLoadedAt.current = Date.now();
        void getSharedWork(shareCode, true, controller.signal).then((result) => { if (!controller.signal.aborted) setDetail(result); }).catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "作品不存在或尚未公开"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, [shareCode, revision]);
    // 分享页媒体只有临时授权，页面可见且距上次加载超过二十分钟时自动重新拉取，避免长时间停留后媒体失效。
    useEffect(() => {
        const refreshIfStale = () => {
            if (document.visibilityState === "visible" && Date.now() - lastLoadedAt.current >= 20 * 60_000) setRevision((value) => value + 1);
        };
        const timer = window.setInterval(refreshIfStale, 20 * 60_000);
        document.addEventListener("visibilitychange", refreshIfStale);
        return () => {
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", refreshIfStale);
        };
    }, []);
    const copyCanvas = async () => {
        if (!user) { openAuthModal(`/share/${shareCode}`); return; }
        setCopying(true);
        try {
            const result = await copySharedCanvas(shareCode);
            message.success("已独立复制到个人空间，请选择自己的模型后继续生成");
            window.location.assign(`/canvas/${encodeURIComponent(result.documentId)}`);
        } catch (failure) { message.error(failure instanceof Error ? failure.message : "复制失败"); }
        finally { setCopying(false); }
    };
    return <main className="studio-page h-full overflow-y-auto"><div className="mx-auto max-w-6xl space-y-6 px-4 pb-6 pt-20 sm:px-6 md:pt-6">
        {loading ? <div className="grid min-h-80 place-items-center"><Spin /></div> : error ? <Alert type="warning" showIcon title="作品暂不可访问" description={error} action={<Button onClick={() => setRevision((value) => value + 1)}>重试</Button>} /> : detail ? <>
            <header className="space-y-4"><div className="flex flex-wrap items-center gap-2"><Tag>{sharedWorkTypeNames[detail.work.workType]}</Tag><Tag>{detail.work.category}</Tag></div><h1 className="studio-title break-words text-2xl font-semibold sm:text-3xl">{detail.work.title}</h1><p className="text-sm text-[var(--studio-muted)]">{detail.work.creatorName} · {new Date(detail.work.publishedAt || detail.work.createdAt).toLocaleDateString("zh-CN")}</p>{detail.work.description ? <p className="max-w-3xl whitespace-pre-wrap break-words text-sm leading-6">{detail.work.description}</p> : null}<div className="flex flex-wrap gap-2">
                {detail.work.workType === "canvas" ? <Button type="primary" loading={copying} onClick={() => void copyCanvas()}>{user ? "复制到我的画布" : "登录后复制到我的画布"}</Button> : null}
                <Button icon={<Copy className="size-4" />} onClick={() => copyText(`${window.location.origin}/share/${shareCode}`, "公开链接已复制")}>复制链接</Button><Button icon={<RefreshCw className="size-4" />} onClick={() => setRevision((value) => value + 1)}>刷新媒体授权</Button>
            </div></header>
            <SharedContent snapshot={detail.snapshot} />
            <p className="text-xs text-[var(--studio-muted)]">这是作者发布时的固定快照。媒体临时授权会过期，长期停留时页面会自动刷新，也可手动刷新媒体授权。</p>
        </> : null}
    </div></main>;
}
