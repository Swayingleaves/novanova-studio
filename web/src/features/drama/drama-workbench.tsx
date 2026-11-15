"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { App, Button, Input, Select, Spin } from "antd";
import { ArrowLeft, ArrowUp, LoaderCircle, Square } from "lucide-react";
import Link, { useRouter } from "@/shared/lib/team-navigation";
import { useTranslation } from "@/features/locale/use-translation";
import { ModelPicker } from "@/features/settings/components/model-picker";
import { useEffectiveConfig } from "@/features/settings/stores/use-config-store";
import { creditText } from "@/shared/lib/credit-amounts";
import { DEFAULT_IMAGE_LAST_USED_SETTINGS, DEFAULT_VIDEO_LAST_USED_SETTINGS, loadImageLastUsedSettings, loadVideoLastUsedSettings } from "@/features/generation/lib/last-used-generation-settings";
import { VIDEO_RESOLUTION_OPTIONS, availableVideoResolutions } from "@/features/generation/lib/video-billing";
import { sizeFromAspectRatio } from "@/features/generation/components/video-settings-panel";
import type { VideoResolution } from "@/features/settings/stores/use-config-store";
import { cancelAiTasksWithRefundPolicy } from "@/features/generation/lib/cancel-provider-generation";
import { dramaAspectRatio } from "./aspect-ratio";
import { agentSubscribeEvents, cancelAgentChat } from "@/features/canvas/api/agent";
import { getAgentSessionHistory, getAiTaskInfo, type ServerAgentSessionHistoryMessage } from "@/services/api/server";
import { confirmDramaStage, dramaStages, generateDramaMedia, getDramaWorkspace, sendDramaMessage, updateDramaProject, type DramaMedia, type DramaStage, type DramaVersion, type DramaWorkspace } from "@/services/api/drama";
import { DramaArtifact } from "./artifact-view";
import { dramaStageMeta } from "./stage-meta";

