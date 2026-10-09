"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Alert, Button, Empty, Input, Progress, Spin, Tag } from "antd";
import { CheckCircle2, ChevronRight, FileText, RefreshCw, Scissors } from "lucide-react";

import {
    confirmScriptSourceStructure,
    getScriptSourceImportStatus,
    getScriptSourceSection,
    getScriptSourceTree,
    mergeScriptSourceSections,
    renameScriptSourceSection,
    retryScriptSourceImport,
    splitScriptSourceSection,
} from "@/services/api/script";
import { useScriptStore } from "@/features/script/stores/use-script-store";
import type {
    ScriptSourceFileEncoding,
    ScriptSourceFocus,
    ScriptSourceImportStatus,
    ScriptSourceSection,
    ScriptSourceSectionDetail,
    ScriptSourceTree,
} from "@/features/script/types";

/** 运行中按固定间隔查询导入进度。 */
const POLL_INTERVAL_MILLISECONDS = 2500;

/** 正文预览行数上限，避免超长章节一次性渲染过多节点。 */
const MAX_PREVIEW_LINES = 600;

/** 正文预览上限，避免超长章节一次性渲染过多节点。 */
const MAX_PREVIEW_CHARACTERS = 20000;

/** 定位证据时在目标前保留的上下文字符数。 */
const FOCUS_CONTEXT_CHARACTERS = 4000;

const STATUS_LABELS: Record<ScriptSourceImportStatus["status"], string> = {
    queued: "排队中",
    running: "解析中",
    completed: "已完成",
    failed: "解析失败",
};

const STAGE_LABELS: Record<string, string> = {
    uploaded: "读取原文件",
    sections: "写入章节与片段",
    completed: "已完成",
};

