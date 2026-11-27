"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Select, Spin } from "antd";
import { ArrowLeft, Check, GripVertical } from "lucide-react";
import Link, { useRouter } from "@/shared/lib/team-navigation";
import { useTranslation } from "@/features/locale/use-translation";
import { ThemePreferenceMenu } from "@/features/theme/components/theme-preference-menu";
import { UserCreditMenu } from "@/features/app-shell/components/user-credit-menu";
import { useEffectiveConfig } from "@/features/settings/stores/use-config-store";
import {
    DEFAULT_IMAGE_LAST_USED_SETTINGS,
    DEFAULT_VIDEO_LAST_USED_SETTINGS,
    loadDramaLastUsedSettings,
    loadImageLastUsedSettings,
    loadVideoLastUsedSettings,
    saveDramaLastUsedSettings,
} from "@/features/generation/lib/last-used-generation-settings";
import { availableVideoResolutions, videoModelSupportsMode } from "@/features/generation/lib/video-billing";
import { sizeFromAspectRatio } from "@/features/generation/components/video-settings-panel";
import type { AiConfig, VideoGenerationMode, VideoResolution } from "@/features/settings/stores/use-config-store";
import { cancelAiTasksWithRefundPolicy } from "@/features/generation/lib/cancel-provider-generation";
import { agentSubscribeEvents, cancelAgentChat } from "@/features/canvas/api/agent";
import { getAgentSessionHistory, getAiTaskInfo, type ServerAgentSessionHistoryMessage } from "@/services/api/server";
import {
    confirmDramaStage,
    discardDramaVersion,
    dramaStages,
    generateDramaMedia,
    getDramaWorkspace,
    regenerateDramaStage,
    sendDramaMessage,
    updateDramaProject,
    updateDramaShots,
    type DramaMedia,
    type DramaShotItem,
    type DramaStage,
    type DramaVersion,
    type DramaWorkspace,
} from "@/services/api/drama";
import { dramaAspectRatio } from "./aspect-ratio";
import { DramaArtifact } from "./artifact-view";
import { parseDramaMeta } from "./chat/stage-card";
import { dramaStageMeta } from "./stage-meta";
import { computeShotTimeline, formatShotNumber, parseShotList, resolveShotThumbnail, type TimedDramaShot } from "./lib/shot-utils";
import { DramaLeftSidebar, type LeftSidebarTab } from "./workbench/left-sidebar";
import { DramaStoryboardTable } from "./workbench/storyboard-table";
import { DramaRealtimePreview } from "./workbench/realtime-preview";
import { DramaRhythmTimeline } from "./workbench/rhythm-timeline";
import { DramaAgentSidebar } from "./workbench/agent-sidebar";
import "./workbench/drama-workbench.css";

type CenterMode = "storyboard" | "preview";
type MobilePanel = "left" | "center" | "chat";