export function DramaWorkbench({ projectId }: { projectId: string }) {
    const translate = useTranslation();
    const router = useRouter();
    const { message, modal } = App.useApp();
    const config = useEffectiveConfig();
    const [workspace, setWorkspace] = useState<DramaWorkspace | null>(null);
    const [messages, setMessages] = useState<ServerAgentSessionHistoryMessage[]>([]);
    const [loading, setLoading] = useState(true);
    const [missing, setMissing] = useState(false);
    const [follow, setFollow] = useState(true);
    const [picked, setPicked] = useState<DramaStage>("plan");
    const [versionId, setVersionId] = useState<string | null>(null);
    const [panel, setPanel] = useState<"chat" | "work">("chat");
    const [tasksOpen, setTasksOpen] = useState(false);
    const [draft, setDraft] = useState("");
    const [name, setName] = useState("");
    const [nameFocused, setNameFocused] = useState(false);
    const [sending, setSending] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [notice, setNotice] = useState<{ status: string; message: string } | null>(null);
    const [imageModel, setImageModel] = useState("");
    const [videoModel, setVideoModel] = useState("");
    const [videoSettings, setVideoSettings] = useState(DEFAULT_VIDEO_LAST_USED_SETTINGS);
    const [imageQuality, setImageQuality] = useState(DEFAULT_IMAGE_LAST_USED_SETTINGS.quality);
    const [imageResolution, setImageResolution] = useState(DEFAULT_IMAGE_LAST_USED_SETTINGS.imageResolution);
    const [videoResolution, setVideoResolution] = useState(DEFAULT_VIDEO_LAST_USED_SETTINGS.vquality);
    const [pendingKeys, setPendingKeys] = useState<string[]>([]);
    const [stoppingTaskId, setStoppingTaskId] = useState("");
    const [filling, setFilling] = useState(false);
    const batchRef = useRef(0);
    const refreshRef = useRef<{ projectId: string; promise: Promise<DramaWorkspace> } | null>(null);
    const sendKey = useRef({ text: "", id: "" });
    const confirmKey = useRef({ versionId: "", id: "" });
    const endRef = useRef<HTMLDivElement>(null);

    const refresh = useCallback(async () => {
        if (refreshRef.current?.projectId === projectId) return refreshRef.current.promise;
        const request = (async () => {
            const next = await getDramaWorkspace(projectId);
            setWorkspace(next);
            setMissing(false);
            if (next.project.sessionId) {
                try {
                    setMessages(await getAgentSessionHistory(next.project.sessionId));
                } catch {
                    setMessages([]);
                }
            }
            return next;
        })();
        refreshRef.current = { projectId, promise: request };
        try {
            return await request;
        } finally {
            if (refreshRef.current?.promise === request) refreshRef.current = null;
        }
    }, [projectId]);

    useEffect(() => {
        let alive = true;
        void refresh().catch((error) => {
            if (!alive) return;
            setMissing(true);
            message.error(error instanceof Error ? error.message : translate("common.serverRequestFailed_5ed90b"));
        }).finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [message, refresh, translate]);

    const busy = workspace?.activeRequest.status === "queued" || workspace?.activeRequest.status === "running";
    const mediaBusy = (workspace?.media || []).some((item) => item.status === "pending" || item.status === "running");

    useEffect(() => {
        if (!imageModel && config.imageModel) setImageModel(config.imageModel);
    }, [config.imageModel, imageModel]);

    useEffect(() => {
        if (!videoModel && config.videoModel) setVideoModel(config.videoModel);
    }, [config.videoModel, videoModel]);

    useEffect(() => {
        void loadImageLastUsedSettings().then((settings) => {
            setImageQuality(settings.quality || "medium");
            setImageResolution(settings.imageResolution || "2K");
        });
        void loadVideoLastUsedSettings().then((settings) => {
            setVideoSettings(settings);
            setVideoResolution(settings.vquality || "720p");
        });
    }, []);

    useEffect(() => {
        if (!busy && !mediaBusy) return;
        const timer = window.setInterval(() => { void refresh().catch(() => undefined); }, 3000);
        return () => window.clearInterval(timer);
    }, [busy, mediaBusy, refresh]);

    useEffect(() => {
        const sessionId = workspace?.project.sessionId;
        if (!sessionId) return;
        const source = agentSubscribeEvents();
        const onEvent = (event: MessageEvent) => {
            let data: { sessionId?: string; errorMessage?: string; message?: string; resultData?: { projectId?: string } } = {};
            try { data = JSON.parse(event.data); } catch { return; }
            if (data.sessionId && data.sessionId !== sessionId) return;
            if (data.resultData?.projectId && data.resultData.projectId !== projectId) return;
            if (event.type === "error" || event.type === "canceled") {
                setNotice({ status: event.type === "canceled" ? "canceled" : "failed", message: data.errorMessage || data.message || "" });
            }
            if (event.type === "drama-stage") setNotice(null);
            void refresh().catch(() => undefined);
        };
        for (const type of ["drama-stage", "queue-status", "error", "canceled"]) source.addEventListener(type, onEvent);
        return () => source.close();
    }, [projectId, refresh, workspace?.project.sessionId]);

    useEffect(() => {
        if (workspace && !nameFocused) setName(workspace.project.name);
    }, [nameFocused, workspace]);

    useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages, busy]);

    const project = workspace?.project;
    const viewed = (follow ? project?.currentStage : picked) || "plan";
    const stageVersions = useMemo(() => (workspace?.versions || []).filter((item) => item.stage === viewed).sort((left, right) => right.versionNumber - left.versionNumber), [viewed, workspace?.versions]);
    const selected = stageVersions.find((item) => item.id === versionId) || stageVersions[0];
    const currentVersions = (workspace?.versions || []).filter((item) => item.stage === project?.currentStage).sort((left, right) => right.versionNumber - left.versionNumber);
    const frontier = currentVersions[0];
    const canConfirm = Boolean(project && project.status !== "completed" && viewed === project.currentStage && frontier && selected?.id === frontier.id && frontier.confirmationStatus === "pending" && !busy);
    const currentIndex = project ? dramaStages.indexOf(project.currentStage) : 0;
    const mediaByKey = useMemo(() => {
        const map: Record<string, DramaMedia> = {};
        for (const item of workspace?.media || []) {
            if (!map[item.targetKey]) map[item.targetKey] = item;
        }
        return map;
    }, [workspace?.media]);
    const storyboardShotRefs = useMemo(() => refsOf(latestOf(workspace?.versions, "storyboard")?.content.shots), [workspace?.versions]);
    const storyboardShotDurations = useMemo(() => shotDurationMap(latestOf(workspace?.versions, "storyboard")?.content.shots), [workspace?.versions]);
    const videoMode = viewed === "shot" || viewed === "preview" ? "reference-to-video" : storyboardShotRefs.some((ref) => mediaByKey[`board:${ref}`]?.status === "success") ? "image-to-video" : "text-to-video";
    const videoResolutions = useMemo(() => availableVideoResolutions({ ...config, videoModel, videoGenerationMode: videoMode }, videoModel, videoMode), [config, videoMode, videoModel]);

    useEffect(() => {
        if (!videoResolutions.length || videoResolutions.includes(videoResolution as VideoResolution)) return;
        setVideoResolution(videoResolutions[0]);
    }, [videoResolution, videoResolutions]);

    const saveSettings = async (patch: { name?: string; textModel?: string; durationSeconds?: number; aspectRatio?: string }) => {
        if (!project) return;
        try {
            const next = await updateDramaProject({
                projectId: project.id,
                revision: project.revision,
                name: patch.name ?? project.name,
                textModel: patch.textModel ?? project.textModel,
                durationSeconds: patch.durationSeconds,
                aspectRatio: patch.aspectRatio ?? project.aspectRatio,
            });
            setWorkspace(next);
            message.success(translate("drama.saved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("common.serverRequestFailed_5ed90b"));
            void refresh().catch(() => undefined);
        }
    };

    const send = async () => {
        const text = draft.trim();
        if (!project || !text || busy) return;
        if (sendKey.current.text !== text) sendKey.current = { text, id: crypto.randomUUID() };
        setSending(true);
        try {
            const next = await sendDramaMessage({
                clientRequestId: sendKey.current.id,
                projectId: project.id,
                revision: project.revision,
                message: text,
                viewedStage: viewed,
                imageModel,
                videoModel,
                imageQuality,
                imageResolution,
                videoResolution,
            });
            sendKey.current = { text: "", id: "" };
            setDraft("");
            setNotice(null);
            setWorkspace(next);
            if (next.project.sessionId) setMessages(await getAgentSessionHistory(next.project.sessionId));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("common.serverRequestFailed_5ed90b"));
        } finally {
            setSending(false);
        }
    };

    const confirm = async () => {
        if (!project || !frontier) return;
        if (confirmKey.current.versionId !== frontier.id) confirmKey.current = { versionId: frontier.id, id: crypto.randomUUID() };
        setConfirming(true);
        try {
            const next = await confirmDramaStage({
                clientRequestId: confirmKey.current.id,
                projectId: project.id,
                revision: project.revision,
                versionId: frontier.id,
            });
            confirmKey.current = { versionId: "", id: "" };
            setFollow(true);
            setWorkspace(next);
            if (next.project.sessionId) setMessages(await getAgentSessionHistory(next.project.sessionId));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("common.serverRequestFailed_5ed90b"));
            void refresh().catch(() => undefined);
        } finally {
            setConfirming(false);
        }
    };

    const stop = async () => {
        if (!project?.sessionId || !workspace?.activeRequest.requestId) return;
        try {
            await cancelAgentChat(project.sessionId, workspace.activeRequest.requestId);
            await refresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("common.serverRequestFailed_5ed90b"));
        }
    };

    const generate = async (targetKey: string) => {
        if (!project || pendingKeys.includes(targetKey)) return false;
        const stage: DramaStage = targetKey.startsWith("sheet:") || targetKey.startsWith("shot-video:") || targetKey.startsWith("board:") ? "storyboard" : targetKey.startsWith("character:") || targetKey.startsWith("location:") ? "cast" : "shot";
        const version = viewed === stage && selected?.stage === stage ? selected : latestOf(workspace?.versions, stage);
        if (!version) {
            message.warning(translate("drama.noVersion"));
            return false;
        }
        const video = targetKey.startsWith("shot-video:");
        const model = video ? videoModel : imageModel;
        if (!model) {
            message.warning(translate("drama.mediaModelMissing"));
            return false;
        }
        const ref = targetKey.slice(targetKey.lastIndexOf(":") + 1);
        const ratio = dramaAspectRatio(project.aspectRatio);
        setPendingKeys((keys) => keys.includes(targetKey) ? keys : [...keys, targetKey]);
        try {
            const next = await generateDramaMedia({
                clientRequestId: crypto.randomUUID(),
                projectId: project.id,
                versionId: version.id,
                targetKey,
                model,
                parameters: video
                    ? { seconds: shotSeconds(workspace?.versions, ref, videoSettings.videoSeconds), size: sizeFromAspectRatio({ ...config, videoModel: model, size: ratio, videoGenerationMode: "reference-to-video" }, ratio), resolution: videoResolution || "720p", watermark: false }
                    : { count: 1, quality: imageQuality || "medium", resolution: imageResolution || "2K", size: targetKey.startsWith("sheet:") ? "16:9" : targetKey.startsWith("character:") ? "3:2" : ratio },
            });
            setWorkspace(next);
            return true;
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("common.serverRequestFailed_5ed90b"));
            return false;
        } finally {
            setPendingKeys((keys) => keys.filter((key) => key !== targetKey));
        }
    };

    const stopMedia = async (media: DramaMedia) => {
        if (!media.taskId || stoppingTaskId) return;
        setStoppingTaskId(media.taskId);
        try {
            const info = await getAiTaskInfo(media.taskId).catch(() => null);
            if (info && info.status !== "pending" && info.status !== "running") {
                await refresh();
                message.info(translate("drama.mediaAlreadyFinished"));
                return;
            }
            const outcome = await cancelAiTasksWithRefundPolicy([media.taskId], modal);
            if (outcome === "declined" || outcome === "empty") return;
            await refresh();
            message.success(translate(outcome === "forfeited" ? "generation.generationStoppedWithoutRefund" : "generation.generationStoppedCreditsRefunded"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("common.serverRequestFailed_5ed90b"));
        } finally {
            setStoppingTaskId("");
        }
    };

    const generateMissing = async (targetKeys: string[]) => {
        const needsVideo = targetKeys.some((key) => key.startsWith("shot-video:"));
        const needsImage = targetKeys.some((key) => !key.startsWith("shot-video:"));
        if ((needsVideo && !videoModel) || (needsImage && !imageModel)) {
            message.warning(translate("drama.mediaModelMissing"));
            return;
        }
        const batch = ++batchRef.current;
        setFilling(true);
        let latest = workspace;
        let started = 0;
        let blocked = 0;
        try {
            for (const targetKey of targetKeys) {
                if (batchRef.current !== batch) return;
                if (targetKey.startsWith("sheet:")) {
                    const waited = await waitForPreviousFrame(targetKey, latest, batch);
                    if (waited === false) return;
                    if (waited) latest = waited;
                }
                const current = mediaFrom(latest)[targetKey];
                const running = current?.status === "pending" || current?.status === "running";
                if (running) {
                    blocked += 1;
                    continue;
                }
                if (current?.status === "success" && !sheetNeedsFrames(targetKey, mediaFrom(latest))) continue;
                const created = await generate(targetKey);
                if (!created && targetKey.startsWith("sheet:")) return;
                if (created) started += 1;
                if (batchRef.current !== batch) return;
                latest = await refresh().catch(() => latest);
            }
            if (!started && blocked) message.warning(translate("drama.mediaStillRunning"));
        } finally {
            if (batchRef.current === batch) setFilling(false);
        }
    };

    const waitForPreviousFrame = async (targetKey: string, latest: DramaWorkspace | null, batch: number) => {
        const ref = targetKey.slice("sheet:".length);
        const index = storyboardShotRefs.indexOf(ref);
        const previous = index > 0 ? storyboardShotRefs[index - 1] : "";
        if (!previous) return latest;
        const frameKey = `cut:last:${previous}`;
        const sheetKey = `sheet:${previous}`;
        let current = latest;
        for (let attempt = 0; attempt < 90; attempt += 1) {
            if (batchRef.current !== batch) return false;
            const media = mediaFrom(current);
            const frame = media[frameKey];
            if (frame?.status === "success" && frame.storageKey) return current;
            const sheet = media[sheetKey];
            if (sheet?.status === "failed" || sheet?.status === "canceled") {
                message.warning(translate("drama.previousSheetFailed"));
                return false;
            }
            if (attempt === 89) break;
            await new Promise((resolve) => window.setTimeout(resolve, 2000));
            current = await refresh().catch(() => current);
        }
        message.warning(translate("drama.previousFrameMissing"));
        return false;
    };

    const onDraftKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
        event.preventDefault();
        void send();
    };

    if (loading) {
        return (
            <main className="studio-page flex h-full items-center justify-center">
                <Spin size="large" />
            </main>
        );
    }
    if (!project || missing) {
        return (
            <main className="studio-page flex h-full flex-col items-center justify-center gap-3 px-6">
                <p className="text-sm text-[var(--studio-muted)]">{translate("drama.empty")}</p>
                <Button onClick={() => router.push("/drama")}>{translate("drama.backToList")}</Button>
            </main>
        );
    }

    const taskStatus = busy ? workspace.activeRequest.status : notice?.status || "";
    const taskMessage = busy ? workspace.activeRequest.message : notice?.message || "";

    return (
        <main className="studio-page flex h-full min-h-0 flex-col overflow-hidden">
            <header className="flex flex-wrap items-center gap-2 border-b border-[var(--studio-line)] bg-[var(--studio-panel-solid)] px-3 py-2.5 sm:px-4">
                <Link href="/drama" aria-label={translate("drama.backToList")} className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-[var(--studio-muted)] hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]">
                    <ArrowLeft className="size-4" />
                </Link>
                <input
                    id="drama-project-name"
                    value={name}
                    maxLength={120}
                    onFocus={() => setNameFocused(true)}
                    onBlur={() => { setNameFocused(false); if (name.trim() && name.trim() !== project.name) void saveSettings({ name: name.trim() }); }}
                    onChange={(event) => setName(event.target.value)}
                    className="min-w-36 flex-1 rounded-lg bg-transparent px-2 py-1 text-sm font-semibold text-[var(--studio-ink)] outline-none hover:bg-[var(--studio-surface-hover)] focus:bg-[var(--studio-surface)]"
                />
                <span className="inline-flex items-center rounded-full bg-[var(--studio-primary-soft)] px-2.5 py-1 text-xs font-medium text-[var(--studio-ink)]">{translate(dramaStageMeta[project.currentStage].label)}</span>
                {project.status === "completed" ? <StatusPill tone="success">{translate("drama.completed")}</StatusPill> : null}
                <span className="text-xs tabular-nums text-[var(--studio-muted)]">{translate("drama.credits", { value0: creditText(project.textCredits) })}</span>
                <ModelPicker config={config} value={project.textModel} onChange={(textModel) => { if (textModel !== project.textModel) void saveSettings({ textModel }); }} capability="text" className="max-w-56 !border-[var(--studio-line-strong)] !bg-[var(--studio-surface)] !text-[var(--studio-ink)] shadow-none" />
            </header>
            <div className="flex gap-1 border-b border-[var(--studio-line)] bg-[var(--studio-panel-solid)] px-3 py-2 lg:hidden">
                {(["chat", "work"] as const).map((item) => (
                    <button
                        key={item}
                        type="button"
                        style={panel === item ? { background: "var(--studio-action)", color: "var(--studio-action-foreground)" } : undefined}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ${panel === item ? "" : "text-[var(--studio-muted)] hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]"}`}
                        onClick={() => setPanel(item)}
                    >
                        {translate(item === "chat" ? "drama.chat" : "drama.work")}
                    </button>
                ))}
            </div>
            <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(320px,400px)_minmax(0,1fr)]">
                <section className={`${panel === "chat" ? "flex" : "hidden"} min-h-0 flex-col border-[var(--studio-line)] bg-[var(--studio-panel-solid)] lg:flex lg:border-r`}>
                    <div className="flex shrink-0 items-center border-b border-[var(--studio-line)] px-4 py-2.5">
                        <img src="/icons/novanovastudio-icon.svg" alt="" aria-hidden="true" className="size-6" />
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                        {messages.length === 0 && !busy ? (
                            <div className="flex h-full min-h-40 items-center justify-center">
                                <p className="max-w-xs text-center text-sm leading-6 text-[var(--studio-muted)]">{translate("drama.noMessages")}</p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-3">
                                {messages.map((item) => {
                                    const isUser = item.role === "user";
                                    return (
                                        <div key={item.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                                            <p className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-6 ${isUser ? "rounded-br-md bg-[var(--studio-action)] text-[var(--studio-action-foreground)]" : "rounded-bl-md border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] text-[var(--studio-ink)]"}`}>{item.text}</p>
                                        </div>
                                    );
                                })}
                                {busy ? (
                                    <div className="flex justify-start">
                                        <p className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] px-3.5 py-2.5 text-sm text-[var(--studio-muted)]">
                                            <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                                            {statusText(translate, taskStatus)}
                                        </p>
                                    </div>
                                ) : null}
                            </div>
                        )}
                        <div ref={endRef} />
                    </div>
                    <div className="border-t border-[var(--studio-line)] px-3 py-3 sm:px-4">
                        {canConfirm ? (
                            <div className="mb-3 rounded-xl border border-[var(--studio-primary-line)] bg-[var(--studio-primary-soft)] p-3">
                                <p className="text-xs leading-5 text-[var(--studio-text)]">{translate("drama.confirmHint")}</p>
                                <Button className="mt-2" type="primary" loading={confirming} onClick={() => void confirm()}>{project.currentStage === "preview" ? translate("drama.confirmLast") : translate("drama.confirm")}</Button>
                            </div>
                        ) : null}
                        <div className="rounded-2xl border border-[var(--studio-composer-border)] bg-[var(--studio-composer-surface)] p-2">
                            <Input.TextArea
                                variant="borderless"
                                autoSize={{ minRows: 2, maxRows: 6 }}
                                maxLength={4000}
                                disabled={busy}
                                value={draft}
                                placeholder={translate("drama.messagePlaceholder")}
                                onChange={(event) => setDraft(event.target.value)}
                                onKeyDown={onDraftKeyDown}
                            />
                            <div className="flex items-center justify-between gap-2 px-1 pb-0.5">
                                <div className="flex min-w-0 items-center gap-2">
                                    <button type="button" className="inline-flex min-w-0 items-center gap-1.5 text-xs text-[var(--studio-muted)] hover:text-[var(--studio-ink)]" onClick={() => setTasksOpen((open) => !open)}>
                                        <span className={`size-1.5 shrink-0 rounded-full ${statusDot(taskStatus)}`} />
                                        <span className="truncate">{translate("drama.tasks")} · {statusText(translate, taskStatus)}</span>
                                    </button>
                                    {busy ? (
                                        <button type="button" className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--studio-ink)]" onClick={() => void stop()}>
                                            <Square className="size-3" aria-hidden="true" />
                                            {translate("drama.stop")}
                                        </button>
                                    ) : null}
                                </div>
                                <Button
                                    type="primary"
                                    shape="circle"
                                    aria-label={translate("drama.send")}
                                    icon={<ArrowUp className="size-4" />}
                                    disabled={busy || !draft.trim()}
                                    loading={sending}
                                    onClick={() => void send()}
                                />
                            </div>
                            {tasksOpen ? <p className="px-1 pt-2 text-xs leading-5 text-[var(--studio-muted)]">{taskMessage || translate("drama.noTaskDetail")}</p> : null}
                        </div>
                    </div>
                </section>
                <section className={`${panel === "work" ? "flex" : "hidden"} min-h-0 min-w-0 flex-col bg-[var(--studio-bg)] lg:flex`}>
                    <div className="flex items-center gap-2 border-b border-[var(--studio-line)] bg-[var(--studio-panel-solid)] px-3 py-2">
                        <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto" aria-label={translate("drama.work")}>
                            {dramaStages.map((stage, index) => {
                                const active = viewed === stage;
                                const reached = project.status === "completed" || index <= currentIndex;
                                const Icon = dramaStageMeta[stage].icon;
                                return (
                                    <button
                                        key={stage}
                                        type="button"
                                        style={active ? { background: "var(--studio-action)", borderColor: "var(--studio-action)", color: "var(--studio-action-foreground)" } : undefined}
                                        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium transition-colors ${active ? "" : reached ? "border-[var(--studio-line-strong)] bg-[var(--studio-surface)] text-[var(--studio-ink)] hover:border-[var(--studio-action)] hover:bg-[var(--studio-primary-soft)]" : "border-transparent text-[var(--studio-muted)] hover:border-[var(--studio-line)] hover:bg-[var(--studio-surface)] hover:text-[var(--studio-ink)]"}`}
                                        onClick={() => { setFollow(false); setPicked(stage); setVersionId(null); }}
                                    >
                                        <span className={`tabular-nums ${active ? "opacity-80" : "opacity-60"}`}>{index + 1}</span>
                                        <Icon className="size-3.5" aria-hidden="true" />
                                        {translate(dramaStageMeta[stage].label)}
                                    </button>
                                );
                            })}
                        </nav>
                        {!follow ? <button type="button" className="shrink-0 text-xs font-medium text-[var(--studio-action)]" onClick={() => setFollow(true)}>{translate("drama.followProgress")}</button> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--studio-line)] bg-[var(--studio-panel-solid)] px-4 py-2.5">
                        {stageVersions.length > 1 ? (
                            <Select size="small" value={selected?.id} options={stageVersions.map((item) => ({ value: item.id, label: versionLabel(translate, item) }))} onChange={setVersionId} />
                        ) : selected ? <span className="text-xs font-medium text-[var(--studio-text)]">{versionLabel(translate, selected)}</span> : null}
                        {selected?.confirmationStatus === "confirmed" ? <StatusPill tone="success">{translate("drama.confirmed")}</StatusPill> : selected ? <StatusPill tone="neutral">{translate("drama.pending")}</StatusPill> : null}
                        {selected?.freshness === "needs_update" ? <StatusPill tone="warning">{translate("drama.needsUpdate")}</StatusPill> : null}
                        {viewed === "cast" || viewed === "storyboard" || viewed === "shot" || viewed === "preview" ? <span className="rounded-full border border-[var(--studio-line-strong)] bg-[var(--studio-surface)] px-2.5 py-1 text-xs font-medium tabular-nums text-[var(--studio-ink)]">{dramaAspectRatio(project.aspectRatio)}</span> : null}
                        {viewed === "cast" || viewed === "storyboard" || viewed === "shot" ? <ModelPicker config={config} value={imageModel} onChange={setImageModel} capability="image" className="max-w-56 !border-[var(--studio-line-strong)] !bg-[var(--studio-surface)] !text-[var(--studio-ink)] shadow-none" /> : null}
                        {viewed === "cast" || viewed === "storyboard" || viewed === "shot" ? <SettingChips label={translate("drama.quality")} value={imageQuality} options={[{ value: "low", label: translate("generation.lowQuality_ebe981") }, { value: "medium", label: translate("generation.standardQuality_3da00d") }, { value: "high", label: translate("generation.highQuality_f31c44") }]} onChange={setImageQuality} /> : null}
                        {viewed === "cast" || viewed === "storyboard" || viewed === "shot" ? <SettingChips label={translate("drama.resolution")} value={imageResolution} options={["1K", "2K", "4K"].map((value) => ({ value, label: value }))} onChange={setImageResolution} /> : null}
                        {viewed === "shot" || viewed === "preview" ? <ModelPicker config={config} value={videoModel} onChange={setVideoModel} capability="video" className="max-w-56 !border-[var(--studio-line-strong)] !bg-[var(--studio-surface)] !text-[var(--studio-ink)] shadow-none" /> : null}
                        {viewed === "shot" || viewed === "preview" ? <SettingChips label={translate("drama.resolution")} value={videoResolution} options={(videoResolutions.length ? videoResolutions : [videoResolution as VideoResolution]).map((value) => ({ value, label: VIDEO_RESOLUTION_OPTIONS.find((item) => item.value === value)?.label || value }))} onChange={setVideoResolution} /> : null}
                        {viewed === "cast" || viewed === "storyboard" ? <Button size="small" loading={filling} disabled={pendingKeys.length > 0 || filling} onClick={() => void generateMissing(imageTargets(viewed, selected?.content))}>{translate("drama.generateMissingImages")}</Button> : null}
                        {viewed === "shot" ? <Button size="small" loading={filling} disabled={pendingKeys.length > 0 || filling} onClick={() => void generateMissing(storyboardShotRefs.map((ref) => `sheet:${ref}`))}>{translate("drama.generateMissingSheets")}</Button> : null}
                        {viewed === "shot" || viewed === "preview" ? <Button size="small" loading={filling} disabled={pendingKeys.length > 0 || filling} onClick={() => void generateMissing(storyboardShotRefs.map((ref) => `shot-video:${ref}`))}>{translate("drama.generateMissingVideos")}</Button> : null}
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
                        <div className="mx-auto w-full max-w-[1600px]">
                            <DramaArtifact stage={viewed} version={selected} durationSeconds={project.durationSeconds} durationDisabled={busy} aspectRatio={dramaAspectRatio(project.aspectRatio)} onAspect={(aspectRatio) => void saveSettings({ aspectRatio })} onDuration={(durationSeconds) => void saveSettings({ durationSeconds })} mediaByKey={mediaByKey} pendingKeys={pendingKeys} shotRefs={storyboardShotRefs} shotDurations={storyboardShotDurations} projectId={project.id} onWorkspace={setWorkspace} onGenerate={(targetKey) => void generate(targetKey)} onStop={(media) => void stopMedia(media)} stoppingTaskId={stoppingTaskId} />
                        </div>
                    </div>
                </section>
            </div>
        </main>
    );
}

function mediaFrom(workspace: DramaWorkspace | null) {
    const map: Record<string, DramaMedia> = {};
    for (const item of workspace?.media || []) {
        if (!map[item.targetKey]) map[item.targetKey] = item;
    }
    return map;
}

function sheetNeedsFrames(targetKey: string, media: Record<string, DramaMedia | undefined>) {
    if (!targetKey.startsWith("sheet:")) return false;
    const ref = targetKey.slice("sheet:".length);
    const first = media[`cut:first:${ref}`];
    const last = media[`cut:last:${ref}`];
    return first?.status !== "success" || !first.storageKey || last?.status !== "success" || !last.storageKey;
}

function latestOf(versions: DramaVersion[] | undefined, stage: DramaStage) {
    return (versions || []).filter((item) => item.stage === stage).sort((left, right) => right.versionNumber - left.versionNumber)[0];
}

function refsOf(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => item && typeof item === "object" && "ref" in item && typeof item.ref === "string" ? [item.ref] : []);
}

function shotDurationMap(value: unknown) {
    const map: Record<string, number> = {};
    if (!Array.isArray(value)) return map;
    for (const item of value) {
        if (!item || typeof item !== "object" || !("ref" in item) || typeof item.ref !== "string") continue;
        const seconds = "durationSeconds" in item ? Number(item.durationSeconds) : Number.NaN;
        if (Number.isFinite(seconds) && seconds > 0) map[item.ref] = Math.round(seconds);
    }
    return map;
}

function imageTargets(stage: DramaStage, content: Record<string, unknown> | undefined) {
    if (stage === "cast") return [...refsOf(content?.characters).map((ref) => `character:${ref}`), ...refsOf(content?.locations).map((ref) => `location:${ref}`)];
    if (stage === "storyboard") return refsOf(content?.shots).map((ref) => `board:${ref}`);
    return [];
}

function shotSeconds(versions: DramaVersion[] | undefined, ref: string, fallback: string) {
    const shots = latestOf(versions, "storyboard")?.content.shots;
    const shot = Array.isArray(shots) ? shots.find((item) => item && typeof item === "object" && "ref" in item && item.ref === ref) : undefined;
    const seconds = shot && typeof shot === "object" && "durationSeconds" in shot ? Number(shot.durationSeconds) : Number.NaN;
    if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds);
    const saved = Number(fallback);
    return Number.isFinite(saved) && saved > 0 ? saved : 5;
}

function SettingChips({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-[var(--studio-ink)]">{label}</span>
            {options.map((option) => (
                <button key={option.value} type="button" style={value === option.value ? { background: "var(--studio-action)", borderColor: "var(--studio-action)", color: "var(--studio-action-foreground)" } : undefined} className={`rounded-full border px-2.5 py-1 text-xs font-medium ${value === option.value ? "" : "border-[var(--studio-line-strong)] bg-[var(--studio-surface)] text-[var(--studio-ink)] hover:border-[var(--studio-action)] hover:bg-[var(--studio-primary-soft)]"}`} onClick={() => onChange(option.value)}>{option.label}</button>
            ))}
        </div>
    );
}

function versionLabel(translate: ReturnType<typeof useTranslation>, version: DramaVersion) {
    return translate("drama.version", { value0: version.versionNumber });
}

function statusText(translate: ReturnType<typeof useTranslation>, status: string) {
    if (status === "queued") return translate("drama.statusQueued");
    if (status === "running") return translate("drama.statusRunning");
    if (status === "failed") return translate("drama.statusFailed");
    if (status === "interrupted") return translate("drama.statusInterrupted");
    if (status === "canceled") return translate("drama.statusCanceled");
    return translate("drama.statusIdle");
}

function statusDot(status: string) {
    if (status === "queued" || status === "running") return "bg-[var(--studio-info)]";
    if (status === "failed") return "bg-[var(--studio-danger)]";
    if (status === "interrupted" || status === "canceled") return "bg-[var(--studio-warning)]";
    return "bg-[var(--studio-line-strong)]";
}

function StatusPill({ tone, children }: { tone: "neutral" | "success" | "warning"; children: string }) {
    const toneClass = tone === "success"
        ? "border border-[color-mix(in_srgb,var(--studio-success)_45%,transparent)] bg-[color-mix(in_srgb,var(--studio-success)_14%,var(--studio-surface))] text-[var(--studio-success)]"
        : tone === "warning"
            ? "border border-[color-mix(in_srgb,var(--studio-warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--studio-warning)_14%,var(--studio-surface))] text-[var(--studio-warning)]"
            : "border border-[var(--studio-line-strong)] bg-[var(--studio-surface)] text-[var(--studio-ink)]";
    return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${toneClass}`}>{children}</span>;
}