/** 原文导入状态、章节场次树与人工校对工作区；传入 focus 时跳转并高亮对应原文。 */
export function ScriptSourcePanel({ focus }: { focus?: ScriptSourceFocus | null }) {
    const projectId = useScriptStore((state) => state.project?.id || "");
    const { message, modal } = App.useApp();
    const [status, setStatus] = useState<ScriptSourceImportStatus | null>(null);
    const [tree, setTree] = useState<ScriptSourceTree | null>(null);
    const [detail, setDetail] = useState<ScriptSourceSectionDetail | null>(null);
    const [loadError, setLoadError] = useState("");
    const [detailError, setDetailError] = useState("");
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [mutating, setMutating] = useState(false);
    const [selectedId, setSelectedId] = useState("");
    const [titleDraft, setTitleDraft] = useState("");
    const [splitMode, setSplitMode] = useState(false);
    const [retryEncoding, setRetryEncoding] = useState<ScriptSourceFileEncoding>("UTF-8");
    const statusRef = useRef<ScriptSourceImportStatus | null>(null);
    const treeRef = useRef<ScriptSourceTree | null>(null);
    /* 项目没有原文等终止性错误只需查询一次，避免固定间隔反复请求。 */
    const stopPollingRef = useRef(false);
    treeRef.current = tree;

    const loadStatus = useCallback(async () => {
        if (!projectId) return;
        try {
            const next = await getScriptSourceImportStatus(projectId);
            statusRef.current = next;
            stopPollingRef.current = false;
            setStatus(next);
            setLoadError("");
        } catch (error) {
            const text = error instanceof Error ? error.message : "";
            if (text.includes("没有可校对的导入原文")) stopPollingRef.current = true;
            setLoadError(text || "原文导入状态加载失败");
        }
    }, [projectId]);

    /* 运行中按固定间隔查询，完成或失败后停止查询。 */
    useEffect(() => {
        if (!projectId) return;
        void loadStatus();
        const timer = window.setInterval(() => {
            if (stopPollingRef.current) return;
            const current = statusRef.current;
            if (current && (current.status === "completed" || current.status === "failed")) return;
            void loadStatus();
        }, POLL_INTERVAL_MILLISECONDS);
        return () => window.clearInterval(timer);
    }, [loadStatus, projectId]);

    const loadTree = useCallback(async () => {
        if (!projectId) return;
        try {
            const next = await getScriptSourceTree(projectId);
            setTree(next);
            setSelectedId((current) => next.sections.some((section) => section.id === current) ? current : (next.sections[0]?.id || ""));
            setStatus((current) => current ? { ...current, revision: next.revision, confirmedRevision: next.confirmedRevision } : current);
            setLoadError("");
        } catch (error) {
            setLoadError(error instanceof Error ? error.message : "原文目录加载失败");
        }
    }, [projectId]);

    useEffect(() => {
        if (status?.status === "completed" && !treeRef.current) void loadTree();
    }, [loadTree, status?.status]);

    /* 证据定位：选中包含起点的最深结构段，子场景优先于章节。 */
    useEffect(() => {
        if (!focus || !tree) return;
        const containing = tree.sections.filter((section) => section.startOffset <= focus.start && focus.start < section.endOffset);
        const target = containing.find((section) => section.parentId) || containing[0];
        if (target) setSelectedId(target.id);
    }, [focus, tree]);

    const selectedSection = useMemo(() => tree?.sections.find((section) => section.id === selectedId) || null, [selectedId, tree]);
    const siblings = useMemo(() => (tree && selectedSection ? tree.sections.filter((section) => section.parentId === selectedSection.parentId) : []), [selectedSection, tree]);
    const siblingIndex = useMemo(() => siblings.findIndex((section) => section.id === selectedId), [selectedId, siblings]);

    useEffect(() => {
        setTitleDraft(selectedSection?.title || "");
        setSplitMode(false);
    }, [selectedSection?.id, selectedSection?.title]);

    const loadDetail = useCallback(async () => {
        if (!projectId || !selectedId) {
            setDetail(null);
            return;
        }
        setLoadingDetail(true);
        setDetailError("");
        try {
            setDetail(await getScriptSourceSection(projectId, selectedId));
        } catch (error) {
            setDetail(null);
            setDetailError(error instanceof Error ? error.message : "原文正文加载失败");
        } finally {
            setLoadingDetail(false);
        }
    }, [projectId, selectedId]);

    useEffect(() => { void loadDetail(); }, [loadDetail]);

    /* 用已保存的编码初始化“切换编码”提示，避免把 GB18030 原文改回 UTF-8。 */
    useEffect(() => {
        if (status?.textEncoding === "UTF-8" || status?.textEncoding === "GB18030") setRetryEncoding(status.textEncoding);
    }, [status?.textEncoding]);

    /** 确认当前结构修订，确认后才能启动故事知识库分析。 */
    const confirmStructure = async () => {
        if (!tree) return;
        setMutating(true);
        try {
            const next = await confirmScriptSourceStructure(projectId, tree.revision);
            statusRef.current = next;
            setStatus(next);
            setTree((current) => (current ? { ...current, confirmedRevision: next.confirmedRevision } : current));
            message.success("已确认当前原文结构，可以前往故事知识库分析");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "确认结构失败，请刷新后重试");
        } finally {
            setMutating(false);
        }
    };

    const runMutation = async (action: () => Promise<{ revision: number }>, done: string) => {
        setMutating(true);
        try {
            const result = await action();
            setTree((current) => (current ? { ...current, revision: result.revision } : current));
            message.success(done);
            await Promise.all([loadTree(), loadDetail()]);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "原文结构校对失败，请重试");
        } finally {
            setMutating(false);
        }
    };

    const rename = () => {
        if (!tree || !selectedSection) return;
        const title = titleDraft.trim();
        if (!title) {
            message.warning("结构段标题不能为空");
            return;
        }
        if (title === selectedSection.title) return;
        void runMutation(() => renameScriptSourceSection(projectId, selectedSection.id, tree.revision, title), "标题已更新");
    };

    const mergeWith = (other: ScriptSourceSection) => {
        if (!tree || !selectedSection) return;
        modal.confirm({
            title: `合并“${selectedSection.title}”与“${other.title}”？`,
            content: "两段正文按原顺序拼接为一段，原文件不会改变。",
            okText: "确认合并",
            cancelText: "取消",
            onOk: () => runMutation(() => mergeScriptSourceSections(projectId, selectedSection.id, other.id, tree.revision), "结构段已合并"),
        });
    };

    const splitAt = (offsetInSection: number) => {
        if (!tree || !selectedSection) return;
        const defaultTitle = `${selectedSection.title} · 续`;
        let nextTitle = defaultTitle;
        modal.confirm({
            title: "拆分为新结构段",
            content: <Input defaultValue={defaultTitle} maxLength={255} placeholder="新结构段标题" onChange={(event) => { nextTitle = event.target.value; }} />,
            okText: "确认拆分",
            cancelText: "取消",
            onOk: () => {
                if (!nextTitle.trim()) {
                    message.warning("新结构段标题不能为空");
                    return Promise.reject(new Error("empty title"));
                }
                return runMutation(() => splitScriptSourceSection(projectId, selectedSection.id, tree.revision, selectedSection.startOffset + offsetInSection, nextTitle.trim()), "结构段已拆分");
            },
        });
    };

    /** 重新排队失败任务；传入新编码时一并更新TXT解码方式。 */
    const retry = async (encoding?: ScriptSourceFileEncoding) => {
        setMutating(true);
        try {
            const next = await retryScriptSourceImport(projectId, encoding);
            statusRef.current = next;
            setStatus(next);
            message.success(encoding ? "已按新编码重新排队解析" : "已重新排队解析");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "重新解析失败，请重试");
        } finally {
            setMutating(false);
        }
    };

    /** 编码不匹配时切换TXT编码并立即重试。 */
    const switchEncodingAndRetry = () => {
        const next: ScriptSourceFileEncoding = retryEncoding === "UTF-8" ? "GB18030" : "UTF-8";
        setRetryEncoding(next);
        void retry(next);
    };

    if (!projectId) return null;

    if (!status) {
        if (!loadError) {
            return <section className="flex min-h-0 flex-1 items-center justify-center p-6"><Spin /></section>;
        }
        const missing = loadError.includes("没有可校对的导入原文");
        return (
            <section className="flex min-h-0 flex-1 items-center justify-center p-6">
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={missing ? "该项目还没有导入原文" : loadError}>
                    {missing ? <p className="max-w-sm text-xs text-[var(--studio-muted)]">回到剧本项目库，用“上传剧本 / 小说”创建带原文的项目后，可以在这里校对章节与场次。</p> : <Button onClick={() => void loadStatus()}>重试</Button>}
                </Empty>
            </section>
        );
    }

    const polling = status != null && (status.status === "queued" || status.status === "running");
    const percent = status && status.totalSections > 0 ? Math.min(100, Math.round((status.processedSections / status.totalSections) * 100)) : 0;
    const fileName = status?.fileName || tree?.fileName || "";
    /* 只有 TXT 需要用户明确编码；DOCX 与 DOC 由解析器自行读取。 */
    const textEncoding = status?.textEncoding === "UTF-8" || status?.textEncoding === "GB18030" ? status.textEncoding : null;
    const nextEncoding: ScriptSourceFileEncoding = retryEncoding === "UTF-8" ? "GB18030" : "UTF-8";

    return (
        <section className="flex min-h-0 flex-col">
            <header className="flex flex-wrap items-center gap-3 border-b border-[var(--studio-line)] px-4 py-3 sm:px-6">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[var(--studio-ink)]"><FileText className="size-4 text-[var(--studio-primary)]" aria-hidden="true" /><span className="truncate">{fileName || "导入原文"}</span></div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--studio-faint)]">
                        {status ? <Tag color={status.status === "completed" ? "green" : status.status === "failed" ? "red" : "blue"}>{STATUS_LABELS[status.status]}</Tag> : null}
                        {status ? <span>{STAGE_LABELS[status.stage] || status.stage}</span> : null}
                        {tree ? <span>{tree.sourceType === "novel" ? "小说" : "剧本"}</span> : null}
                        {tree ? <span>修订 {tree.revision}</span> : null}
                        {tree ? (tree.confirmedRevision === tree.revision ? <Tag color="green">结构已确认</Tag> : <Tag color="gold">结构待确认</Tag>) : null}
                        {status && status.totalSections ? <span>{status.processedSections} / {status.totalSections} 段</span> : null}
                    </div>
                </div>
                {polling ? <Progress percent={percent} showInfo={false} size="small" className="w-32" strokeColor="var(--studio-primary)" /> : null}
                {tree && tree.confirmedRevision !== tree.revision ? <Button size="small" type="primary" icon={<CheckCircle2 className="size-3.5" />} loading={mutating} onClick={() => void confirmStructure()}>确认结构</Button> : null}
                <Button size="small" icon={<RefreshCw className="size-3.5" />} disabled={mutating} onClick={() => void loadStatus().then(() => (statusRef.current?.status === "completed" ? loadTree() : undefined))}>刷新</Button>
            </header>

            {status?.status === "failed" ? (
                <Alert
                    type="error"
                    showIcon
                    className="mx-4 mt-3 sm:mx-6"
                    title="原文解析失败"
                    description={<div className="flex flex-col gap-2"><span>{status.errorMessage || "请检查文件内容后重试"}</span><span className="flex items-center gap-2">{textEncoding ? <Button size="small" onClick={switchEncodingAndRetry}>切换为 {nextEncoding} 并重试</Button> : null}<Button size="small" type="primary" loading={mutating} onClick={() => void retry()}>重新解析</Button></span></div>}
                />
            ) : null}
            {status?.warning ? <Alert type="warning" showIcon className="mx-4 mt-3 sm:mx-6" title={status.warning} description="可在此处人工校对标题与边界。" /> : null}
            {loadError && status ? <Alert type="warning" showIcon className="mx-4 mt-3 sm:mx-6" title={loadError} action={<Button size="small" onClick={() => void loadTree()}>重试</Button>} /> : null}

            {polling ? <div className="flex flex-1 items-center justify-center p-6 text-sm text-[var(--studio-muted)]"><Spin /> <span className="ml-3">正在解析原文结构，可稍后返回本页查看</span></div> : null}

            {!polling && status.status === "completed" && !tree ? <div className="flex flex-1 items-center justify-center p-6"><Spin /></div> : null}

            {!polling && status.status === "completed" && tree ? (
                <div className="grid min-h-0 flex-1 lg:grid-cols-[300px_minmax(0,1fr)]">
                    <aside className="min-h-0 overflow-y-auto border-r border-[var(--studio-line)] p-3" aria-label="原文目录">
                        {tree.sections.length ? tree.sections.filter((section) => !section.parentId).map((section) => (
                            <SectionNode key={section.id} section={section} sections={tree.sections} selectedId={selectedId} onSelect={setSelectedId} />
                        )) : <p className="px-2 py-3 text-xs text-[var(--studio-faint)]">没有可校对的章节或场次</p>}
                    </aside>
                    <div className="flex min-h-0 flex-col">
                        {selectedSection ? (
                            <>
                                <div className="flex flex-wrap items-center gap-2 border-b border-[var(--studio-line)] px-4 py-3">
                                    <Input value={titleDraft} maxLength={255} onChange={(event) => setTitleDraft(event.target.value)} onPressEnter={rename} className="max-w-sm" aria-label="结构段标题" />
                                    <Button size="small" type="primary" loading={mutating} disabled={titleDraft.trim() === selectedSection.title} onClick={rename}>保存标题</Button>
                                    <Button size="small" icon={<Scissors className="size-3.5" />} type={splitMode ? "primary" : "default"} onClick={() => setSplitMode((current) => !current)}>{splitMode ? "退出拆分" : "拆分"}</Button>
                                    <Button size="small" disabled={siblingIndex <= 0 || mutating} onClick={() => mergeWith(siblings[siblingIndex - 1])}>与上一段合并</Button>
                                    <Button size="small" disabled={siblingIndex < 0 || siblingIndex >= siblings.length - 1 || mutating} onClick={() => mergeWith(siblings[siblingIndex + 1])}>与下一段合并</Button>
                                    <span className="text-xs text-[var(--studio-faint)]">{selectedSection.startOffset} – {selectedSection.endOffset}{selectedSection.needsReview ? " · 待校对" : ""}</span>
                                </div>
                                {splitMode ? <p className="border-b border-[var(--studio-line)] bg-[var(--studio-primary-soft)] px-4 py-2 text-xs text-[var(--studio-muted)]">点击正文中任意一行开头的“在此拆分”，把该行起的正文划为新结构段。</p> : null}
                                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
                                    {loadingDetail ? <div className="flex items-center gap-3 text-sm text-[var(--studio-muted)]"><Spin size="small" />正在读取正文</div> : detailError ? <Alert type="error" showIcon title={detailError} action={<Button size="small" onClick={() => void loadDetail()}>重试</Button>} /> : detail ? <SectionContent content={detail.content} splitEnabled={splitMode} onSplit={splitAt} highlight={focus && detail.section.id === selectedId ? { start: focus.start - detail.section.startOffset, end: focus.end - detail.section.startOffset, key: focus.key } : null} /> : null}
                                </div>
                            </>
                        ) : <div className="flex flex-1 items-center justify-center"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择左侧章节或场次" /></div>}
                    </div>
                </div>
            ) : null}
        </section>
    );
}