/** 智能短剧四区专业工作台：左资源/参数 + 中分镜表/预览/成片 + 右 AI 协作进度 + 底部节奏时间轴。 */
export function DramaWorkbench({ projectId }: { projectId: string }) {
    const translate = useTranslation();
    const router = useRouter();
    const { message, modal } = App.useApp();
    const config = useEffectiveConfig();

    const [workspace, setWorkspace] = useState<DramaWorkspace | null>(null);
    const [messages, setMessages] = useState<ServerAgentSessionHistoryMessage[]>([]);
    const [streaming, setStreaming] = useState<{ id: string; text: string } | null>(null);
    const [loading, setLoading] = useState(true);
    const [missing, setMissing] = useState(false);

    const [follow, setFollow] = useState(true);
    const [picked, setPicked] = useState<DramaStage>("plan");
    const [versionId, setVersionId] = useState<string | null>(null);
    const [leftTab, setLeftTab] = useState<LeftSidebarTab>("shots");
    const [centerMode, setCenterMode] = useState<CenterMode>("storyboard");
    const [mobilePanel, setMobilePanel] = useState<MobilePanel>("center");
    const [selectedShotRef, setSelectedShotRef] = useState("");

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
    const [settingsHydrated, setSettingsHydrated] = useState(false);

    const [pendingKeys, setPendingKeys] = useState<string[]>([]);
    const [stoppingTaskId, setStoppingTaskId] = useState("");
    const [stopping, setStopping] = useState(false);
    const [filling, setFilling] = useState(false);

    const [shotDrafts, setShotDrafts] = useState<DramaShotItem[]>([]);
    const [savingShots, setSavingShots] = useState(false);
    const [shotsSavedHint, setShotsSavedHint] = useState(false);

    const batchRef = useRef(0);
    const refreshRef = useRef<{ projectId: string; promise: Promise<DramaWorkspace> } | null>(null);
    const sendKey = useRef({ text: "", id: "" });
    const confirmKey = useRef({ versionId: "", id: "" });
    const saveTimerRef = useRef<number | null>(null);
    const savedHintTimerRef = useRef<number | null>(null);
    const dirtyShotsRef = useRef(false);
    const latestWorkspaceRef = useRef<DramaWorkspace | null>(null);

    useEffect(() => {
        latestWorkspaceRef.current = workspace;
    }, [workspace]);

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
        if (!settingsHydrated) return;
        if (!imageModel && config.imageModel) setImageModel(config.imageModel);
    }, [config.imageModel, imageModel, settingsHydrated]);

    useEffect(() => {
        if (!settingsHydrated) return;
        if (!videoModel && config.videoModel) setVideoModel(config.videoModel);
    }, [config.videoModel, settingsHydrated, videoModel]);

    useEffect(() => {
        let active = true;
        void Promise.all([loadDramaLastUsedSettings(), loadImageLastUsedSettings(), loadVideoLastUsedSettings()]).then(([drama, image, video]) => {
            if (!active) return;
            if (drama.imageModel) setImageModel(drama.imageModel);
            if (drama.videoModel) setVideoModel(drama.videoModel);
            setImageQuality(drama.imageQuality || image.quality || "medium");
            setImageResolution(drama.imageResolution || image.imageResolution || "2K");
            setVideoSettings(video);
            setVideoResolution(drama.videoResolution || video.vquality || "720p");
            setSettingsHydrated(true);
        });
        return () => { active = false; };
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
        const settle = () => {
            void refresh().catch(() => undefined).finally(() => setStreaming(null));
        };
        const onEvent = (event: MessageEvent) => {
            let data: { sessionId?: string; errorMessage?: string; message?: string; resultData?: { projectId?: string } } = {};
            try { data = JSON.parse(event.data); } catch { return; }
            if (data.sessionId && data.sessionId !== sessionId) return;
            if (data.resultData?.projectId && data.resultData.projectId !== projectId) return;
            if (event.type === "error" || event.type === "canceled") {
                setNotice({ status: event.type === "canceled" ? "canceled" : "failed", message: data.errorMessage || data.message || "" });
                settle();
                return;
            }
            if (event.type === "drama-stage") setNotice(null);
            void refresh().catch(() => undefined);
        };
        const onDelta = (event: MessageEvent) => {
            let data: { sessionId?: string; messageId?: string; delta?: string } = {};
            try { data = JSON.parse(event.data); } catch { return; }
            if (data.sessionId && data.sessionId !== sessionId) return;
            const { messageId, delta } = data;
            if (!messageId || !delta) return;
            setStreaming((current) => current?.id === messageId
                ? { id: current.id, text: current.text + delta }
                : { id: messageId, text: delta });
        };
        const onComplete = (event: MessageEvent) => {
            let data: { sessionId?: string } = {};
            try { data = JSON.parse(event.data); } catch { return; }
            if (data.sessionId && data.sessionId !== sessionId) return;
            settle();
        };
        for (const type of ["drama-stage", "queue-status", "error", "canceled"]) source.addEventListener(type, onEvent);
        source.addEventListener("text-delta", onDelta);
        source.addEventListener("task-complete", onComplete);
        return () => source.close();
    }, [projectId, refresh, workspace?.project.sessionId]);

    useEffect(() => {
        if (workspace && !nameFocused) setName(workspace.project.name);
    }, [nameFocused, workspace]);

    useEffect(() => {
        return () => {
            if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
            if (savedHintTimerRef.current) window.clearTimeout(savedHintTimerRef.current);
        };
    }, []);

    const project = workspace?.project;
    const viewed = (follow ? project?.currentStage : picked) || "plan";
    const stageVersions = useMemo(
        () => (workspace?.versions || []).filter((item) => item.stage === viewed).sort((left, right) => right.versionNumber - left.versionNumber),
        [viewed, workspace?.versions],
    );
    const selected = stageVersions.find((item) => item.id === versionId) || stageVersions[0];
    const latestPlan = useMemo(() => latestOf(workspace?.versions, "plan"), [workspace?.versions]);
    const latestScript = useMemo(() => latestOf(workspace?.versions, "script"), [workspace?.versions]);
    const latestCast = useMemo(() => latestOf(workspace?.versions, "cast"), [workspace?.versions]);
    const latestShot = useMemo(() => latestOf(workspace?.versions, "shot"), [workspace?.versions]);

    const activeShotVersion = viewed === "shot" && selected?.stage === "shot" ? selected : latestShot;
    const isLatestShotVersion = Boolean(activeShotVersion && latestShot && activeShotVersion.id === latestShot.id);

    const parsedServerShots = useMemo(() => parseShotList(activeShotVersion?.content), [activeShotVersion]);

    // 仅在非本地编辑中或切换版本时，将服务端分镜同步到本地草稿。
    const serverShotsFingerprint = useMemo(
        () => `${activeShotVersion?.id || ""}:${JSON.stringify(parsedServerShots)}`,
        [activeShotVersion?.id, parsedServerShots],
    );
    useEffect(() => {
        if (dirtyShotsRef.current) return;
        setShotDrafts(parsedServerShots);
    }, [parsedServerShots, serverShotsFingerprint]);

    const { items: timedShots, totalSeconds } = useMemo(() => computeShotTimeline(shotDrafts), [shotDrafts]);

    useEffect(() => {
        if (timedShots.length === 0) {
            setSelectedShotRef("");
            return;
        }
        if (!selectedShotRef || !timedShots.some((item) => item.ref === selectedShotRef)) {
            setSelectedShotRef(timedShots[0].ref);
        }
    }, [selectedShotRef, timedShots]);

    // 当项目推进到 shot 时切回分镜表。
    useEffect(() => {
        if (!follow || !project) return;
        if (project.currentStage === "shot") setCenterMode("storyboard");
    }, [follow, project]);

    const currentVersions = (workspace?.versions || []).filter((item) => item.stage === project?.currentStage).sort((left, right) => right.versionNumber - left.versionNumber);
    const frontier = currentVersions[0];
    const canConfirm = Boolean(
        project
        && project.status !== "completed"
        && frontier
        && frontier.confirmationStatus === "pending"
        && !busy
        && (viewed === project.currentStage || (centerMode === "storyboard" && project.currentStage === "shot")),
    );
    const currentIndex = project ? dramaStages.indexOf(project.currentStage) : 0;

    const mediaByKey = useMemo(() => {
        const map: Record<string, DramaMedia> = {};
        for (const item of workspace?.media || []) {
            if (!map[item.targetKey]) map[item.targetKey] = item;
        }
        return map;
    }, [workspace?.media]);

    const productionShotRefs = useMemo(() => timedShots.map((item) => item.ref), [timedShots]);
    const mergedShotDurations = useMemo(() => {
        const map: Record<string, number> = {};
        for (const item of timedShots) map[item.ref] = item.durationSeconds;
        return map;
    }, [timedShots]);

    const hasAnyLastFrame = productionShotRefs.some((ref) => mediaByKey[`shot-last:${ref}`]?.status === "success");
    const hasAnyShotVisual = timedShots.some((item) => resolveShotThumbnail(item.ref, mediaByKey).kind !== "none");
    const videoMode = resolveDramaShotVideoMode(config, videoModel, hasAnyLastFrame);
    const videoResolutions = useMemo(
        () => availableVideoResolutions({ ...config, videoModel, videoGenerationMode: videoMode }, videoModel, videoMode),
        [config, videoMode, videoModel],
    );

    useEffect(() => {
        if (!settingsHydrated || !videoResolutions.length || videoResolutions.includes(videoResolution as VideoResolution)) return;
        setVideoResolution(videoResolutions[0]);
    }, [settingsHydrated, videoResolution, videoResolutions]);

    const handleImageModelChange = (value: string) => {
        setImageModel(value);
        void saveDramaLastUsedSettings({ imageModel: value });
    };
    const handleImageQualityChange = (value: string) => {
        setImageQuality(value);
        void saveDramaLastUsedSettings({ imageQuality: value });
    };
    const handleImageResolutionChange = (value: string) => {
        setImageResolution(value);
        void saveDramaLastUsedSettings({ imageResolution: value });
    };
    const handleVideoModelChange = (value: string) => {
        setVideoModel(value);
        void saveDramaLastUsedSettings({ videoModel: value });
    };
    const handleVideoResolutionChange = (value: string) => {
        setVideoResolution(value);
        void saveDramaLastUsedSettings({ videoResolution: value });
    };

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

    const persistShots = useCallback(async (nextShots: DramaShotItem[]) => {
        const currentWorkspace = latestWorkspaceRef.current;
        const shotVer = latestOf(currentWorkspace?.versions, "shot");
        if (!currentWorkspace || !shotVer || nextShots.length === 0) {
            dirtyShotsRef.current = false;
            return;
        }
        setSavingShots(true);
        try {
            const next = await updateDramaShots({
                projectId: currentWorkspace.project.id,
                revision: currentWorkspace.project.revision,
                versionId: shotVer.id,
                shots: nextShots.map(({ order: _ignored, ...rest }) => ({
                    ...rest,
                    picture: rest.picture.trim() || rest.title.trim() || rest.ref,
                })),
            });
            dirtyShotsRef.current = false;
            setWorkspace(next);
            setShotsSavedHint(true);
            if (savedHintTimerRef.current) window.clearTimeout(savedHintTimerRef.current);
            savedHintTimerRef.current = window.setTimeout(() => setShotsSavedHint(false), 2200);
        } catch (error) {
            dirtyShotsRef.current = false;
            message.error(error instanceof Error ? error.message : translate("common.serverRequestFailed_5ed90b"));
            void refresh().catch(() => undefined);
        } finally {
            setSavingShots(false);
        }
    }, [message, refresh, translate]);

    const scheduleShotSave = useCallback((nextShots: DramaShotItem[], immediate = false) => {
        dirtyShotsRef.current = true;
        if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
        if (immediate) {
            void persistShots(nextShots);
            return;
        }
        saveTimerRef.current = window.setTimeout(() => {
            void persistShots(nextShots);
        }, 800);
    }, [persistShots]);

    const handleUpdateShot = (ref: string, patch: Partial<DramaShotItem>) => {
        if (!isLatestShotVersion || busy) return;
        setShotDrafts((prev) => {
            const next = prev.map((item) => (item.ref === ref ? { ...item, ...patch } : item));
            scheduleShotSave(next, false);
            return next;
        });
    };

    const handleReorderShots = (fromIndex: number, toIndex: number) => {
        if (!isLatestShotVersion || busy || fromIndex === toIndex) return;
        setShotDrafts((prev) => {
            const copy = [...prev];
            const [moved] = copy.splice(fromIndex, 1);
            if (!moved) return prev;
            copy.splice(toIndex, 0, moved);
            const reordered = copy.map((item, idx) => ({ ...item, order: idx + 1 }));
            scheduleShotSave(reordered, true);
            return reordered;
        });
    };

    const handleDeleteShot = (ref: string) => {
        if (!isLatestShotVersion || busy) return;
        setShotDrafts((prev) => {
            if (prev.length <= 1) return prev;
            const filtered = prev.filter((item) => item.ref !== ref).map((item, idx) => ({ ...item, order: idx + 1 }));
            scheduleShotSave(filtered, true);
            return filtered;
        });
    };

    const send = async (override?: string) => {
        const text = (override ?? draft).trim();
        if (!project || !text || busy) return;
        if (sendKey.current.text !== text) sendKey.current = { text, id: crypto.randomUUID() };
        setStreaming(null);
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
            if (!override) setDraft("");
            setNotice(null);
            setWorkspace(next);
            if (next.project.sessionId) setMessages(await getAgentSessionHistory(next.project.sessionId));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("common.serverRequestFailed_5ed90b"));
        } finally {
            setSending(false);
        }
    };

    const viewStage = (stage: DramaStage, nextVersionId?: string) => {
        setFollow(false);
        setPicked(stage);
        setVersionId(nextVersionId || null);
        if (stage === "shot") setCenterMode("storyboard");
        setMobilePanel("center");
    };

    const regenerate = async (index: number) => {
        const meta = parseDramaMeta(messages[index]?.meta);
        if (meta?.kind === "stage" && meta.stage && project) {
            try {
                setStreaming(null);
                setWorkspace(await regenerateDramaStage({
                    clientRequestId: crypto.randomUUID(),
                    projectId: project.id,
                    revision: project.revision,
                    stage: meta.stage,
                }));
            } catch (error) {
                message.error(error instanceof Error ? error.message : translate("common.serverRequestFailed_5ed90b"));
            }
            return;
        }
        for (let cursor = index; cursor >= 0; cursor -= 1) {
            const item = messages[cursor];
            if (item.role === "user") {
                void send(item.text);
                return;
            }
        }
    };

    const undo = (targetVersionId: string) => {
        if (!project) return;
        modal.confirm({
            title: translate("drama.discardTitle"),
            content: translate("drama.discardHint"),
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    const next = await discardDramaVersion({ projectId: project.id, revision: project.revision, versionId: targetVersionId });
                    setWorkspace(next);
                    if (next.project.sessionId) setMessages(await getAgentSessionHistory(next.project.sessionId));
                    message.success(translate("drama.discardDone"));
                } catch (error) {
                    message.error(error instanceof Error ? error.message : translate("common.serverRequestFailed_5ed90b"));
                }
            },
        });
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
        if (!project?.sessionId || !workspace?.activeRequest.requestId || stopping) return;
        setStopping(true);
        try {
            await cancelAgentChat(project.sessionId, workspace.activeRequest.requestId);
            await refresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("common.serverRequestFailed_5ed90b"));
        } finally {
            setStopping(false);
        }
    };

    const generate = async (targetKey: string, customPrompt?: string) => {
        if (!project || pendingKeys.includes(targetKey)) return false;
        const stage: DramaStage = targetKey.startsWith("character:") || targetKey.startsWith("location:") ? "cast" : "shot";
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
        const shotVideoMode = resolveDramaShotVideoMode(config, model, mediaByKey[`shot-last:${ref}`]?.status === "success");
        setPendingKeys((keys) => (keys.includes(targetKey) ? keys : [...keys, targetKey]));
        try {
            const next = await generateDramaMedia({
                clientRequestId: crypto.randomUUID(),
                projectId: project.id,
                versionId: version.id,
                targetKey,
                model,
                prompt: customPrompt?.trim() || undefined,
                parameters: video
                    ? {
                        seconds: mergedShotDurations[ref] || Number(videoSettings.videoSeconds) || 5,
                        size: sizeFromAspectRatio({ ...config, videoModel: model, size: ratio, videoGenerationMode: shotVideoMode }, ratio),
                        resolution: videoResolution || "720p",
                        watermark: false,
                    }
                    : {
                        count: 1,
                        quality: imageQuality || "medium",
                        resolution: imageResolution || "2K",
                        size: targetKey.startsWith("character:") ? "3:2" : ratio,
                    },
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
                const current = mediaFrom(latest)[targetKey];
                const running = current?.status === "pending" || current?.status === "running";
                if (running) {
                    blocked += 1;
                    continue;
                }
                if (current?.status === "success") continue;
                const created = await generate(targetKey);
                if (created) started += 1;
                if (batchRef.current !== batch) return;
                latest = await refresh().catch(() => latest);
            }
            if (!started && blocked) message.warning(translate("drama.mediaStillRunning"));
        } finally {
            if (batchRef.current === batch) setFilling(false);
        }
    };

    const mentionShotInChat = (shot: TimedDramaShot) => {
        const token = `@镜头${formatShotNumber(shot.index)}(${shot.ref}) `;
        setDraft((prev) => (prev ? `${prev.trimEnd()} ${token}` : token));
        setMobilePanel("chat");
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
    const currentStageMeta = dramaStageMeta[project.currentStage] || dramaStageMeta.shot;
    const nextStage: DramaStage | undefined = project.status === "completed" ? undefined : dramaStages[currentIndex + 1];
    const confirmLabel = project.currentStage === "shot"
        ? translate("drama.confirmStoryboardAction")
        : nextStage
            ? translate("drama.confirmStageShortAction", { stage: translate(currentStageMeta.label) })
            : translate("drama.confirmLast");

    const showingEarlyStageArtifact = centerMode === "storyboard" && (viewed === "plan" || viewed === "script" || viewed === "cast");

    return (
        <main className="studio-page flex h-full min-h-0 flex-col overflow-hidden bg-[var(--studio-page)]">
            <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--studio-line)] bg-[var(--studio-rail)] px-3">
                <Link
                    href="/drama"
                    aria-label={translate("drama.backToList")}
                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-[var(--studio-muted)] hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]"
                >
                    <ArrowLeft className="size-4" />
                </Link>
                <input
                    id="drama-project-name"
                    value={name}
                    maxLength={120}
                    onFocus={() => setNameFocused(true)}
                    onBlur={() => { setNameFocused(false); if (name.trim() && name.trim() !== project.name) void saveSettings({ name: name.trim() }); }}
                    onChange={(event) => setName(event.target.value)}
                    className="min-w-28 flex-1 rounded-md bg-transparent px-2 py-1 text-sm font-semibold text-[var(--studio-ink)] outline-none hover:bg-[var(--studio-surface-hover)] focus:bg-[var(--studio-surface)]"
                />
                <span className="hidden items-center gap-1.5 rounded-md border border-[var(--studio-line)] bg-[var(--studio-surface)] px-2 py-0.5 text-[11px] font-medium text-[var(--studio-muted)] sm:inline-flex">
                    <span className="tabular-nums text-[var(--studio-ink)]">{Math.max(0, currentIndex) + 1}/{dramaStages.length}</span>
                    {translate(currentStageMeta.label)}
                </span>
                {project.status === "completed" ? (
                    <span className="rounded-md border border-[color-mix(in_srgb,var(--studio-success)_40%,transparent)] bg-[color-mix(in_srgb,var(--studio-success)_14%,var(--studio-surface))] px-2 py-0.5 text-[11px] font-medium text-[var(--studio-success)]">
                        {translate("drama.completed")}
                    </span>
                ) : null}
                <ThemePreferenceMenu variant="toolbar" />
                <UserCreditMenu />
            </header>

            <div className="flex shrink-0 gap-1 border-b border-[var(--studio-line)] bg-[var(--studio-rail)] px-3 py-1.5 lg:hidden">
                {([
                    { key: "left", label: translate("drama.tabShots") },
                    { key: "center", label: translate("drama.work") },
                    { key: "chat", label: translate("drama.chat") },
                ] as const).map((item) => (
                    <button
                        key={item.key}
                        type="button"
                        style={mobilePanel === item.key ? { background: "var(--studio-action)", color: "var(--studio-action-foreground)" } : undefined}
                        className={`rounded-md px-3 py-1 text-xs! font-medium ${mobilePanel === item.key ? "" : "text-[var(--studio-muted)]! hover:bg-[var(--studio-surface-hover)]"}`}
                        onClick={() => setMobilePanel(item.key)}
                    >
                        {item.label}
                    </button>
                ))}
            </div>

            <div className="drama-workbench-body">
                <div className={`drama-workbench-pane ${mobilePanel === "left" ? "flex flex-1" : "hidden"} flex-col`}>
                    <DramaLeftSidebar
                        tab={leftTab}
                        onTabChange={setLeftTab}
                        shots={timedShots}
                        totalSeconds={totalSeconds}
                        selectedShotRef={selectedShotRef}
                        onSelectShot={(ref) => {
                            setSelectedShotRef(ref);
                            if (showingEarlyStageArtifact) {
                                setFollow(false);
                                setPicked("shot");
                            }
                            setMobilePanel("center");
                        }}
                        project={project}
                        planVersion={latestPlan}
                        scriptVersion={latestScript}
                        castVersion={latestCast}
                        mediaByKey={mediaByKey}
                        pendingKeys={pendingKeys}
                        busy={busy}
                        config={config}
                        imageModel={imageModel}
                        videoModel={videoModel}
                        imageQuality={imageQuality}
                        imageResolution={imageResolution}
                        videoResolution={videoResolution}
                        videoResolutions={videoResolutions}
                        filling={filling}
                        stoppingTaskId={stoppingTaskId}
                        onImageModelChange={handleImageModelChange}
                        onImageQualityChange={handleImageQualityChange}
                        onImageResolutionChange={handleImageResolutionChange}
                        onVideoModelChange={handleVideoModelChange}
                        onVideoResolutionChange={handleVideoResolutionChange}
                        onSaveProjectSettings={(patch) => void saveSettings(patch)}
                        onGenerateMedia={(key) => void generate(key)}
                        onStopMedia={(media) => void stopMedia(media)}
                        onGenerateMissingCast={(keys) => void generateMissing(keys)}
                        onJumpStage={(stage) => viewStage(stage)}
                    />
                </div>

                <section className={`drama-workbench-pane ${mobilePanel === "center" ? "flex flex-1" : "hidden"} flex-col bg-[var(--studio-page)]`}>
                    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--studio-line)] bg-[var(--studio-rail)] px-3.5 py-2">
                        <div className="flex items-center gap-1">
                            <GripVertical className="mr-1 size-3.5 text-[var(--studio-faint)]" aria-hidden="true" />
                            {([
                                { key: "storyboard", label: project.currentStage === "shot" && canConfirm ? translate("drama.modeConfirmStoryboard") : translate("drama.modeStoryboard") },
                                { key: "preview", label: translate("drama.modeRealtimePreview") },
                            ] as const).map((item) => {
                                const active = centerMode === item.key && !showingEarlyStageArtifact;
                                return (
                                    <button
                                        key={item.key}
                                        type="button"
                                        onClick={() => {
                                            setCenterMode(item.key);
                                            if (item.key === "storyboard" && latestShot) {
                                                setFollow(false);
                                                setPicked("shot");
                                                setVersionId(null);
                                            }
                                        }}
                                        className={`rounded-md px-2.5 py-1 text-xs! font-medium transition-colors ${
                                            active
                                                ? "bg-[var(--studio-surface-raised)] text-[var(--studio-ink)]!"
                                                : "text-[var(--studio-muted)]! hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]!"
                                        }`}
                                    >
                                        {item.label}
                                    </button>
                                );
                            })}
                        </div>

                        <div className="flex items-center gap-2">
                            {stageVersions.length > 1 ? (
                                <Select
                                    size="small"
                                    value={selected?.id}
                                    options={stageVersions.map((item) => ({
                                        value: item.id,
                                        label: translate("drama.version", { value0: item.versionNumber }),
                                    }))}
                                    onChange={setVersionId}
                                />
                            ) : null}
                            {!follow ? (
                                <button
                                    type="button"
                                    className="text-xs! font-medium text-[var(--studio-action)]! hover:underline"
                                    onClick={() => { setFollow(true); setVersionId(null); }}
                                >
                                    {translate("drama.followProgress")}
                                </button>
                            ) : null}
                        </div>
                    </div>

                    {showingEarlyStageArtifact ? (
                        <div className="flex min-h-0 flex-1 flex-col">
                            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--studio-line)] px-5 py-3">
                                <div className="flex items-center gap-2">
                                    <h2 className="text-sm font-semibold text-[var(--studio-ink)]">{translate(dramaStageMeta[viewed].label)}</h2>
                                    {selected ? (
                                        <span className="rounded bg-[var(--studio-surface-raised)] px-2 py-0.5 text-[11px] text-[var(--studio-muted)]">
                                            {translate("drama.version", { value0: selected.versionNumber })}
                                        </span>
                                    ) : null}
                                    {selected?.confirmationStatus === "confirmed" ? (
                                        <span className="rounded bg-[color-mix(in_srgb,var(--studio-success)_14%,var(--studio-surface))] px-2 py-0.5 text-[11px] font-medium text-[var(--studio-success)]">
                                            {translate("drama.confirmed")}
                                        </span>
                                    ) : null}
                                </div>
                                {canConfirm ? (
                                    <Button
                                        type="primary"
                                        size="middle"
                                        icon={<Check className="size-4" aria-hidden="true" />}
                                        loading={confirming}
                                        onClick={() => void confirm()}
                                    >
                                        {confirmLabel}
                                    </Button>
                                ) : null}
                            </div>
                            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                                <div className="mx-auto w-full max-w-[1160px]">
                                    <DramaArtifact
                                        stage={viewed}
                                        version={selected}
                                        generating={Boolean((busy || sending) && viewed === project.currentStage)}
                                        durationSeconds={project.durationSeconds}
                                        durationDisabled={busy}
                                        aspectRatio={dramaAspectRatio(project.aspectRatio)}
                                        onAspect={(aspectRatio) => void saveSettings({ aspectRatio })}
                                        onDuration={(durationSeconds) => void saveSettings({ durationSeconds })}
                                        mediaByKey={mediaByKey}
                                        pendingKeys={pendingKeys}
                                        shotRefs={productionShotRefs}
                                        shotDurations={mergedShotDurations}
                                        onGenerate={(targetKey) => void generate(targetKey)}
                                        onStop={(media) => void stopMedia(media)}
                                        onRequeried={() => void refresh()}
                                        stoppingTaskId={stoppingTaskId}
                                    />
                                </div>
                            </div>
                        </div>
                    ) : centerMode === "storyboard" ? (
                        timedShots.length > 0 ? (
                            <DramaStoryboardTable
                                shots={timedShots}
                                totalSeconds={totalSeconds}
                                targetDurationSeconds={project.durationSeconds}
                                aspectRatio={dramaAspectRatio(project.aspectRatio)}
                                selectedShotRef={selectedShotRef}
                                onSelectShot={setSelectedShotRef}
                                editable={isLatestShotVersion && !busy}
                                saving={savingShots}
                                savedHint={shotsSavedHint}
                                canConfirm={canConfirm}
                                confirming={confirming}
                                confirmLabel={confirmLabel}
                                onConfirm={() => void confirm()}
                                onUpdateShot={handleUpdateShot}
                                onReorderShots={handleReorderShots}
                                onDeleteShot={handleDeleteShot}
                                onMentionShot={mentionShotInChat}
                                mediaByKey={mediaByKey}
                                pendingKeys={pendingKeys}
                                filling={filling}
                                stoppingTaskId={stoppingTaskId}
                                onGenerateMedia={(targetKey, customPrompt) => void generate(targetKey, customPrompt)}
                                onStopMedia={(media) => void stopMedia(media)}
                                onRequeried={() => void refresh()}
                                onGenerateMissingVideos={() => void generateMissing(productionShotRefs.map((ref) => `shot-video:${ref}`))}
                            />
                        ) : (
                            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                                <div className="mx-auto w-full max-w-[1160px]">
                                    <DramaArtifact
                                        stage="shot"
                                        version={activeShotVersion}
                                        generating={Boolean((busy || sending) && project.currentStage === "shot")}
                                        durationSeconds={project.durationSeconds}
                                        durationDisabled={busy}
                                        aspectRatio={dramaAspectRatio(project.aspectRatio)}
                                        onDuration={(durationSeconds) => void saveSettings({ durationSeconds })}
                                        mediaByKey={mediaByKey}
                                        pendingKeys={pendingKeys}
                                        shotRefs={productionShotRefs}
                                        shotDurations={mergedShotDurations}
                                        onGenerate={(targetKey) => void generate(targetKey)}
                                        onStop={(media) => void stopMedia(media)}
                                        onRequeried={() => void refresh()}
                                        stoppingTaskId={stoppingTaskId}
                                    />
                                </div>
                            </div>
                        )
                    ) : (
                        <DramaRealtimePreview
                            shots={timedShots}
                            totalSeconds={totalSeconds}
                            selectedShotRef={selectedShotRef}
                            onSelectShot={setSelectedShotRef}
                            mediaByKey={mediaByKey}
                        />
                    )}
                </section>

                <div className={`drama-workbench-pane ${mobilePanel === "chat" ? "flex flex-1" : "hidden"} flex-col`}>
                    <DramaAgentSidebar
                        workspace={workspace}
                        messages={messages}
                        streaming={streaming}
                        busy={busy}
                        sending={sending}
                        stopping={stopping}
                        taskStatus={taskStatus}
                        taskMessage={taskMessage}
                        viewedStage={viewed}
                        shots={timedShots}
                        draft={draft}
                        canConfirm={canConfirm}
                        onDraftChange={setDraft}
                        onSend={(override) => void send(override)}
                        onStop={() => void stop()}
                        onViewStage={viewStage}
                        onRegenerate={(index) => void regenerate(index)}
                        onUndo={undo}
                    />
                </div>
            </div>

            <DramaRhythmTimeline
                shots={timedShots}
                totalSeconds={totalSeconds}
                selectedShotRef={selectedShotRef}
                onSelectShot={(ref) => {
                    setSelectedShotRef(ref);
                    if (showingEarlyStageArtifact && latestShot) {
                        setFollow(false);
                        setPicked("shot");
                    }
                }}
                hasAnyVisual={hasAnyShotVisual}
                mediaByKey={mediaByKey}
            />
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

function latestOf(versions: DramaVersion[] | undefined, stage: DramaStage) {
    return (versions || []).filter((item) => item.stage === stage).sort((left, right) => right.versionNumber - left.versionNumber)[0];
}

/** 分镜视频模式：未开启首尾帧（或图生视频）但开启了全能参考时自动回退到全能参考，与服务端保持一致。 */
function resolveDramaShotVideoMode(config: AiConfig, model: string, hasLastFrame: boolean): VideoGenerationMode {
    const preferred: VideoGenerationMode = hasLastFrame ? "first-last-frame-to-video" : "image-to-video";
    if (!model || videoModelSupportsMode(config, model, preferred)) {
        return preferred;
    }
    if (videoModelSupportsMode(config, model, "reference-to-video")) {
        return "reference-to-video";
    }
    return preferred;
}