function SectionNode({ section, sections, selectedId, onSelect }: { section: ScriptSourceSection; sections: ScriptSourceSection[]; selectedId: string; onSelect: (id: string) => void }) {
    const children = sections.filter((item) => item.parentId === section.id);
    const active = selectedId === section.id;
    return (
        <div>
            <button
                type="button"
                aria-current={active ? "page" : undefined}
                style={active ? { background: "var(--studio-action)", color: "var(--studio-action-foreground)" } : undefined}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-[var(--studio-action)] ${active ? "font-semibold shadow-sm" : "text-[var(--studio-text)] hover:bg-[var(--studio-surface-hover)]"}`}
                onClick={() => onSelect(section.id)}
                title={section.title}
            >
                <span className="min-w-0 flex-1 truncate text-current">{section.title}</span>
                {section.needsReview ? <Tag color="gold" className="mr-0">待校对</Tag> : null}
                {children.length ? <span className="text-xs text-current opacity-70">{children.length}</span> : null}
            </button>
            {children.length ? (
                <div className="ml-3 border-l border-[var(--studio-line)] pl-2">
                    {children.map((child) => (
                        <button
                            key={child.id}
                            type="button"
                            aria-current={selectedId === child.id ? "page" : undefined}
                            style={selectedId === child.id ? { background: "var(--studio-action)", color: "var(--studio-action-foreground)" } : undefined}
                            className={`flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-[var(--studio-action)] ${selectedId === child.id ? "font-semibold shadow-sm" : "text-[var(--studio-muted)] hover:bg-[var(--studio-surface-soft)] hover:text-[var(--studio-ink)]"}`}
                            onClick={() => onSelect(child.id)}
                            title={child.title}
                        >
                            <ChevronRight className="size-3 shrink-0 text-current" aria-hidden="true" />
                            <span className="min-w-0 flex-1 truncate text-current">{child.title}</span>
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

function SectionContent({ content, splitEnabled, onSplit, highlight }: { content: string; splitEnabled: boolean; onSplit: (offsetInSection: number) => void; highlight: { start: number; end: number; key: string } | null }) {
    const highlightRef = useRef<HTMLParagraphElement | null>(null);
    /* 只渲染可见预览窗口内的行；定位证据时把窗口移到目标附近，超长章节也能看到证据原文。 */
    const { lines, truncated, windowStart } = useMemo(() => {
        let from = 0;
        if (highlight && highlight.start > MAX_PREVIEW_CHARACTERS - FOCUS_CONTEXT_CHARACTERS) {
            const lineStart = content.lastIndexOf("\n", Math.max(0, highlight.start - FOCUS_CONTEXT_CHARACTERS));
            from = lineStart < 0 ? 0 : lineStart + 1;
        }
        const preview = content.slice(from, from + MAX_PREVIEW_CHARACTERS);
        const result: Array<{ start: number; text: string }> = [];
        let cursor = from;
        for (const rawLine of preview.split("\n")) {
            if (result.length >= MAX_PREVIEW_LINES) break;
            result.push({ start: cursor, text: rawLine });
            cursor += rawLine.length + 1;
        }
        return { lines: result, truncated: from > 0 || content.length > cursor, windowStart: from };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- 父组件每次渲染都会新建 highlight 对象，只按起点变化重算窗口。
    }, [content, highlight?.start]);

    useEffect(() => {
        highlightRef.current?.scrollIntoView({ block: "center" });
    }, [highlight?.key, windowStart]);

    if (!content) return <p className="text-sm text-[var(--studio-muted)]">该结构段没有正文</p>;

    return (
        <div className="flex flex-col">
            {truncated ? <p className="mb-3 text-xs text-[var(--studio-warning)]">{windowStart > 0 ? `正文过长，当前显示第 ${windowStart} 字符起的片段` : `正文过长，仅显示前 ${MAX_PREVIEW_LINES} 行且不超过 ${MAX_PREVIEW_CHARACTERS} 字符`}，拆分位置只能在可见范围内选择。</p> : null}
            {lines.map((line, index) => {
                const lineEnd = line.start + line.text.length;
                const markStart = highlight ? Math.max(0, highlight.start - line.start) : 0;
                const markEnd = highlight ? Math.min(line.text.length, highlight.end - line.start) : 0;
                const marked = markEnd > markStart;
                const anchor = highlight != null && highlight.start >= line.start && highlight.start <= lineEnd;
                return (
                    <div key={`${index}-${line.start}`} className="group flex items-start gap-2">
                        <span className="w-14 shrink-0 select-none pt-0.5 text-right text-[10px] leading-6 text-[var(--studio-faint)]">{line.start}</span>
                        {splitEnabled && (index > 0 || windowStart > 0) && line.text.trim() ? (
                            <button type="button" className="mt-1 shrink-0 rounded border border-dashed border-[var(--studio-line-strong)] px-1.5 py-0.5 text-[10px] text-[var(--studio-muted)] hover:border-[var(--studio-action)] hover:text-[var(--studio-ink)] focus-visible:outline-2 focus-visible:outline-[var(--studio-action)]" onClick={() => onSplit(line.start)} title="在此拆分">
                                <Scissors className="mr-1 inline size-3" aria-hidden="true" />拆分
                            </button>
                        ) : null}
                        <p ref={anchor ? highlightRef : undefined} className={line.text.trim() ? "min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--studio-text)]" : "min-w-0 flex-1 text-sm leading-6 text-[var(--studio-faint)]"}>
                            {marked ? <>{line.text.slice(0, markStart)}<mark className="rounded-sm bg-[var(--studio-primary-soft)] px-0.5 text-[var(--studio-ink)] ring-1 ring-[var(--studio-primary)]">{line.text.slice(markStart, markEnd)}</mark>{line.text.slice(markEnd)}</> : (line.text || "\u00A0")}
                        </p>
                    </div>
                );
            })}
        </div>
    );
}
