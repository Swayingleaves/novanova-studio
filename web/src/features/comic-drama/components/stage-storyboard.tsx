"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Checkbox, Empty, Form, Image, Input, InputNumber, Modal, Select, Space, Spin, Tag, Tooltip } from "antd";
import {
    AlertCircle,
    Check,
    ChevronLeft,
    ChevronRight,
    Clapperboard,
    Copy,
    Edit,
    ExternalLink,
    Film,
    Grid,
    Image as ImageIcon,
    Info,
    Layers,
    LayoutGrid,
    Maximize2,
    Pause,
    Play,
    RotateCcw,
    Save,
    SkipBack,
    SkipForward,
    Sliders,
    Sparkles,
    Type,
    Music2,
    Plus,
    Trash2,
    Video,
    Volume2,
    VolumeX,
    ZoomIn,
    ZoomOut,
} from "lucide-react";

import { listComicDramaAssetVersions, readComicDramaMediaUrl } from "@/services/api/comic-drama";
import { getServerMediaInfo } from "@/services/api/server";
import { readAudioMetadata, uploadAudioFile } from "@/features/storage/services/audio-storage";
import { nanoid } from "nanoid";
import { useMediaAutoRefresh } from "../hooks/use-media-auto-refresh";
import { usePendingImpactTargets } from "../hooks/use-pending-impact-targets";
import { useComicDramaStore } from "../stores/use-comic-drama-store";
import type { ComicDramaAssetVersion, ComicDramaMediaResult, ComicDramaShot, ComicDramaShotInput, ComicDramaTimelineText, ComicDramaTimelineTextInput, ComicDramaVoiceTrack, ComicDramaVoiceTrackInput } from "../types";
import { ShotGenerationModal } from "./shot-generation-modal";
import { availableTextTrackPlacement, buildShotIntervals, clampPreviewPosition, clampTimelineStart, reorderTimelineTexts, timelineTextOverlaps, visibleTimelineTexts, voiceTrackEndMs, voiceTrackSourceTimeMs } from "./storyboard-timeline";

const CAMERA_MOVEMENT_OPTIONS = [
    "固定",
    "推近",
    "拉远",
    "环绕",
    "摇镜头",
    "移镜头",
    "俯冲",
    "仰视",
];

const SHOT_SIZES = [
    { value: "远景", label: "远景 (Extreme Long Shot)" },
    { value: "全景", label: "全景 (Long Shot)" },
    { value: "中景", label: "中景 (Medium Shot)" },
    { value: "近景", label: "近景 (Medium Close-Up)" },
    { value: "特写", label: "特写 (Close-Up)" },
    { value: "大特写", label: "大特写 (Extreme Close-Up)" },
];

const STATUS_MAP: Record<string, { label: string; color: string }> = {
    draft: { label: "草稿", color: "default" },
    ready: { label: "就绪", color: "blue" },
    generating: { label: "生成中", color: "processing" },
    completed: { label: "已完成", color: "success" },
    failed: { label: "失败", color: "error" },
    needsUpdate: { label: "需要更新", color: "warning" },
};

const ASSET_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
    character: { label: "人物", color: "blue" },
    scene: { label: "场景", color: "green" },
    prop: { label: "道具", color: "purple" },
};

const VARIANT_TYPE_LABELS: Record<string, string> = {
    default: "默认基准",
    costume: "服装变更",
    age: "年龄时期",
    weather: "光照/天气",
    status: "伤损/变身状态",
};

const PPS_MIN = 16;
const PPS_MAX = 130;
const EMPTY_VOICE_TRACKS: ComicDramaVoiceTrack[] = [];
const EMPTY_TIMELINE_TEXTS: ComicDramaTimelineText[] = [];
type TimelineClipDraft = { kind: "text"; item: ComicDramaTimelineTextInput } | { kind: "audio"; item: ComicDramaVoiceTrackInput };
type TimelineClipDrag = { id: string; kind: TimelineClipDraft["kind"]; mode: "move" | "left" | "right"; pointerX: number; original: TimelineClipDraft; latest: TimelineClipDraft; reorder?: ComicDramaTimelineText[] };

function pad2(n: number) {
    return String(n).padStart(2, "0");
}

function fmtTime(sec: number) {
    const s = Math.max(0, sec);
    const m = Math.floor(s / 60);
    const remainder = s - m * 60;
    return `${pad2(m)}:${remainder.toFixed(1).padStart(4, "0")}`;
}

/** 格式化模型名称：去除渠道或配置标识前缀（如 qiCBKIt9WescQN6oItB2I::minimax_h3_lightx2v_v5 -> minimax_h3_lightx2v_v5）。 */
function formatModelName(model?: string): string {
    if (!model) return "";
    const trimmed = String(model).trim();
    if (trimmed.includes("::")) {
        const parts = trimmed.split("::");
        return parts.slice(1).join("::").trim();
    }
    return trimmed;
}

/** 从媒体任务输入快照或生成结果中解析出真实的视频时长（秒）。 */
function getMediaDuration(media?: ComicDramaMediaResult): number | undefined {
    if (!media) return undefined;
    const input = (media.inputSnapshot as Record<string, unknown>) || {};
    const settings = (input.settings as Record<string, unknown>) || {};
    const result = (media.resultData as Record<string, unknown>) || {};
    const item = (result.item as Record<string, unknown>) || {};

    const candidates = [
        result.duration,
        result.videoSeconds,
        result.seconds,
        item.duration,
        item.videoSeconds,
        item.seconds,
        settings.videoSeconds,
        settings.seconds,
        settings.duration,
        input.videoSeconds,
        input.seconds,
        input.duration,
    ];

    for (const val of candidates) {
        if (typeof val === "number" && Number.isFinite(val) && val > 0) {
            return val;
        }
        if (typeof val === "string") {
            const parsed = parseFloat(val);
            if (Number.isFinite(parsed) && parsed > 0) {
                return parsed;
            }
        }
    }
    return undefined;
}

/** 判断媒体是否为视频格式。 */
function isVideoMedia(media?: ComicDramaMediaResult, url?: string): boolean {
    if (media?.mediaType === "video") return true;
    if (media?.mediaType === "image") return false;
    if (!url) return false;
    const cleanUrl = url.toLowerCase().split("?")[0].split("#")[0];
    if (cleanUrl.endsWith(".mp4") || cleanUrl.endsWith(".webm") || cleanUrl.endsWith(".mov") || cleanUrl.endsWith(".m4v")) {
        return true;
    }
    if (
        cleanUrl.endsWith(".png") ||
        cleanUrl.endsWith(".jpg") ||
        cleanUrl.endsWith(".jpeg") ||
        cleanUrl.endsWith(".webp") ||
        cleanUrl.endsWith(".gif") ||
        cleanUrl.endsWith(".svg")
    ) {
        return false;
    }
    return true;
}

/** 尝试从任务结果数据中读取封面图/缩略图地址。 */
function readComicDramaThumbnailUrl(resultData?: Record<string, unknown>): string {
    if (!resultData) return "";
    const item = resultData.item && typeof resultData.item === "object" ? (resultData.item as Record<string, unknown>) : undefined;
    const items = Array.isArray(resultData.items) ? (resultData.items as Record<string, unknown>[]) : [];
    const firstItem = items[0];
    const candidate =
        resultData.coverUrl ||
        resultData.thumbnailUrl ||
        resultData.posterUrl ||
        resultData.firstFrameUrl ||
        item?.coverUrl ||
        item?.thumbnailUrl ||
        item?.posterUrl ||
        item?.firstFrameUrl ||
        firstItem?.coverUrl ||
        firstItem?.thumbnailUrl;
    return typeof candidate === "string" ? candidate : "";
}

/** 分镜时间轴片段缩略预览：视频解码并显示首帧预览，未生成视频直接显示默认视频图标（无色纯净灰黑底）。 */
function TimelineClipThumbnail({
    url,
    hasVideo,
    posterUrl,
    alt,
}: {
    url: string;
    hasVideo: boolean;
    posterUrl?: string;
    alt: string;
}) {
    const [loadError, setLoadError] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);

    // 未生成视频或视频加载失败：直接显示默认视频图标，不带有色背景
    if (!hasVideo || !url || loadError) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-[var(--studio-surface-raised)] text-[var(--studio-muted)]">
                <Video className="size-5 text-[var(--studio-muted)]" />
            </div>
        );
    }

    const videoSrc = url.includes("#") ? url : `${url}#t=0.001`;

    return (
        <div className="relative h-full w-full overflow-hidden bg-black">
            <video
                ref={videoRef}
                src={videoSrc}
                poster={posterUrl || undefined}
                preload="metadata"
                muted
                playsInline
                onError={() => setLoadError(true)}
                onLoadedMetadata={(e) => {
                    try {
                        if (e.currentTarget.currentTime === 0) {
                            e.currentTarget.currentTime = 0.001;
                        }
                    } catch {}
                }}
                className="h-full w-full object-cover pointer-events-none opacity-85 group-hover:opacity-100 transition-opacity"
            />
        </div>
    );
}

/**
 * 激活/选中态：与左侧主导航（globals.css 的 .sidebar-rail-item-active）用同一组变量。
 * 走内联样式而不是 `bg-[var(--studio-primary)]` 这类任意值工具类 —— 任意值工具类依赖样式表下发，
 * 浏览器持有旧样式表（HMR 只热更 JS 不重取 CSS）时会静默失效，只剩继承来的白字。
 */
const ACTIVE_STYLE = { background: "var(--studio-action)", color: "var(--studio-action-foreground)" };

/** 分镜板组件：支持 3D 翻转卡片工作台与可左右交互擦洗的时间轴轨道。 */
export function StageStoryboard({ pauseAutoSave = false }: { pauseAutoSave?: boolean }) {
    const { message, modal } = App.useApp();
    const pendingImpactTargets = usePendingImpactTargets();
    const workspace = useComicDramaStore((state) => state.workspace);
    const setActiveStage = useComicDramaStore((state) => state.setActiveStage);
    const saveShot = useComicDramaStore((state) => state.saveShot);
    const saveTimelineText = useComicDramaStore((state) => state.saveTimelineText);
    const deleteTimelineText = useComicDramaStore((state) => state.deleteTimelineText);
    const deleteTextTrack = useComicDramaStore((state) => state.deleteTextTrack);
    const saveVoiceTrack = useComicDramaStore((state) => state.saveVoiceTrack);
    const pendingTimelineTexts = useComicDramaStore((state) => state.pendingTimelineTexts);
    const pendingTimelineVoices = useComicDramaStore((state) => state.pendingTimelineVoices);
    const queueTimelineText = useComicDramaStore((state) => state.queueTimelineText);
    const queueTimelineTextReorder = useComicDramaStore((state) => state.queueTimelineTextReorder);
    const queueTimelineVoice = useComicDramaStore((state) => state.queueTimelineVoice);
    const clearPendingTimelineText = useComicDramaStore((state) => state.clearPendingTimelineText);
    const clearPendingTimelineVoice = useComicDramaStore((state) => state.clearPendingTimelineVoice);
    const savePendingTimelineChanges = useComicDramaStore((state) => state.savePendingTimelineChanges);
    const timelineSaving = useComicDramaStore((state) => state.timelineSaving);
    const timelineSaveError = useComicDramaStore((state) => state.timelineSaveError);
    const pendingStage = useComicDramaStore((state) => state.pendingStage);

    // Filters & View Mode
    const [selectedEpisodeId, setSelectedEpisodeId] = useState<string>("all");
    const [viewMode, setViewMode] = useState<"timeline" | "grid">("timeline");
    const [flipSide, setFlipSide] = useState<"preview" | "config">("preview");

    // Timeline state
    const [pps, setPps] = useState<number>(46);
    const [currentTime, setCurrentTime] = useState<number>(0);
    const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
    const [selectedPreviewTimeMs, setSelectedPreviewTimeMs] = useState<number | null>(null);
    const [isPlaying, setIsPlaying] = useState<boolean>(false);
    const [isMuted, setIsMuted] = useState<boolean>(false);
    const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
    const [previewVideoProgress, setPreviewVideoProgress] = useState({ sourceKey: "", currentTime: 0, duration: 0 });
    const [textDraft, setTextDraft] = useState<ComicDramaTimelineTextInput | null>(null);
    const [audioDraft, setAudioDraft] = useState<ComicDramaVoiceTrackInput | null>(null);
    const [audioFile, setAudioFile] = useState<File | null>(null);
    const [savingTrack, setSavingTrack] = useState(false);
    const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
    const [audioErrors, setAudioErrors] = useState<Record<string, string>>({});
    const [previewRatio, setPreviewRatio] = useState(0);
    const [previewBounds, setPreviewBounds] = useState({ width: 0, height: 0 });
    const [textPositions, setTextPositions] = useState<Record<string, { x: number; y: number }>>({});
    const [selectedPreviewTextId, setSelectedPreviewTextId] = useState<string | null>(null);
    const [selectedTimelineNode, setSelectedTimelineNode] = useState<{ kind: "video" | "text" | "audio"; id: string } | null>(null);
    const [draggingPreviewTextId, setDraggingPreviewTextId] = useState<string | null>(null);
    const [clipDraft, setClipDraft] = useState<TimelineClipDraft | null>(null);
    const [textReorderDraft, setTextReorderDraft] = useState<ComicDramaTimelineText[]>([]);
    const clipDragRef = useRef<TimelineClipDrag | null>(null);
    const clearClipDragListenersRef = useRef<(() => void) | null>(null);
    const clipWasDraggedRef = useRef(false);

    useEffect(() => () => clearClipDragListenersRef.current?.(), []);

    // Project and assets
    const projectId = workspace?.projectId;
    const episodes = workspace?.scriptProject.episodes || [];
    const shots = workspace?.shots || [];
    const mediaList = workspace?.media || [];
    const savedTimelineTexts = workspace?.timelineTexts || EMPTY_TIMELINE_TEXTS;
    const savedVoiceTracks = workspace?.voiceTracks || EMPTY_VOICE_TRACKS;
    const timelineTexts = useMemo(() => {
        // V36 将原有片段归入默认轨道；旧工作区响应尚未返回轨道编号时保持相同语义。
        const trackNumberOf = (item: ComicDramaTimelineText) => Number.isInteger(item.trackNumber) && item.trackNumber >= 0 && item.trackNumber <= 2 ? item.trackNumber : 0;
        const items = new Map<string, ComicDramaTimelineText>(savedTimelineTexts.map((item) => [
            item.id,
            { ...item, trackNumber: trackNumberOf(item) },
        ]));
        Object.values(pendingTimelineTexts).forEach((item) => items.set(item.id, { ...item, trackNumber: trackNumberOf(item) }));
        return [...items.values()];
    }, [savedTimelineTexts, pendingTimelineTexts]);
    const savedTextTrackCount = workspace?.textTrackCount;
    const textTrackCount = Math.min(3, Math.max(1,
        typeof savedTextTrackCount === "number" && Number.isInteger(savedTextTrackCount) ? savedTextTrackCount : 1,
        ...timelineTexts.map((item) => item.trackNumber + 1),
    ));
    const voiceTracks = useMemo(() => savedVoiceTracks.map((item) => pendingTimelineVoices[item.id] || item), [savedVoiceTracks, pendingTimelineVoices]);
    const pendingTimelineCount = Object.keys(pendingTimelineTexts).length + Object.keys(pendingTimelineVoices).length;

    useEffect(() => {
        if (!pendingTimelineCount || pauseAutoSave || pendingStage || textDraft || audioDraft || savingTrack || timelineSaveError) return;
        const interval = window.setInterval(() => {
            if (!clipDragRef.current && !textDragRef.current) void savePendingTimelineChanges();
        }, 15000);
        return () => window.clearInterval(interval);
    }, [pendingTimelineCount, pauseAutoSave, pendingStage, textDraft, audioDraft, savingTrack, timelineSaveError, savePendingTimelineChanges]);
    const assets = workspace?.assets || [];
    const promptVersions = workspace?.promptVersions || [];

    // 就地创建视频任务后，分镜板需自行同步媒体状态，避免只能到媒体生成中心查看完成结果。
    useMediaAutoRefresh(mediaList);

    // Asset versions lookup (assetId -> ComicDramaAssetVersion[])
    const [versionsByAsset, setVersionsByAsset] = useState<Record<string, ComicDramaAssetVersion[]>>({});

    useEffect(() => {
        if (!projectId || assets.length === 0) return;
        let cancelled = false;
        Promise.all(assets.map(async (asset) => [asset.id, await listComicDramaAssetVersions(projectId, asset.id)] as const))
            .then((entries) => {
                if (!cancelled) setVersionsByAsset(Object.fromEntries(entries));
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [projectId, assets]);

    // Active Shot Quick Edit Form State
    const [editModalOpen, setEditModalOpen] = useState<boolean>(false);
    const [editForm] = Form.useForm<ComicDramaShotInput>();
    const [savingShot, setSavingShot] = useState<boolean>(false);
    const [copiedPromptType, setCopiedPromptType] = useState<"final" | "snapshot" | null>(null);
    // 就地生成镜头视频的目标镜头；非空即表示生成弹窗打开（多于一个即批量生成当前分集镜头）
    const [generationShotIds, setGenerationShotIds] = useState<string[]>([]);

    // Refs
    const stageRef = useRef<HTMLDivElement>(null);
    const previewSurfaceRef = useRef<HTMLDivElement>(null);
    const previewFrameRef = useRef<HTMLDivElement>(null);
    const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
    const textDragRef = useRef<{ id: string; x: number; y: number } | null>(null);
    const textWasDraggedRef = useRef(false);
    const tlBodyRef = useRef<HTMLDivElement>(null);
    const tlContentRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const isScrubbingRef = useRef<boolean>(false);
    const scrubStartRef = useRef({ clientX: 0, time: 0 });

    const filteredShots = useMemo(() => {
        return shots
            .filter((shot) => {
                if (selectedEpisodeId !== "all" && shot.sourceEpisodeId !== selectedEpisodeId) return false;
                return true;
            })
            .sort((a, b) => a.sortOrder - b.sortOrder);
    }, [shots, selectedEpisodeId]);
    const timelineShots = useMemo(() => [...shots].sort((first, second) => first.sortOrder - second.sortOrder), [shots]);

    // Real probed video durations (cached by shotId)
    const [realVideoDurations, setRealVideoDurations] = useState<Record<string, number>>({});

    // 查找镜头当前媒体：媒体列表按创建时间倒序，视频始终取最新任务，确保重新生成完成后能立即替换预览。
    const getShotMedia = useCallback((shotId: string): ComicDramaMediaResult | undefined => {
        return (
            mediaList.find((m) => m.targetType === "shot" && m.targetId === shotId && m.mediaType === "video") ||
            mediaList.find((m) => m.targetType === "shot" && m.targetId === shotId && m.adopted) ||
            mediaList.find((m) => m.targetType === "shot" && m.targetId === shotId && m.status === "completed") ||
            mediaList.find((m) => m.targetType === "shot" && m.targetId === shotId)
        );
    }, [mediaList]);

    // Find keyframe/image media for a given shot to serve as poster
    const getShotImagePoster = useCallback((shotId: string): string => {
        // needsUpdate 只代表上游有变更，历史结果仍要展示给用户。
        const imageMedia = mediaList.find(
            (m) => m.targetType === "shot" && m.targetId === shotId && m.mediaType === "image" && (m.adopted || m.status === "completed" || m.status === "needsUpdate")
        );
        if (imageMedia) {
            return readComicDramaMediaUrl(imageMedia.resultData);
        }
        return "";
    }, [mediaList]);

    // Calculate effective duration: Prioritize probed real video duration, then media settings duration, then shot planned duration
    const getShotDuration = useCallback(
        (shot: ComicDramaShot): number => {
            if (realVideoDurations[shot.id] && realVideoDurations[shot.id] > 0) {
                return realVideoDurations[shot.id];
            }
            const media = getShotMedia(shot.id);
            const mediaDur = getMediaDuration(media);
            if (mediaDur && mediaDur > 0) {
                return mediaDur;
            }
            return shot.durationSeconds || 3;
        },
        [realVideoDurations, getShotMedia]
    );

    // Proactively probe real video metadata for all shots with video
    useEffect(() => {
        timelineShots.forEach((shot) => {
            const media = getShotMedia(shot.id);
            const url = media ? readComicDramaMediaUrl(media.resultData) : "";
            const isVid = isVideoMedia(media, url);
            if (url && isVid && !realVideoDurations[shot.id]) {
                const v = document.createElement("video");
                v.preload = "metadata";
                v.src = url;
                v.onloadedmetadata = () => {
                    if (v.duration && Number.isFinite(v.duration) && v.duration > 0) {
                        const preciseDur = Math.round(v.duration * 10) / 10;
                        setRealVideoDurations((prev) => {
                            if (prev[shot.id] === preciseDur) return prev;
                            return { ...prev, [shot.id]: preciseDur };
                        });
                    }
                };
            }
        });
    }, [timelineShots, getShotMedia, realVideoDurations]);

    const totalDuration = useMemo(() => {
        return timelineShots.reduce((acc, shot) => acc + getShotDuration(shot), 0);
    }, [timelineShots, getShotDuration]);
    const shotIntervals = useMemo(() => buildShotIntervals(timelineShots, getShotDuration), [timelineShots, getShotDuration]);

    // Locate active shot and local offset at time t
    const locate = useCallback(
        (t: number) => {
            if (timelineShots.length === 0) return { index: 0, local: 0, shot: null };
            let acc = 0;
            for (let i = 0; i < timelineShots.length; i++) {
                const s = timelineShots[i];
                const dur = getShotDuration(s);
                if (t < acc + dur || i === timelineShots.length - 1) {
                    return {
                        index: i,
                        local: Math.min(Math.max(t - acc, 0), dur),
                        shot: s,
                    };
                }
                acc += dur;
            }
            const last = timelineShots[timelineShots.length - 1];
            return {
                index: timelineShots.length - 1,
                local: last ? getShotDuration(last) : 0,
                shot: last,
            };
        },
        [timelineShots, getShotDuration]
    );

    const { index: playheadIndex, local: playheadLocalTime } = useMemo(
        () => locate(currentTime),
        [locate, currentTime]
    );
    const selectedIndex = selectedShotId === null ? -1 : timelineShots.findIndex((shot) => shot.id === selectedShotId);
    const activeIndex = selectedIndex >= 0 ? selectedIndex : playheadIndex;
    const activeShot = timelineShots[activeIndex] || null;
    const previewTimeMs = selectedIndex >= 0 ? selectedPreviewTimeMs ?? shotIntervals[selectedIndex].startMs : Math.round(currentTime * 1000);
    const localTime = selectedIndex >= 0 ? Math.max(0, (previewTimeMs - shotIntervals[selectedIndex].startMs) / 1000) : playheadLocalTime;

    useEffect(() => {
        if (isPlaying) {
            setSelectedShotId(null);
            setSelectedTimelineNode(null);
        }
    }, [isPlaying]);
    const projectDurationMs = Math.round(totalDuration * 1000);
    const activeTexts = useMemo(() => visibleTimelineTexts(timelineTexts, previewTimeMs), [timelineTexts, previewTimeMs]);
    const scheduledVoices = useMemo(() => voiceTracks.filter((track) => track.audioStorageKey && voiceTrackEndMs(track) !== null), [voiceTracks]);

    // 媒体 URL 由后端存储标识解析，不把可能过期的下载地址写入项目数据。
    useEffect(() => {
        const keys = [...new Set(voiceTracks.map((track) => track.audioStorageKey).filter((key): key is string => Boolean(key)))];
        let cancelled = false;
        Promise.all(keys.map(async (key) => {
            try {
                const media = await getServerMediaInfo(key);
                if (!media.url) throw new Error("音频地址不可用");
                return { key, url: media.url, error: "" };
            } catch (error) {
                return { key, url: "", error: error instanceof Error ? error.message : "音频加载失败" };
            }
        })).then((items) => {
            if (cancelled) return;
            setAudioUrls(Object.fromEntries(items.filter((item) => item.url).map((item) => [item.key, item.url])));
            setAudioErrors(Object.fromEntries(items.filter((item) => item.error).map((item) => [item.key, item.error])));
        });
        return () => { cancelled = true; };
    }, [voiceTracks]);

    useEffect(() => {
        const surface = previewSurfaceRef.current;
        if (!surface) return;
        const update = () => setPreviewBounds({ width: surface.clientWidth, height: surface.clientHeight });
        update();
        const observer = new ResizeObserver(update);
        observer.observe(surface);
        return () => observer.disconnect();
    }, [viewMode, flipSide, workspace?.projectId]);

    useEffect(() => {
        const [width, height] = (workspace?.settings.aspectRatio || "").split(":").map(Number);
        setPreviewRatio(width > 0 && height > 0 ? width / height : 0);
    }, [workspace?.settings.aspectRatio, activeShot?.id]);

    useEffect(() => {
        const projectTimeMs = Math.round(currentTime * 1000);
        scheduledVoices.forEach((track) => {
            const audio = audioRefs.current[track.id];
            if (!audio) return;
            const sourceTimeMs = voiceTrackSourceTimeMs(track, projectTimeMs);
            audio.muted = isMuted;
            if (sourceTimeMs === null || !isPlaying) {
                audio.pause();
                if (sourceTimeMs !== null && Math.abs(audio.currentTime * 1000 - sourceTimeMs) > 50) audio.currentTime = sourceTimeMs / 1000;
                return;
            }
            if (Math.abs(audio.currentTime * 1000 - sourceTimeMs) > 250) audio.currentTime = sourceTimeMs / 1000;
            if (audio.paused && !audioErrors[track.audioStorageKey!]) audio.play().catch(() => setAudioErrors((current) => current[track.audioStorageKey!] ? current : { ...current, [track.audioStorageKey!]: "浏览器未能播放音频，请检查文件或手动开始播放" }));
        });
    }, [currentTime, isPlaying, isMuted, scheduledVoices, audioUrls, audioErrors]);

    const openNewText = () => {
        const startMs = Math.round(currentTime * 1000);
        if (projectDurationMs - startMs < 100) { message.warning("播放头距离项目末尾不足 0.1 秒，无法添加文字"); return; }
        const placement = availableTextTrackPlacement(timelineTexts, startMs, projectDurationMs);
        if (!placement) { message.warning("三条文字轨道在当前时间均已有片段"); return; }
        setIsPlaying(false);
        setFlipSide("preview");
        const item = { id: nanoid(), content: "文字", startMs, endMs: placement.endMs, trackNumber: placement.trackNumber, positionX: 0.5, positionY: 0.82 - placement.trackNumber * 0.14, fontSize: 36, color: "#ffffff", alignment: "center" as const, backgroundColor: null, revision: 0 };
        queueTimelineText(item);
        setSelectedPreviewTextId(item.id);
        setSelectedTimelineNode({ kind: "text", id: item.id });
    };

    const saveText = async (value: ComicDramaTimelineTextInput) => {
        const current = useComicDramaStore.getState().workspace?.timelineTexts.find((item) => item.id === value.id);
        if (!value.content.trim() || (!current && (value.startMs < 0 || value.endMs <= value.startMs || value.endMs > projectDurationMs
            || value.trackNumber < 0 || value.trackNumber >= textTrackCount
            || timelineTexts.some((item) => item.id !== value.id && item.trackNumber === value.trackNumber && timelineTextOverlaps(item, value))))) {
            message.error("请填写文字内容，且同一文字轨道的片段时间不能重叠");
            return false;
        }
        setSavingTrack(true);
        try {
            const editedFields = { content: value.content.trim(), fontSize: value.fontSize, color: value.color,
                alignment: value.alignment, backgroundColor: value.backgroundColor };
            const saved = await saveTimelineText({ ...(current || value), ...editedFields });
            const pending = useComicDramaStore.getState().pendingTimelineTexts[value.id];
            if (current && pending) queueTimelineText({ ...pending, ...editedFields, revision: saved.revision });
            else clearPendingTimelineText(value.id);
            message.success("文字片段已保存");
            return true;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "文字片段保存失败");
            return false;
        } finally {
            setSavingTrack(false);
        }
    };

    const openNewAudio = () => {
        setIsPlaying(false);
        setAudioFile(null);
        setAudioDraft({ id: `voice_${nanoid()}`, trackType: "music", content: "", voiceModel: "", speechRate: 1, tone: "", emotion: "", status: "ready", revision: 0, audioStorageKey: null, audioDurationMs: null, timelineStartMs: Math.round(currentTime * 1000), trimStartMs: 0, trimEndMs: null });
    };

    const saveAudio = async (draft: ComicDramaVoiceTrackInput) => {
        if (!draft.content.trim()) { message.error("请填写声音条目内容"); return false; }
        setSavingTrack(true);
        try {
            let value = draft;
            if (audioFile) {
                const uploaded = await uploadAudioFile(audioFile);
                value = { ...value, audioStorageKey: uploaded.storageKey, audioDurationMs: uploaded.durationMs, trimStartMs: value.trimStartMs ?? 0, trimEndMs: value.trimEndMs ?? uploaded.durationMs, timelineStartMs: value.timelineStartMs ?? Math.round(currentTime * 1000) };
                setAudioDraft(value);
                setAudioFile(null);
            }
            if (!value.audioStorageKey || !value.audioDurationMs) throw new Error("请上传音频文件");
            if (value.timelineStartMs == null || value.trimStartMs == null || value.trimEndMs == null) throw new Error("请设置音频排期和裁剪范围");
            if (value.trimEndMs <= value.trimStartMs || value.trimEndMs > value.audioDurationMs || value.timelineStartMs + value.trimEndMs - value.trimStartMs > projectDurationMs) throw new Error("音频裁剪范围超出文件或项目时长");
            if (Object.keys(useComicDramaStore.getState().pendingTimelineTexts).length + Object.keys(useComicDramaStore.getState().pendingTimelineVoices).length > 0 && !await savePendingTimelineChanges()) throw new Error("请先解决待保存的时间轴修改");
            const current = useComicDramaStore.getState().workspace?.voiceTracks.find((item) => item.id === value.id);
            await saveVoiceTrack({ ...value, revision: current?.revision ?? value.revision, content: value.content.trim() });
            clearPendingTimelineVoice(value.id);
            setAudioDraft(null);
            message.success("音频片段已保存");
            return true;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "音频片段保存失败");
            return false;
        } finally {
            setSavingTrack(false);
        }
    };

    const movePreviewText = (event: React.PointerEvent<HTMLButtonElement>) => {
        const dragging = textDragRef.current;
        const frame = previewFrameRef.current;
        if (!dragging || !frame) return;
        const bounds = frame.getBoundingClientRect();
        const x = clampPreviewPosition((event.clientX - bounds.left) / bounds.width, event.currentTarget.offsetWidth, bounds.width);
        const y = clampPreviewPosition((event.clientY - bounds.top) / bounds.height, event.currentTarget.offsetHeight, bounds.height);
        if (Math.abs(x - dragging.x) + Math.abs(y - dragging.y) > 0.002) {
            textWasDraggedRef.current = true;
            setDraggingPreviewTextId(dragging.id);
        }
        textDragRef.current = { ...dragging, x, y };
        setTextPositions((current) => ({ ...current, [dragging.id]: { x, y } }));
    };

    const finishPreviewTextDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
        const dragging = textDragRef.current;
        textDragRef.current = null;
        setDraggingPreviewTextId(null);
        if (!dragging) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        const text = timelineTexts.find((item) => item.id === dragging.id);
        if (text && (text.positionX !== dragging.x || text.positionY !== dragging.y)) {
            const updated = { ...text, positionX: dragging.x, positionY: dragging.y };
            queueTimelineText(updated);
            setTextPositions((current) => { const next = { ...current }; delete next[updated.id]; return next; });
        }
    };

    const startClipDrag = (event: React.PointerEvent<HTMLButtonElement>, original: TimelineClipDraft) => {
        event.stopPropagation();
        if (event.button !== 0) return;
        if (event.pointerType !== "mouse") event.preventDefault();
        setIsPlaying(false);
        const mode = (event.target as HTMLElement).dataset.edge as TimelineClipDrag["mode"] | undefined;
        clipDragRef.current = { id: original.item.id, kind: original.kind, mode: mode || "move", pointerX: event.clientX, original, latest: original };
        clipWasDraggedRef.current = false;
        const pointerId = event.pointerId;
        const onMove = (pointerEvent: PointerEvent) => {
            if (pointerEvent.pointerId === pointerId) moveClip(pointerEvent.clientX);
        };
        const onUp = (pointerEvent: PointerEvent) => {
            if (pointerEvent.pointerId !== pointerId) return;
            clearClipDragListenersRef.current?.();
            finishClipDrag();
        };
        const onCancel = (pointerEvent: PointerEvent) => {
            if (pointerEvent.pointerId !== pointerId) return;
            clearClipDragListenersRef.current?.();
            clipDragRef.current = null;
            clipWasDraggedRef.current = false;
            setClipDraft(null);
            setTextReorderDraft([]);
        };
        clearClipDragListenersRef.current?.();
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onCancel);
        clearClipDragListenersRef.current = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onCancel);
            clearClipDragListenersRef.current = null;
        };
    };

    const moveClip = (clientX: number) => {
        const drag = clipDragRef.current;
        if (!drag) return;
        const deltaMs = Math.round((clientX - drag.pointerX) * 1000 / pps);
        if (Math.abs(deltaMs) < 20) return;
        clipWasDraggedRef.current = true;
        let latest: TimelineClipDraft;
        if (drag.original.kind === "text") {
            const item = drag.original.item;
            const durationMs = item.endMs - item.startMs;
            const startMs = drag.mode === "move" ? clampTimelineStart(item.startMs + deltaMs, durationMs, projectDurationMs)
                : drag.mode === "left" ? Math.max(0, Math.min(item.endMs - 100, item.startMs + deltaMs)) : item.startMs;
            const endMs = drag.mode === "right" ? Math.max(item.startMs + 100, Math.min(projectDurationMs, item.endMs + deltaMs))
                : drag.mode === "move" ? startMs + durationMs : item.endMs;
            latest = { kind: "text", item: { ...item, startMs, endMs } };
            if (drag.mode === "move") {
                const reordered = reorderTimelineTexts(timelineTexts, item.id, startMs);
                drag.reorder = reordered.length ? reordered : undefined;
                setTextReorderDraft(reordered);
            }
        } else {
            const item = drag.original.item;
            const start = item.timelineStartMs || 0;
            const trimStart = item.trimStartMs || 0;
            const trimEnd = item.trimEndMs || 0;
            const durationMs = trimEnd - trimStart;
            if (drag.mode === "move") latest = { kind: "audio", item: { ...item, timelineStartMs: clampTimelineStart(start + deltaMs, durationMs, projectDurationMs) } };
            else if (drag.mode === "left") {
                const nextTrimStart = Math.max(0, Math.min(trimEnd - 100, trimStart + deltaMs));
                const nextStart = Math.max(0, Math.min(projectDurationMs - (trimEnd - nextTrimStart), start + nextTrimStart - trimStart));
                latest = { kind: "audio", item: { ...item, timelineStartMs: nextStart, trimStartMs: nextTrimStart } };
            } else {
                const nextTrimEnd = Math.max(trimStart + 100, Math.min(item.audioDurationMs || trimEnd, projectDurationMs - start + trimStart, trimEnd + deltaMs));
                latest = { kind: "audio", item: { ...item, trimEndMs: nextTrimEnd } };
            }
        }
        drag.latest = latest;
        setClipDraft(latest);
    };

    const finishClipDrag = () => {
        const drag = clipDragRef.current;
        clipDragRef.current = null;
        if (!drag) return;
        if (!clipWasDraggedRef.current) { setClipDraft(null); setTextReorderDraft([]); return; }
        if (drag.latest.kind === "text") {
            if (drag.reorder?.length) {
                queueTimelineTextReorder(drag.reorder);
                setClipDraft(null);
                setTextReorderDraft([]);
                return;
            }
            if (timelineTexts.some((item) => item.id !== drag.latest.item.id && item.trackNumber === drag.latest.item.trackNumber && timelineTextOverlaps(item, drag.latest.item))) {
                message.warning("同一文字轨道的片段不能重叠");
                setClipDraft(null);
                setTextReorderDraft([]);
                return;
            }
            queueTimelineText(drag.latest.item);
        }
        else queueTimelineVoice(drag.latest.item);
        setClipDraft(null);
        setTextReorderDraft([]);
    };

    const confirmDeleteText = (item: ComicDramaTimelineTextInput) => {
        modal.confirm({
            title: "删除文字片段",
            content: `确定删除“${item.content}”吗？`,
            okText: "删除", cancelText: "取消", okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    if (Object.keys(useComicDramaStore.getState().pendingTimelineTexts).length + Object.keys(useComicDramaStore.getState().pendingTimelineVoices).length > 0 && !await savePendingTimelineChanges()) throw new Error("请先解决待保存的时间轴修改");
                    await deleteTimelineText(item.id);
                    clearPendingTimelineText(item.id);
                    if (selectedPreviewTextId === item.id) setSelectedPreviewTextId(null);
                    if (selectedTimelineNode?.kind === "text" && selectedTimelineNode.id === item.id) setSelectedTimelineNode(null);
                    setTextDraft(null);
                    message.success("文字片段已删除");
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "文字片段删除失败");
                    throw error;
                }
            },
        });
    };

    const confirmDeleteTextTrack = (trackNumber: number) => {
        const clipCount = timelineTexts.filter((item) => item.trackNumber === trackNumber).length;
        modal.confirm({
            title: `删除文字轨道${trackNumber}`,
            content: clipCount ? `该轨道中的 ${clipCount} 个文字片段将一同删除，确定继续吗？` : "确定删除该文字轨道吗？",
            okText: "删除轨道", cancelText: "取消", okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    if (pendingTimelineCount && !await savePendingTimelineChanges()) throw new Error("请先解决待保存的时间轴修改");
                    await deleteTextTrack(trackNumber);
                    setSelectedPreviewTextId(null);
                    setSelectedTimelineNode(null);
                    message.success("文字轨道已删除");
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "删除文字轨道失败");
                    throw error;
                }
            },
        });
    };

    const selectAudioFile = async (file: File | null) => {
        setAudioFile(file);
        if (!file) return;
        try {
            const metadata = await readAudioMetadata(file);
            setAudioDraft((current) => current ? { ...current, audioDurationMs: metadata.durationMs, trimStartMs: 0, trimEndMs: Math.min(metadata.durationMs, Math.max(100, projectDurationMs - (current.timelineStartMs || 0))) } : current);
        } catch (error) {
            setAudioFile(null);
            message.error(error instanceof Error ? error.message : "音频解析失败");
        }
    };

    const removeAudioFromTimeline = async (item: ComicDramaVoiceTrackInput) => {
        setSavingTrack(true);
        try {
            if (Object.keys(useComicDramaStore.getState().pendingTimelineTexts).length + Object.keys(useComicDramaStore.getState().pendingTimelineVoices).length > 0 && !await savePendingTimelineChanges()) throw new Error("请先解决待保存的时间轴修改");
            const current = useComicDramaStore.getState().workspace?.voiceTracks.find((track) => track.id === item.id);
            await saveVoiceTrack({ ...item, revision: current?.revision ?? item.revision, timelineStartMs: null, trimStartMs: null, trimEndMs: null });
            clearPendingTimelineVoice(item.id);
            setAudioDraft(null);
            message.success("音频已移出轨道，声音条目和文件已保留");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "移出音频轨道失败");
        } finally {
            setSavingTrack(false);
        }
    };

    // 鼠标悬停位置仅用于显示时间辅助线，不参与播放位置计算。
    const [hoverTime, setHoverTime] = useState<number | null>(null);

    // 空格键仅切换播放状态，始终从当前进度线位置继续播放。
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (textDraft || audioDraft || editModalOpen) return;
            if (e.code === "Space" || e.key === " ") {
                const target = e.target as HTMLElement | null;
                if (
                    target &&
                    (target.tagName === "INPUT" ||
                        target.tagName === "TEXTAREA" ||
                        target.isContentEditable ||
                        target.closest("input, textarea, [contenteditable='true']"))
                ) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();

                setIsPlaying((prevPlaying) => !prevPlaying);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [textDraft, audioDraft, editModalOpen]);

    // Sync video play/pause and sound with isPlaying
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        video.muted = isMuted;
        if (isPlaying) {
            video.play().catch(() => {
                // If browser autoplay policy blocks unmuted audio on start, try muted
                if (!video.muted) {
                    video.muted = true;
                    video.play().catch(() => {});
                }
            });
        } else {
            video.pause();
        }
    }, [isPlaying, activeIndex, isMuted]);

    // Sync video playback currentTime with localTime when video is rendered
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !isFinite(localTime)) return;
        const targetTime = Math.max(localTime, 0.001);
        if (!isPlaying) {
            if (Math.abs(video.currentTime - targetTime) > 0.05) {
                video.currentTime = targetTime;
            }
        } else {
            if (Math.abs(video.currentTime - targetTime) > 0.35) {
                video.currentTime = targetTime;
            }
        }
    }, [localTime, isPlaying]);

    // Playback loop when isPlaying
    useEffect(() => {
        if (!isPlaying || totalDuration <= 0) return;
        let animId: number;
        let lastTimestamp = performance.now();

        const step = (now: number) => {
            const delta = (now - lastTimestamp) / 1000;
            lastTimestamp = now;
            setCurrentTime((prev) => {
                const next = prev + delta;
                if (next >= totalDuration) {
                    setIsPlaying(false);
                    return 0;
                }
                return next;
            });
            animId = requestAnimationFrame(step);
        };

        animId = requestAnimationFrame(step);

        return () => {
            if (animId) {
                cancelAnimationFrame(animId);
            }
        };
    }, [isPlaying, totalDuration]);

    // Timeline navigation helpers
    const seekToShotStart = (index: number) => {
        setSelectedShotId(null);
        setSelectedTimelineNode(null);
        setCurrentTime((shotIntervals[index]?.startMs || 0) / 1000 + 0.05);
    };

    const handlePrevShot = () => {
        if (activeIndex > 0) seekToShotStart(activeIndex - 1);
        else { setSelectedShotId(null); setSelectedTimelineNode(null); setCurrentTime(0); }
    };

    const handleNextShot = () => {
        if (activeIndex < timelineShots.length - 1) seekToShotStart(activeIndex + 1);
    };

    // Calculate time from clientX coordinate in timeline track
    const timeFromClientX = useCallback(
        (clientX: number) => {
            if (!tlContentRef.current) return 0;
            const rect = tlContentRef.current.getBoundingClientRect();
            const x = clientX - rect.left;
            return Math.min(Math.max(x / pps, 0), totalDuration);
        },
        [pps, totalDuration]
    );

    // 仅从播放头开始拖动，按下时保留原时间，避免命中区边缘造成跳动。
    const handlePointerDown = (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        setIsPlaying(false);
        setSelectedShotId(null);
        setSelectedTimelineNode(null);
        isScrubbingRef.current = true;
        scrubStartRef.current = { clientX: e.clientX, time: currentTime };
        if (tlBodyRef.current) {
            try {
                tlBodyRef.current.setPointerCapture(e.pointerId);
            } catch {}
        }
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        const t = timeFromClientX(e.clientX);
        setHoverTime(t);
        if (isScrubbingRef.current) {
            const { clientX, time } = scrubStartRef.current;
            setCurrentTime(Math.min(Math.max(time + (e.clientX - clientX) / pps, 0), totalDuration));
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        isScrubbingRef.current = false;
        if (tlBodyRef.current) {
            try {
                tlBodyRef.current.releasePointerCapture(e.pointerId);
            } catch {}
        }
    };

    const handlePointerLeave = () => {
        setHoverTime(null);
    };

    // Zoom handlers
    const zoomIn = () => setPps((prev) => Math.min(Math.round(prev * 1.25), PPS_MAX));
    const zoomOut = () => setPps((prev) => Math.max(Math.round(prev / 1.25), PPS_MIN));

    // Handle Wheel on timeline: Ctrl+wheel zooms, regular wheel scrolls
    const handleTimelineWheel = (e: React.WheelEvent) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            setPps((prev) => {
                const next = e.deltaY < 0 ? prev * 1.15 : prev * 0.85;
                return Math.min(Math.max(Math.round(next), PPS_MIN), PPS_MAX);
            });
        } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && tlBodyRef.current) {
            tlBodyRef.current.scrollLeft += e.deltaY;
        }
    };

    // Open edit modal for active shot
    const handleOpenEditModal = () => {
        if (!activeShot) return;
        setEditModalOpen(true);
    };

    /**
     * 回填镜头设定必须等弹窗挂载之后再做。
     * 弹窗关闭时 Form 未挂载，直接 setFieldsValue 会触发 rc-field-form 的
     * 「Instance created by `useForm` is not connected to any Form element」告警，且回填不可靠。
     */
    useEffect(() => {
        if (!editModalOpen || !activeShot) return;
        editForm.setFieldsValue({
            id: activeShot.id,
            sourceEpisodeId: activeShot.sourceEpisodeId,
            sourceSceneId: activeShot.sourceSceneId,
            sourceScriptExcerpt: activeShot.sourceScriptExcerpt,
            shotNumber: activeShot.shotNumber,
            sortOrder: activeShot.sortOrder,
            durationSeconds: activeShot.durationSeconds,
            shotSize: activeShot.shotSize || "中景",
            composition: activeShot.composition || "",
            visualDescription: activeShot.visualDescription || "",
            actionDescription: activeShot.actionDescription || "",
            cameraMovement: activeShot.cameraMovement || "固定镜头",
            lightingAtmosphere: activeShot.lightingAtmosphere || "",
            dialogueVoiceover: activeShot.dialogueVoiceover || "",
            soundDescription: activeShot.soundDescription || "",
            styleOverride: activeShot.styleOverride || "",
            productionStatus: activeShot.productionStatus || "draft",
            assetVersionIds: activeShot.assetVersionIds || [],
            revision: activeShot.revision,
        });
        // 只在弹窗打开的那一帧回填一次；播放头移动导致的 activeShot 变化不重新回填
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editModalOpen]);

    // Save shot edits from modal
    const handleSaveEditModal = async () => {
        try {
            const values = await editForm.validateFields();
            setSavingShot(true);
            await saveShot(values);
            message.success(`镜头 #${activeShot?.shotNumber} 设定已更新`);
            setEditModalOpen(false);
        } catch (err) {
            if (err instanceof Error) message.error(err.message);
        } finally {
            setSavingShot(false);
        }
    };

    // 触发当前镜头视频生成：任务进行中不允许重复发起，避免创建重复任务。
    const handleGenerateShot = () => {
        if (!activeShot) return;
        const media = getShotMedia(activeShot.id);
        if (media?.status === "queued" || media?.status === "processing") return;
        setGenerationShotIds([activeShot.id]);
    };

    // Copy prompt text
    const handleCopyPrompt = (text: string, type: "final" | "snapshot") => {
        if (!text) return;
        navigator.clipboard.writeText(text);
        setCopiedPromptType(type);
        message.success("提示词已复制到剪贴板");
        setTimeout(() => setCopiedPromptType((current) => current === type ? null : current), 2000);
    };

    const activeMedia = activeShot ? getShotMedia(activeShot.id) : undefined;
    const activeMediaUrl = activeMedia ? readComicDramaMediaUrl(activeMedia.resultData) : "";
    const isVideo = isVideoMedia(activeMedia, activeMediaUrl);
    const isActiveMediaGenerating = activeMedia?.status === "processing" || activeMedia?.status === "queued";
    // 失败原因只在分镜板就地展示，不再要求用户跑去媒体生成中心查看
    const isActiveMediaFailed = activeMedia?.status === "failed";
    const activeMediaFailureReason = activeMedia?.failureReason || "";
    // 上游变更只登记待确认项、不改镜头状态，因此「需要更新」由待确认项派生
    const activeShotStatusInfo = activeShot && activeShot.productionStatus !== "needsUpdate"
            && pendingImpactTargets.has(`shot:${activeShot.id}`)
        ? { label: "需要更新", color: "warning" }
        : STATUS_MAP[activeShot?.productionStatus || ""] || STATUS_MAP.draft;
    const activePosterUrl = activeShot
        ? readComicDramaThumbnailUrl(activeMedia?.resultData) || getShotImagePoster(activeShot.id)
        : "";
    const shotDuration = activeShot ? getShotDuration(activeShot) : 5;
    const previewVideoSourceKey = isVideo && activeShot ? `${activeShot.id}:${activeMediaUrl}` : "";
    const previewCurrentTime =
        isVideo && previewVideoProgress.sourceKey === previewVideoSourceKey ? previewVideoProgress.currentTime : localTime;
    const previewDuration =
        isVideo && previewVideoProgress.sourceKey === previewVideoSourceKey && previewVideoProgress.duration > 0
            ? previewVideoProgress.duration
            : shotDuration;
    const shotProgressPercent = Math.min(Math.max((previewCurrentTime / previewDuration) * 100, 0), 100);

    // 顶部进度条以视频实际播放位置为准；拖动分镜轨道后由 seeked 事件同步更新。
    const updatePreviewVideoProgress = useCallback(
        (video: HTMLVideoElement) => {
            if (!previewVideoSourceKey || !Number.isFinite(video.currentTime)) return;
            const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
            setPreviewVideoProgress((previous) => {
                if (
                    previous.sourceKey === previewVideoSourceKey &&
                    Math.abs(previous.currentTime - video.currentTime) < 0.01 &&
                    Math.abs(previous.duration - duration) < 0.01
                ) {
                    return previous;
                }
                return { sourceKey: previewVideoSourceKey, currentTime: video.currentTime, duration };
            });
        },
        [previewVideoSourceKey]
    );

    // 生成配置只展示已采用的最终提示词，保证与下一次视频生成读取的版本一致。
    const finalVideoPrompt = useMemo(() => {
        if (!activeShot) return null;
        return promptVersions
            .filter((prompt) => prompt.shotId === activeShot.id && prompt.status === "adopted")
            .sort((first, second) => second.versionNumber - first.versionNumber)[0] || null;
    }, [activeShot, promptVersions]);

    // 已生成视频保留本次任务的提示词快照，便于与当前最终提示词核对。
    const previousVideoPromptInfo = useMemo(() => {
        const mediaPrompt = (activeMedia?.inputSnapshot as Record<string, unknown> | undefined)?.prompt;
        if (typeof mediaPrompt === "string" && mediaPrompt.trim()) {
            return {
                text: mediaPrompt.trim(),
                label: "本次视频生成快照提示词",
                model: typeof (activeMedia?.inputSnapshot as Record<string, unknown> | undefined)?.model === "string"
                    ? formatModelName(String((activeMedia?.inputSnapshot as Record<string, unknown>).model))
                    : undefined,
            };
        }
        return null;
    }, [activeMedia]);

    // 关联视觉资产解析：根据 activeShot.assetVersionIds 解析资产名、版本名及参考图
    const associatedAssets = useMemo(() => {
        if (!activeShot || !activeShot.assetVersionIds || activeShot.assetVersionIds.length === 0) {
            return [];
        }
        return activeShot.assetVersionIds.map((vId) => {
            const asset = assets.find((a) => (versionsByAsset[a.id] || []).some((v) => v.id === vId));
            const version = asset ? (versionsByAsset[asset.id] || []).find((v) => v.id === vId) : undefined;
            // 需要更新只代表上游有变更，历史结果仍要展示给用户，口径与资产阶段保持一致。
            const matchedMedia = mediaList.find(
                (m) => m.targetType === "assetVersion" && m.targetId === vId && (m.status === "completed" || m.status === "needsUpdate")
            );
            const imageUrl = matchedMedia ? readComicDramaMediaUrl(matchedMedia.resultData) : "";
            return {
                versionId: vId,
                assetId: asset?.id,
                assetName: asset?.name || "未知资产",
                assetType: asset?.assetType || "character",
                versionName: version?.versionName || vId.split("_")[1] || vId,
                variantType: version?.variantType || "default",
                appearanceDescription: version?.appearanceDescription || asset?.description || "",
                imageUrl,
            };
        });
    }, [activeShot, assets, versionsByAsset, mediaList]);

    // 分镜图参考底图（分镜图已采用或已生成，作为图生视频参考；needsUpdate 只代表上游有变更，历史结果仍要展示）
    const storyboardReferenceImage = useMemo(() => {
        if (!activeShot) return "";
        const imageMedia = mediaList.find(
            (m) => m.targetType === "shot" && m.targetId === activeShot.id && m.mediaType === "image" && (m.adopted || m.status === "completed" || m.status === "needsUpdate")
        );
        if (imageMedia) {
            return readComicDramaMediaUrl(imageMedia.resultData);
        }
        return "";
    }, [activeShot, mediaList]);

    // 所属集与场次可读标签
    const shotEpisodeSceneLabel = useMemo(() => {
        if (!activeShot) return "";
        const ep = episodes.find((e) => e.id === activeShot.sourceEpisodeId);
        if (!ep) return "";
        const sc = ep.scenes?.find((s) => s.id === activeShot.sourceSceneId);
        if (sc) {
            return `第${ep.episodeNumber}集 · 第${sc.sceneNumber}场 ${sc.location ? `(${sc.location})` : ""}`;
        }
        return `第${ep.episodeNumber}集：${ep.title || "无标题"}`;
    }, [activeShot, episodes]);

    // 所有 Hook 必须在条件返回前执行；切换分集导致镜头列表为空时，仍保持固定调用顺序。
    if (!workspace) return null;

    return (
        <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--studio-bg)] text-[var(--studio-text)]">
            {/* Topbar: Subtitle, Episode Switcher, Views & Actions */}
            <header className="z-30 flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--studio-line)] bg-[var(--studio-panel-solid)]/90 px-5 py-2 backdrop-blur-md">
                <div className="flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--studio-brand-start)] to-[var(--studio-brand-end)] text-[var(--studio-action-foreground)] shadow-md shadow-[var(--studio-brand-glow)] font-bold text-sm">
                        ◈
                    </div>
                    <div>
                        <div className="text-sm font-semibold tracking-wide text-[var(--studio-ink)]">
                            视觉分镜板 · 工作台
                        </div>
                        <div className="text-[11px] text-[var(--studio-muted)]">
                            {workspace.scriptProject.overview.title || "漫剧项目"} · 共 {viewMode === "timeline" ? timelineShots.length : filteredShots.length} 个镜头
                        </div>
                    </div>
                </div>

                <div className="flex min-w-0 flex-wrap items-center justify-end gap-2.5">
                    <Select
                        className="w-36 [&_.ant-select-selector]:!bg-[var(--studio-surface)] [&_.ant-select-selector]:!border-[var(--studio-line)] [&_.ant-select-selection-item]:!text-[var(--studio-ink)]"
                        value={selectedEpisodeId}
                        onChange={(episodeId) => {
                            setSelectedEpisodeId(episodeId);
                            setSelectedShotId(null);
                            setSelectedPreviewTextId(null);
                            setSelectedTimelineNode(null);
                            const firstIndex = episodeId === "all" ? 0 : shotIntervals.findIndex(({ shot }) => shot.sourceEpisodeId === episodeId);
                            if (firstIndex >= 0) setCurrentTime(shotIntervals[firstIndex].startMs / 1000);
                        }}
                        options={[
                            { value: "all", label: "全部分集" },
                            ...episodes.map((ep) => ({
                                value: ep.id,
                                label: `第${ep.episodeNumber}集：${ep.title || "无标题"}`,
                            })),
                        ]}
                    />

                    {timelineSaveError ? <span className="max-w-52 truncate text-xs text-rose-500" title={timelineSaveError}>保存失败：{timelineSaveError}</span> : pendingTimelineCount > 0 ? <span className="text-xs text-[var(--studio-muted)]">待保存 {pendingTimelineCount} 项</span> : null}
                    <Button size="small" icon={<Save className="size-3.5" />} disabled={!pendingTimelineCount} loading={timelineSaving} onClick={() => void savePendingTimelineChanges().then((saved) => { if (saved) message.success("时间轴已保存"); else message.error(useComicDramaStore.getState().timelineSaveError || "仍有待保存的修改"); })}>保存</Button>

                    {/* View mode toggle */}
                    <div className="flex items-center rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-0.5">
                        <button
                            type="button"
                            style={viewMode === "timeline" ? ACTIVE_STYLE : undefined}
                            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                                viewMode === "timeline"
                                    ? "shadow-sm"
                                    : "text-[var(--studio-muted)] hover:text-[var(--studio-ink)]"
                            }`}
                            onClick={() => setViewMode("timeline")}
                        >
                            <Film className="size-3.5" />
                            <span>时间轴</span>
                        </button>
                        <button
                            type="button"
                            style={viewMode === "grid" ? ACTIVE_STYLE : undefined}
                            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                                viewMode === "grid"
                                    ? "shadow-sm"
                                    : "text-[var(--studio-muted)] hover:text-[var(--studio-ink)]"
                            }`}
                            onClick={() => setViewMode("grid")}
                        >
                            <LayoutGrid className="size-3.5" />
                            <span>网格板</span>
                        </button>
                    </div>

                    <Button
                        type="primary"
                        className="!bg-[var(--studio-primary)] hover:!bg-[var(--studio-primary-hover)] !text-[var(--studio-action-foreground)] !border-none text-xs font-semibold shadow-md shadow-[var(--studio-primary-soft)]"
                        icon={<Sparkles className="size-3.5" />}
                        disabled={filteredShots.length === 0}
                        onClick={() => setGenerationShotIds(filteredShots.map((shot) => shot.id))}
                    >
                        批量媒体生成
                    </Button>
                </div>
            </header>

            {/* 分集切换控件始终保留，空分集仅替换内容区，避免用户无法切回有分镜的分集。 */}
            {shots.length === 0 || (viewMode === "grid" && filteredShots.length === 0) ? (
                <div className="flex flex-1 items-center justify-center p-8">
                    <Empty description="当前分集暂无镜头画面，请先进行镜头拆分">
                        <Button type="primary" icon={<Clapperboard className="size-4" />} onClick={() => setActiveStage("shots")}>
                            前往镜头拆分
                        </Button>
                    </Empty>
                </div>
            ) : viewMode === "grid" ? (
                /* Traditional Grid View */
                <div className="flex-1 overflow-y-auto p-6 bg-[var(--studio-bg)]">
                    <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                        {filteredShots.map((shot, idx) => {
                            const media = getShotMedia(shot.id);
                            const url = media ? readComicDramaMediaUrl(media.resultData) : "";
                            const isVid = isVideoMedia(media, url);
                            const poster = readComicDramaThumbnailUrl(media?.resultData) || getShotImagePoster(shot.id);
                            const d = getShotDuration(shot);
                            return (
                                <div
                                    key={shot.id}
                                    className="group flex flex-col overflow-hidden rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] shadow-sm transition-all hover:border-[var(--studio-primary)] hover:shadow-md"
                                >
                                    <div className="relative aspect-video w-full overflow-hidden bg-black/60">
                                        {url ? (
                                            isVid ? (
                                                <div
                                                    className="relative flex h-full w-full cursor-pointer items-center justify-center"
                                                    onClick={() => setPreviewVideoUrl(url)}
                                                >
                                                    <video
                                                        src={url.includes("#") ? url : `${url}#t=0.001`}
                                                        poster={poster || undefined}
                                                        className="h-full w-full object-contain"
                                                        muted
                                                        playsInline
                                                        preload="metadata"
                                                        onLoadedMetadata={(e) => {
                                                            try {
                                                                if (e.currentTarget.currentTime === 0) {
                                                                    e.currentTarget.currentTime = 0.001;
                                                                }
                                                            } catch {}
                                                        }}
                                                    />
                                                    <div className="absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity group-hover:bg-black/10">
                                                        <Play className="size-8 text-white/90 drop-shadow" />
                                                    </div>
                                                </div>
                                            ) : (
                                                <img src={url} alt={`镜头 #${shot.shotNumber}`} className="h-full w-full object-cover" />
                                            )
                                        ) : media?.status === "failed" ? (
                                            <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 p-3 text-center text-xs text-rose-500">
                                                <AlertCircle className="size-6" />
                                                <span>生成失败</span>
                                            </div>
                                        ) : (
                                            <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 p-3 text-center text-xs text-[var(--studio-muted)]">
                                                <Video className="size-6 text-[var(--studio-faint)]" />
                                                <span>未生成画面</span>
                                            </div>
                                        )}
                                        <div className="absolute left-2 top-2 flex items-center gap-1">
                                            <span className="rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] font-bold text-white">
                                                #{shot.shotNumber}
                                            </span>
                                            <span className="rounded bg-black/60 px-1 py-0.5 text-[10px] text-white/90">
                                                {Number.isInteger(d) ? `${d}s` : `${d.toFixed(1)}s`}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex flex-1 flex-col justify-between p-3">
                                        <p className="line-clamp-2 text-xs leading-5 text-[var(--studio-text)]">
                                            {shot.visualDescription || "暂无画面描述"}
                                        </p>
                                        {media?.status === "failed" && (
                                            <p
                                                className="mt-1.5 line-clamp-3 text-[10px] leading-4 text-rose-500"
                                                title={media?.failureReason || ""}
                                            >
                                                {media?.failureReason || "任务未返回具体失败原因"}
                                            </p>
                                        )}
                                        <div className="mt-2.5 flex items-center justify-between border-t border-[var(--studio-line)] pt-2">
                                            <span className="text-[11px] text-[var(--studio-muted)]">{shot.cameraMovement || "固定镜头"}</span>
                                            <Button
                                                size="small"
                                                type="text"
                                                className="!text-[var(--studio-primary)] hover:!text-[var(--studio-primary-hover)]"
                                                onClick={() => {
                                                    seekToShotStart(timelineShots.findIndex((item) => item.id === shot.id));
                                                    setViewMode("timeline");
                                                }}
                                            >
                                                在工作台预览
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : (
                /* Timeline Workbench View */
                <main ref={stageRef} className="relative flex flex-1 min-h-0 w-full overflow-hidden bg-[var(--studio-bg-depth)]">
                    {/* Full-size Stage View */}
                    <div className="relative h-full w-full">
                        {/* Top Floating Pill Tabs */}
                        <div className="absolute left-5 top-4 z-20 flex rounded-full border border-[var(--studio-line)] bg-[var(--studio-panel-solid)]/80 p-1 shadow-lg backdrop-blur-md">
                            <button
                                type="button"
                                style={flipSide === "preview" ? ACTIVE_STYLE : undefined}
                                className={`relative z-10 rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${
                                    flipSide === "preview"
                                        ? "shadow-sm"
                                        : "text-[var(--studio-muted)] hover:text-[var(--studio-ink)]"
                                }`}
                                onClick={() => setFlipSide("preview")}
                            >
                                视频预览
                            </button>
                            <button
                                type="button"
                                style={flipSide === "config" ? ACTIVE_STYLE : undefined}
                                className={`relative z-10 rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${
                                    flipSide === "config"
                                        ? "shadow-sm"
                                        : "text-[var(--studio-muted)] hover:text-[var(--studio-ink)]"
                                }`}
                                onClick={() => setFlipSide("config")}
                            >
                                生成配置
                            </button>
                        </div>

                        {/* 3D Flip Container */}
                        <div className="h-full w-full [perspective:1800px]">
                            <div
                                className={`relative h-full w-full transition-transform duration-700 [transform-style:preserve-3d] ${
                                    flipSide === "config" ? "[transform:rotateY(180deg)]" : ""
                                }`}
                            >
                                {/* FRONT FACE: Video/Media Preview */}
                                {/* 翻转后正面仍留在同一平面，必须禁掉命中测试，否则会抢走背面底部按钮的点击 */}
                                <section
                                    className={`absolute inset-0 overflow-hidden bg-[var(--studio-bg-depth)] [backface-visibility:hidden] ${
                                        flipSide === "config" ? "pointer-events-none" : ""
                                    }`}
                                >
                                    <div ref={previewSurfaceRef} className="relative flex h-full w-full items-center justify-center bg-[var(--studio-media)] overflow-hidden">
                                        {/* Frame background or real media */}
                                        {activeMediaUrl ? (
                                            isVideo ? (
                                                        <video
                                                    ref={videoRef}
                                                    src={activeMediaUrl}
                                                    poster={activePosterUrl || undefined}
                                                    className="h-full w-full max-h-full max-w-full object-contain cursor-pointer"
                                                    playsInline
                                                    muted={isMuted}
                                                    loop
                                                    onClick={() => setIsPlaying((prev) => !prev)}
                                                    onLoadedMetadata={(e) => {
                                                        const d = e.currentTarget.duration;
                                                                if (activeShot && Number.isFinite(d) && d > 0) {
                                                                    if (e.currentTarget.videoWidth && e.currentTarget.videoHeight) setPreviewRatio(e.currentTarget.videoWidth / e.currentTarget.videoHeight);
                                                            const preciseDur = Math.round(d * 10) / 10;
                                                            setRealVideoDurations((prev) => {
                                                                if (prev[activeShot.id] === preciseDur) return prev;
                                                                return { ...prev, [activeShot.id]: preciseDur };
                                                            });
                                                        }
                                                        try {
                                                            if (e.currentTarget.currentTime === 0) {
                                                                e.currentTarget.currentTime = 0.001;
                                                            }
                                                        } catch {}
                                                        updatePreviewVideoProgress(e.currentTarget);
                                                    }}
                                                    onTimeUpdate={(e) => updatePreviewVideoProgress(e.currentTarget)}
                                                    onSeeked={(e) => updatePreviewVideoProgress(e.currentTarget)}
                                                />
                                            ) : (
                                                <img
                                                    src={activeMediaUrl}
                                                    alt={`镜头 #${activeShot?.shotNumber}`}
                                                    className="h-full w-full max-h-full max-w-full object-contain"
                                                    onLoad={(event) => {
                                                        const image = event.currentTarget;
                                                        if (image.naturalWidth && image.naturalHeight) setPreviewRatio(image.naturalWidth / image.naturalHeight);
                                                    }}
                                                />
                                            )
                                        ) : isActiveMediaGenerating ? (
                                            <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center">
                                                <Spin size="large" />
                                                <div className="mt-4 text-sm font-semibold tracking-wide text-[var(--studio-ink)]">
                                                    本镜头正在生成视频
                                                </div>
                                                <div className="mt-1 text-xs text-[var(--studio-muted)]">
                                                    生成完成后将自动更新状态并渲染最新视频
                                                </div>
                                            </div>
                                        ) : isActiveMediaFailed ? (
                                            /* 生成失败：就地展示失败原因与重试入口 */
                                            <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center">
                                                <AlertCircle className="size-8 text-rose-500" />
                                                <div className="text-sm font-semibold tracking-wide text-rose-500">视频生成失败</div>
                                                <div className="max-h-24 max-w-xl overflow-y-auto whitespace-pre-wrap break-words text-xs leading-5 text-[var(--studio-muted)]">
                                                    {activeMediaFailureReason || "任务未返回具体失败原因"}
                                                </div>
                                                <Button
                                                    size="small"
                                                    type="primary"
                                                    ghost
                                                    className="mt-2 !border-[var(--studio-primary-line)] !text-[var(--studio-primary)]"
                                                    onClick={() => setFlipSide("config")}
                                                >
                                                    前往配置重新生成
                                                </Button>
                                            </div>
                                        ) : (
                                            /* Aesthetic Empty Frame Placeholder */
                                            <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center">
                                                <div className="mb-3 flex size-14 items-center justify-center rounded-2xl border border-dashed border-[var(--studio-line-strong)] bg-[var(--studio-surface-soft)] text-[var(--studio-muted)]">
                                                    <Video className="size-7" />
                                                </div>
                                                <div className="text-sm font-semibold tracking-wide text-[var(--studio-ink)]">
                                                    该镜头尚未生成视频
                                                </div>
                                                <div className="mt-1 text-xs text-[var(--studio-muted)]">
                                                    切换到「生成配置」并生成后可拖动时间轴预览
                                                </div>
                                                <Button
                                                    size="small"
                                                    type="primary"
                                                    ghost
                                                    className="mt-4 !border-[var(--studio-primary-line)] !text-[var(--studio-primary)]"
                                                    onClick={() => setFlipSide("config")}
                                                >
                                                    前往配置与生成
                                                </Button>
                                            </div>
                                        )}

                                        {previewRatio > 0 ? <div
                                            ref={previewFrameRef}
                                            className="pointer-events-none absolute z-10 overflow-hidden"
                                            style={{
                                                width: Math.min(previewBounds.width, previewBounds.height * previewRatio),
                                                height: Math.min(previewBounds.height, previewBounds.width / previewRatio),
                                                left: "50%", top: "50%", transform: "translate(-50%, -50%)",
                                            }}
                                        >
                                            {activeTexts.map((item) => {
                                                const position = textPositions[item.id] || { x: item.positionX, y: item.positionY };
                                                return (
                                                    <button
                                                        key={item.id}
                                                        type="button"
                                                        aria-label={`拖动文字：${item.content}`}
                                                        aria-pressed={selectedPreviewTextId === item.id}
                                                        title="拖动调整位置，双击编辑"
                                                        className={`pointer-events-auto absolute max-w-[90%] cursor-move whitespace-pre-wrap break-words rounded-sm border px-1.5 py-0.5 leading-tight focus-visible:outline-2 focus-visible:outline-[var(--studio-action)] ${draggingPreviewTextId === item.id ? "border-[var(--studio-action)]" : "border-transparent"}`}
                                                        style={{
                                                            left: `${position.x * 100}%`, top: `${position.y * 100}%`,
                                                            transform: "translate(-50%, -50%)",
                                                            fontSize: `${Math.max(12, item.fontSize * Math.min(previewBounds.width, previewBounds.height * previewRatio) / 1000)}px`,
                                                            color: item.color, backgroundColor: item.backgroundColor || "transparent", textAlign: item.alignment,
                                                            textShadow: item.backgroundColor ? undefined : "0 1px 3px rgb(0 0 0 / 75%)",
                                                        }}
                                                        onPointerDown={(event) => {
                                                            event.stopPropagation();
                                                            if (event.button !== 0) return;
                                                            setIsPlaying(false);
                                                            setSelectedPreviewTextId(item.id);
                                                            setSelectedTimelineNode({ kind: "text", id: item.id });
                                                            event.currentTarget.setPointerCapture(event.pointerId);
                                                            textWasDraggedRef.current = false;
                                                            textDragRef.current = { id: item.id, x: position.x, y: position.y };
                                                        }}
                                                        onPointerMove={movePreviewText}
                                                        onPointerUp={finishPreviewTextDrag}
                                                        onPointerCancel={finishPreviewTextDrag}
                                                        onClick={(event) => { event.stopPropagation(); textWasDraggedRef.current = false; }}
                                                        onDoubleClick={(event) => { event.stopPropagation(); setTextDraft(item); }}
                                                    >
                                                        {item.content}
                                                    </button>
                                                );
                                            })}
                                        </div> : null}

                                        {/* Top-Right Badges */}
                                        <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
                                            <span className="rounded-full border border-[var(--studio-line)] bg-[var(--studio-panel-solid)]/85 px-3 py-1 text-xs font-semibold text-[var(--studio-ink)] backdrop-blur-md shadow-sm">
                                                镜头 {pad2(activeShot?.shotNumber || activeIndex + 1)} · {activeShot?.shotSize || "中景"} · {Number.isInteger(shotDuration) ? `${shotDuration}s` : `${shotDuration.toFixed(1)}s`}
                                            </span>
                                            <span
                                                role="status"
                                                aria-live="polite"
                                                aria-atomic="true"
                                                className={`rounded-full border px-2.5 py-1 text-xs font-semibold backdrop-blur-md shadow-sm ${
                                                    activeMedia?.status === "completed" || activeMediaUrl
                                                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                                        : isActiveMediaGenerating
                                                        ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 animate-pulse"
                                                        : isActiveMediaFailed
                                                        ? "border-rose-500/40 bg-rose-500/10 text-rose-500"
                                                        : "border-[var(--studio-line)] bg-[var(--studio-surface-soft)] text-[var(--studio-muted)]"
                                                }`}
                                            >
                                                {activeMedia?.status === "completed" || activeMediaUrl
                                                    ? "已生成"
                                                    : isActiveMediaGenerating
                                                    ? "生成中"
                                                    : isActiveMediaFailed
                                                    ? "生成失败"
                                                    : "未生成"}
                                            </span>
                                        </div>

                                        {/* Transport Bar */}
                                        <div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-3 border-t border-[var(--studio-line)]/50 bg-gradient-to-t from-[var(--studio-panel-solid)]/95 via-[var(--studio-panel-solid)]/70 to-transparent px-5 py-3.5 text-xs text-[var(--studio-text)]">
                                            {/* Play / Pause & Skip buttons */}
                                            <div className="flex items-center gap-1.5">
                                                <button
                                                    type="button"
                                                    className="flex size-6 items-center justify-center rounded-md text-[var(--studio-muted)] hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]"
                                                    onClick={handlePrevShot}
                                                    title="上一个镜头"
                                                >
                                                    <SkipBack className="size-3.5" />
                                                </button>
                                                <button
                                                    type="button"
                                                    style={ACTIVE_STYLE}
                                                    className="flex size-7 items-center justify-center rounded-md hover:bg-[var(--studio-primary-hover)] shadow-sm"
                                                    onClick={() => setIsPlaying((prev) => !prev)}
                                                    title={isPlaying ? "暂停" : "播放"}
                                                >
                                                    {isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                                                </button>
                                                <button
                                                    type="button"
                                                    className="flex size-6 items-center justify-center rounded-md text-[var(--studio-muted)] hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]"
                                                    onClick={handleNextShot}
                                                    title="下一个镜头"
                                                >
                                                    <SkipForward className="size-3.5" />
                                                </button>
                                            </div>

                                            {/* Timecode */}
                                            <span className="font-mono text-xs font-semibold text-[var(--studio-ink)]">
                                                {fmtTime(previewCurrentTime)} / {fmtTime(previewDuration)}
                                            </span>

                                            {/* Micro progress fill */}
                                            <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-[var(--studio-line)]">
                                                <div
                                                    className="h-full rounded-full bg-gradient-to-r from-[var(--studio-brand-start)] to-[var(--studio-brand-end)] shadow-sm transition-all duration-75"
                                                    style={{ width: `${shotProgressPercent}%` }}
                                                />
                                            </div>

                                            {/* Meta tags */}
                                            <span className="text-[11px] text-[var(--studio-muted)]">
                                                {activeShot?.cameraMovement || "固定镜头"} · {activeShot?.shotSize || "全景"} · {Number.isInteger(shotDuration) ? `${shotDuration}s` : `${shotDuration.toFixed(1)}s`}
                                            </span>

                                            {/* Sound Toggle */}
                                            <button
                                                type="button"
                                                className="flex size-6 items-center justify-center rounded-md text-[var(--studio-muted)] hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)] transition-colors ml-1"
                                                onClick={() => setIsMuted((prev) => !prev)}
                                                title={isMuted ? "开启声音" : "静音"}
                                            >
                                                {isMuted ? (
                                                    <VolumeX className="size-3.5 text-rose-500" />
                                                ) : (
                                                    <Volume2 className="size-3.5 text-[var(--studio-primary)]" />
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                </section>

                                {/* BACK FACE: Generation Configuration & Shot Details */}
                                <section className="absolute inset-0 overflow-hidden bg-[var(--studio-panel-solid)] [backface-visibility:hidden] [transform:rotateY(180deg)]">
                                    <div className="mx-auto flex h-full max-w-5xl flex-col">
                                        {/* Scrollable Content Area */}
                                        <div className="flex-1 overflow-y-auto px-8 pb-6 pt-16 hover-scrollbar">
                                            {/* Shot Header Bar: Badges, Status & Episode info */}
                                            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--studio-line)] pb-4">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="rounded bg-[var(--studio-line)] px-2.5 py-1 font-mono text-sm font-bold text-[var(--studio-ink)]">
                                                        #{pad2(activeShot?.shotNumber || activeIndex + 1)}
                                                    </span>
                                                    <Tag color="cyan" className="px-2 py-0.5 text-xs font-medium">
                                                        {activeShot?.shotSize || "未定景别"}
                                                    </Tag>
                                                    <Tag color="geekblue" className="px-2 py-0.5 text-xs font-medium">
                                                        {activeShot?.cameraMovement || "固定镜头"}
                                                    </Tag>
                                                    <span className="text-xs font-semibold text-[var(--studio-muted)]">
                                                        {Number.isInteger(shotDuration) ? `${shotDuration}s` : `${shotDuration.toFixed(1)}s`}
                                                    </span>
                                                    {activeShot && (
                                                        <Tag color={activeShotStatusInfo.color}>{activeShotStatusInfo.label}</Tag>
                                                    )}
                                                    <Tag
                                                        color={
                                                            activeMedia?.status === "completed" || activeMediaUrl
                                                                ? "success"
                                                                : isActiveMediaGenerating
                                                                ? "processing"
                                                                : isActiveMediaFailed
                                                                ? "error"
                                                                : "default"
                                                        }
                                                    >
                                                        {activeMedia?.status === "completed" || activeMediaUrl
                                                            ? "视频已生成"
                                                            : isActiveMediaGenerating
                                                            ? "视频生成中"
                                                            : isActiveMediaFailed
                                                            ? "视频生成失败"
                                                            : "视频未生成"}
                                                    </Tag>
                                                </div>

                                                {shotEpisodeSceneLabel && (
                                                    <div className="text-xs font-medium text-[var(--studio-muted)]">
                                                        {shotEpisodeSceneLabel}
                                                    </div>
                                                )}
                                            </div>

                                            <div className="flex flex-col gap-4">
                                                {/* 1. 下一次视频生成将使用的最终提示词 */}
                                                <div className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4 shadow-sm">
                                                    <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <Sparkles className="size-4 text-purple-500" />
                                                            <span className="text-xs font-bold text-[var(--studio-ink)]">
                                                                最终视频提示词
                                                            </span>
                                                            <Tag color={finalVideoPrompt ? "purple" : "default"} className="text-[10px]">
                                                                {finalVideoPrompt ? `已采用 v${finalVideoPrompt.versionNumber}` : "未生成"}
                                                            </Tag>
                                                            {finalVideoPrompt?.model && (
                                                                <Tag className="text-[10px]">
                                                                    模型: {formatModelName(finalVideoPrompt.model)}
                                                                </Tag>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-1.5">
                                                            <Button
                                                                size="small"
                                                                icon={copiedPromptType === "final" ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                                                                onClick={() => handleCopyPrompt(finalVideoPrompt?.prompt || "", "final")}
                                                                disabled={!finalVideoPrompt?.prompt}
                                                            >
                                                                {copiedPromptType === "final" ? "已复制" : "复制提示词"}
                                                            </Button>
                                                            <Button
                                                                size="small"
                                                                type="text"
                                                                className="!text-[var(--studio-primary)] hover:!text-[var(--studio-primary-hover)] text-xs"
                                                                onClick={() => setActiveStage("shots")}
                                                            >
                                                                镜头清单
                                                            </Button>
                                                        </div>
                                                    </div>
                                                    <p className="mb-2 text-xs text-[var(--studio-muted)]">下一次视频生成将使用此已采用版本。</p>
                                                    <div className="max-h-48 overflow-y-auto rounded-lg border border-[var(--studio-line)]/60 bg-[var(--studio-panel-solid)] p-3 text-xs leading-relaxed text-[var(--studio-text)] select-text whitespace-pre-wrap font-sans">
                                                        {finalVideoPrompt?.prompt || "暂无最终视频提示词，请先在「镜头清单」中使用 AI 生成并采用。"}
                                                    </div>
                                                </div>

                                                {/* 2. 上次视频生成的提示词快照 */}
                                                {previousVideoPromptInfo ? (
                                                    <div className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-4 shadow-sm">
                                                        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <Clapperboard className="size-4 text-emerald-500" />
                                                                <span className="text-xs font-bold text-[var(--studio-ink)]">上次视频生成提示词</span>
                                                                <Tag color="green" className="text-[10px]">{previousVideoPromptInfo.label}</Tag>
                                                                {previousVideoPromptInfo.model ? <Tag className="text-[10px]">模型: {previousVideoPromptInfo.model}</Tag> : null}
                                                            </div>
                                                            <Button
                                                                size="small"
                                                                icon={copiedPromptType === "snapshot" ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                                                                onClick={() => handleCopyPrompt(previousVideoPromptInfo.text, "snapshot")}
                                                            >
                                                                {copiedPromptType === "snapshot" ? "已复制" : "复制提示词"}
                                                            </Button>
                                                        </div>
                                                        <div className="max-h-48 overflow-y-auto rounded-lg border border-[var(--studio-line)]/60 bg-[var(--studio-panel-solid)] p-3 text-xs leading-relaxed text-[var(--studio-text)] select-text whitespace-pre-wrap font-sans">
                                                            {previousVideoPromptInfo.text}
                                                        </div>
                                                    </div>
                                                ) : null}

                                                {/* 3. 镜头清单核心属性 (Roughly consistent with 镜头清单 3 columns) */}
                                                <div className="grid gap-3 text-xs sm:grid-cols-2 md:grid-cols-3">
                                                    {/* Column 1: 画面构图与内容 */}
                                                    <div className="flex flex-col rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-3.5 shadow-sm">
                                                        <div className="mb-2 flex items-center gap-1.5 font-semibold text-[var(--studio-ink)]">
                                                            <Film className="size-3.5 text-cyan-500" />
                                                            <span>画面构图与内容</span>
                                                        </div>
                                                        <p className="flex-1 leading-5 text-[var(--studio-text)]">
                                                            {activeShot?.visualDescription || "暂无画面描述"}
                                                        </p>
                                                        {activeShot?.actionDescription && (
                                                            <div className="mt-2.5 border-t border-[var(--studio-line)] pt-2 text-[var(--studio-muted)]">
                                                                <span className="font-medium text-[var(--studio-ink)]">动作调度：</span>
                                                                {activeShot.actionDescription}
                                                            </div>
                                                        )}
                                                        {activeShot?.composition && (
                                                            <div className="mt-1 text-[var(--studio-faint)]">
                                                                <span className="font-medium">构图方式：</span>
                                                                {activeShot.composition}
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Column 2: 对白与声音 */}
                                                    <div className="flex flex-col rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-3.5 shadow-sm">
                                                        <div className="mb-2 flex items-center gap-1.5 font-semibold text-[var(--studio-ink)]">
                                                            <Volume2 className="size-3.5 text-blue-500" />
                                                            <span>对白与声音</span>
                                                        </div>
                                                        <div className="flex-1">
                                                            {activeShot?.dialogueVoiceover ? (
                                                                <p className="leading-5 font-medium italic text-[var(--studio-primary)]">
                                                                    “{activeShot.dialogueVoiceover}”
                                                                </p>
                                                            ) : (
                                                                <p className="leading-5 text-[var(--studio-muted)]">无台词 / 纯画面镜头</p>
                                                            )}
                                                        </div>
                                                        <div className="mt-2.5 border-t border-[var(--studio-line)] pt-2 text-[var(--studio-muted)]">
                                                            {activeShot?.soundDescription ? (
                                                                <div>
                                                                    <span className="font-medium text-[var(--studio-ink)]">音效：</span>
                                                                    {activeShot.soundDescription}
                                                                </div>
                                                            ) : (
                                                                <div className="text-[var(--studio-faint)]">
                                                                    暂无音效设定
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Column 3: 光线氛围与运镜 */}
                                                    <div className="flex flex-col rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-3.5 shadow-sm">
                                                        <div className="mb-2 flex items-center gap-1.5 font-semibold text-[var(--studio-ink)]">
                                                            <Sliders className="size-3.5 text-amber-500" />
                                                            <span>光线氛围与运镜</span>
                                                        </div>
                                                        <div className="flex-1 space-y-1.5 text-[var(--studio-text)]">
                                                            <div>
                                                                <span className="text-[var(--studio-muted)]">光线氛围：</span>
                                                                {activeShot?.lightingAtmosphere || "自然光影"}
                                                            </div>
                                                            <div>
                                                                <span className="text-[var(--studio-muted)]">运镜方式：</span>
                                                                <span className="font-medium text-[var(--studio-ink)]">
                                                                    {activeShot?.cameraMovement || "固定镜头"}
                                                                </span>
                                                            </div>
                                                            {activeShot?.styleOverride && (
                                                                <div>
                                                                    <span className="text-[var(--studio-muted)]">风格覆盖：</span>
                                                                    {activeShot.styleOverride}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* 3. 关联资产与参考图 (Associated Assets & Reference Images) */}
                                                <div className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4 shadow-sm">
                                                    <div className="mb-3 flex items-center justify-between">
                                                        <div className="flex items-center gap-2">
                                                            <Layers className="size-4 text-purple-500" />
                                                            <span className="text-xs font-bold text-[var(--studio-ink)]">
                                                                关联视觉资产与参考图
                                                            </span>
                                                            <span className="text-xs text-[var(--studio-muted)]">
                                                                (共 {associatedAssets.length} 项关联资产)
                                                            </span>
                                                        </div>
                                                    </div>

                                                    {associatedAssets.length === 0 && !storyboardReferenceImage ? (
                                                        <div className="rounded-lg border border-dashed border-[var(--studio-line)] p-4 text-center text-xs text-[var(--studio-muted)]">
                                                            该镜头暂未绑定任何角色、场景或道具资产，可在编辑镜头中添加关联版本
                                                        </div>
                                                    ) : (
                                                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                                            {/* Keyframe / Storyboard Image if exists */}
                                                            {storyboardReferenceImage && (
                                                                <div className="flex gap-3 rounded-lg border border-[var(--studio-primary-line)] bg-[var(--studio-primary-soft)]/20 p-2.5">
                                                                    <div className="relative size-16 shrink-0 overflow-hidden rounded bg-black/40">
                                                                        <Image
                                                                            src={storyboardReferenceImage}
                                                                            alt="分镜参考底图"
                                                                            className="h-full w-full object-cover"
                                                                            preview={{ mask: "预览" }}
                                                                        />
                                                                    </div>
                                                                    <div className="flex flex-1 flex-col justify-center min-w-0">
                                                                        <div className="flex items-center gap-1">
                                                                            <Tag color="blue" className="text-[10px] m-0">参考图</Tag>
                                                                            <span className="truncate text-xs font-semibold text-[var(--studio-ink)]">
                                                                                分镜参考底图
                                                                            </span>
                                                                        </div>
                                                                        <div className="mt-1 text-[11px] text-[var(--studio-muted)]">
                                                                            图生视频首帧关键底图
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {/* Associated Assets */}
                                                            {associatedAssets.map((assetItem) => {
                                                                const typeCfg = ASSET_TYPE_CONFIG[assetItem.assetType] || { label: "资产", color: "default" };
                                                                return (
                                                                    <div
                                                                        key={assetItem.versionId}
                                                                        className="flex gap-3 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] p-2.5 transition-all hover:border-[var(--studio-line-strong)]"
                                                                    >
                                                                        <div className="relative size-16 shrink-0 overflow-hidden rounded bg-[var(--studio-line)]">
                                                                            {assetItem.imageUrl ? (
                                                                                <Image
                                                                                    src={assetItem.imageUrl}
                                                                                    alt={assetItem.assetName}
                                                                                    className="h-full w-full object-cover"
                                                                                    preview={{ mask: "预览" }}
                                                                                />
                                                                            ) : (
                                                                                <div className="flex h-full w-full items-center justify-center text-[var(--studio-muted)]">
                                                                                    <ImageIcon className="size-5" />
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                        <div className="flex flex-1 flex-col justify-center min-w-0">
                                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                                <Tag color={typeCfg.color} className="text-[10px] m-0">
                                                                                    {typeCfg.label}
                                                                                </Tag>
                                                                                <span className="truncate text-xs font-semibold text-[var(--studio-ink)]">
                                                                                    {assetItem.assetName}
                                                                                </span>
                                                                            </div>
                                                                            <div className="mt-1 truncate text-[11px] text-[var(--studio-muted)]">
                                                                                版本：{assetItem.versionName} · {VARIANT_TYPE_LABELS[assetItem.variantType] || assetItem.variantType}
                                                                            </div>
                                                                            {assetItem.appearanceDescription && (
                                                                                <div className="mt-0.5 line-clamp-1 text-[10px] text-[var(--studio-faint)]">
                                                                                    {assetItem.appearanceDescription}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* 4. 视频生成参数快照 (Video Generation Parameters Snapshot) */}
                                                {activeMedia && (
                                                    <div className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-surface-soft)]/60 p-3.5">
                                                        <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-[var(--studio-ink)]">
                                                            <Clapperboard className="size-3.5 text-emerald-500" />
                                                            <span>生成任务快照参数</span>
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                                                            <div className="rounded border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-2">
                                                                <span className="block text-[10px] text-[var(--studio-muted)]">生成模型</span>
                                                                <span
                                                                    className="block truncate font-semibold text-[var(--studio-ink)]"
                                                                    title={formatModelName(String((activeMedia.inputSnapshot as Record<string, unknown> | undefined)?.model || "")) || "未记录"}
                                                                >
                                                                    {formatModelName(String((activeMedia.inputSnapshot as Record<string, unknown> | undefined)?.model || "")) || "未记录"}
                                                                </span>
                                                            </div>
                                                            <div className="rounded border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-2">
                                                                <span className="block text-[10px] text-[var(--studio-muted)]">画幅与分辨率</span>
                                                                <span className="block font-semibold text-[var(--studio-ink)]">
                                                                    {String((activeMedia.inputSnapshot as Record<string, unknown> | undefined)?.size || workspace?.settings.aspectRatio || "16:9")} · {String((activeMedia.inputSnapshot as Record<string, unknown> | undefined)?.resolution || (activeMedia.inputSnapshot as Record<string, unknown> | undefined)?.vquality || "1080P")}
                                                                </span>
                                                            </div>
                                                            <div className="rounded border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-2">
                                                                <span className="block text-[10px] text-[var(--studio-muted)]">生成模式</span>
                                                                <span className="block font-semibold text-[var(--studio-ink)]">
                                                                    {(activeMedia.inputSnapshot as Record<string, unknown> | undefined)?.videoGenerationMode === "image-to-video" ? "图生视频" : "文生视频"}
                                                                </span>
                                                            </div>
                                                            <div className="rounded border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-2">
                                                                <span className="block text-[10px] text-[var(--studio-muted)]">任务状态</span>
                                                                <span
                                                                    className={`block font-semibold ${
                                                                        isActiveMediaFailed ? "text-rose-500" : "text-emerald-600 dark:text-emerald-400"
                                                                    }`}
                                                                >
                                                                    {activeMedia.status === "completed"
                                                                        ? "完成"
                                                                        : activeMedia.status === "processing"
                                                                        ? "生成中"
                                                                        : activeMedia.status === "failed"
                                                                        ? "失败"
                                                                        : activeMedia.status}
                                                                </span>
                                                            </div>
                                                        </div>

                                                        {isActiveMediaFailed && (
                                                            <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-500">
                                                                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                                                                <span className="min-w-0 whitespace-pre-wrap break-words leading-5">
                                                                    {activeMediaFailureReason || "任务未返回具体失败原因"}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Config Footer Actions */}
                                        <div className="relative z-20 flex shrink-0 items-center justify-between border-t border-[var(--studio-line)] bg-[var(--studio-panel-solid)] px-8 py-3.5">
                                            <Button
                                                size="small"
                                                type="text"
                                                className="!text-[var(--studio-muted)] hover:!text-[var(--studio-ink)]"
                                                onClick={() => setFlipSide("preview")}
                                            >
                                                返回预览
                                            </Button>

                                            <div className="flex items-center gap-2">
                                                <Button
                                                    size="small"
                                                    icon={<Edit className="size-3.5" />}
                                                    onClick={handleOpenEditModal}
                                                >
                                                    编辑镜头
                                                </Button>
                                                <Button
                                                    size="small"
                                                    type="primary"
                                                    className="!bg-[var(--studio-primary)] hover:!bg-[var(--studio-primary-hover)] !text-[var(--studio-action-foreground)] !border-none font-semibold shadow-md shadow-[var(--studio-primary-soft)]"
                                                    icon={<Sparkles className="size-3.5" />}
                                                    loading={isActiveMediaGenerating}
                                                    disabled={isActiveMediaGenerating}
                                                    onClick={handleGenerateShot}
                                                >
                                                    {activeMedia?.status === "completed" || activeMediaUrl ? "重新生成视频" : "生成此镜头"}
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                </section>
                            </div>
                        </div>
                    </div>
                </main>
            )}

            {/* Bottom Timeline Dock */}
            {viewMode === "timeline" && (
                <footer className="z-20 flex shrink-0 flex-col border-t border-[var(--studio-line)] bg-[var(--studio-panel-solid)] pb-2 select-none" style={{ height: 286 + (textTrackCount - 1) * 48 }}>
                    {/* Timeline Head Bar */}
                    <div className="flex shrink-0 items-center justify-between px-5 py-2.5">
                        <div className="text-xs font-semibold text-[var(--studio-ink)]">
                            分镜轨道
                            <span className="ml-2 font-normal text-[var(--studio-muted)]">
                                共 {timelineShots.length} 个镜头 · 总时长 {totalDuration.toFixed(1)}s
                            </span>
                        </div>

                        <div className="flex items-center gap-3 text-xs text-[var(--studio-muted)]">
                            <span className="hidden rounded-full border border-[var(--studio-primary-line)] bg-[var(--studio-primary-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--studio-primary)] lg:inline-flex">
                                ← 拖动时间轴竖线定位 · 按空格键播放/暂停 →
                            </span>

                            <div className="flex items-center gap-1.5">
                                <button
                                    type="button"
                                    className="flex size-6 items-center justify-center rounded border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] text-[var(--studio-muted)] hover:border-[var(--studio-line-strong)] hover:text-[var(--studio-ink)]"
                                    onClick={zoomOut}
                                    title="缩小时间轴"
                                >
                                    <ZoomOut className="size-3.5" />
                                </button>
                                <div className="relative h-1 w-20 overflow-hidden rounded-full bg-[var(--studio-line)]">
                                    <div
                                        className="h-full rounded-full bg-gradient-to-r from-[var(--studio-brand-start)] to-[var(--studio-brand-end)] transition-all"
                                        style={{ width: `${((pps - PPS_MIN) / (PPS_MAX - PPS_MIN)) * 100}%` }}
                                    />
                                </div>
                                <button
                                    type="button"
                                    className="flex size-6 items-center justify-center rounded border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] text-[var(--studio-muted)] hover:border-[var(--studio-line-strong)] hover:text-[var(--studio-ink)]"
                                    onClick={zoomIn}
                                    title="放大时间轴"
                                >
                                    <ZoomIn className="size-3.5" />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Timeline Track Body */}
                    <div className="flex min-h-0 flex-1">
                        <div className="z-10 w-36 shrink-0 border-r border-[var(--studio-line)] bg-[var(--studio-panel-solid)] text-xs text-[var(--studio-ink)]">
                            <div className="h-5 border-b border-[var(--studio-line)]" />
                            <div className="flex h-[88px] items-center gap-2 border-b border-[var(--studio-line)] px-3 font-medium"><Video className="size-4" aria-hidden="true" />视频轨道</div>
                            {Array.from({ length: textTrackCount }, (_, trackNumber) => (
                                <div key={trackNumber} className="flex h-12 items-center justify-between border-b border-[var(--studio-line)] px-3 font-medium">
                                    <span className="flex items-center gap-2"><Type className="size-4" aria-hidden="true" />{trackNumber === 0 ? "文字轨道" : `文字轨道${trackNumber}`}</span>
                                    {trackNumber === 0
                                        ? <button type="button" className="flex size-8 items-center justify-center rounded hover:bg-[var(--studio-surface-soft)] focus-visible:outline-2 focus-visible:outline-[var(--studio-action)]" aria-label="添加文字" title="添加文字" onClick={openNewText}><Plus className="size-3.5" /></button>
                                        : <button type="button" className="flex size-8 items-center justify-center rounded text-[var(--studio-muted)] hover:bg-[var(--studio-surface-soft)] hover:text-rose-500 focus-visible:outline-2 focus-visible:outline-[var(--studio-action)]" aria-label={`删除文字轨道${trackNumber}`} title={`删除文字轨道${trackNumber}`} onClick={() => confirmDeleteTextTrack(trackNumber)}><Trash2 className="size-3.5" /></button>}
                                </div>
                            ))}
                            <div className="flex h-12 items-center justify-between px-3 font-medium">
                                <span className="flex items-center gap-2"><Music2 className="size-4" aria-hidden="true" />音频轨道</span>
                                <button type="button" className="flex size-8 items-center justify-center rounded hover:bg-[var(--studio-surface-soft)] focus-visible:outline-2 focus-visible:outline-[var(--studio-action)]" aria-label="添加音频" title="添加音频" onClick={openNewAudio}><Plus className="size-3.5" /></button>
                            </div>
                        </div>
                    <div
                        ref={tlBodyRef}
                        className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden hover-scrollbar [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--studio-scrollbar)] hover:[&::-webkit-scrollbar-thumb]:bg-[var(--studio-scrollbar)]/80"
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={handlePointerUp}
                        onPointerLeave={handlePointerLeave}
                        onWheel={handleTimelineWheel}
                    >
                        <div
                            ref={tlContentRef}
                            className="relative flex h-full min-w-full flex-col"
                            style={{ width: `${Math.max(totalDuration * pps + 100, 600)}px` }}
                        >
                            {/* Ruler */}
                            <div className="relative h-5 shrink-0 border-b border-[var(--studio-line)]">
                                {Array.from({ length: Math.ceil(totalDuration) + 2 }).map((_, sec) => {
                                    const left = sec * pps;
                                    const step = pps < 30 ? 5 : pps < 50 ? 2 : 1;
                                    if (sec % step !== 0) return null;
                                    return (
                                        <div
                                            key={sec}
                                            className="absolute bottom-0 h-2 w-[1px] bg-[var(--studio-line-strong)]"
                                            style={{ left: `${left}px` }}
                                        >
                                            <span className="absolute -top-3.5 left-1 font-mono text-[9px] text-[var(--studio-faint)]">
                                                {sec}s
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Shot Clips Container */}
                            <div className="relative flex h-[88px] shrink-0 items-start border-b border-[var(--studio-line)] pt-1">
                                {timelineShots.map((shot, idx) => {
                                    const dur = getShotDuration(shot);
                                    const clipWidth = dur * pps;
                                    const media = getShotMedia(shot.id);
                                    const url = media ? readComicDramaMediaUrl(media.resultData) : "";
                                    const isVid = isVideoMedia(media, url);
                                    const hasVideo = Boolean(url && isVid);
                                    const posterUrl = readComicDramaThumbnailUrl(media?.resultData) || getShotImagePoster(shot.id);
                                    const isActive = selectedTimelineNode
                                        ? selectedTimelineNode.kind === "video" && selectedTimelineNode.id === shot.id
                                        : idx === activeIndex;

                                    return (
                                        <div
                                            key={shot.id}
                                            className={`group relative h-[80px] shrink-0 px-0.5 ${selectedEpisodeId !== "all" && shot.sourceEpisodeId !== selectedEpisodeId ? "opacity-35" : ""}`}
                                            style={{ width: `${clipWidth}px` }}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setIsPlaying(false);
                                                setSelectedShotId(shot.id);
                                                setSelectedPreviewTimeMs(null);
                                                setSelectedPreviewTextId(null);
                                                setSelectedTimelineNode({ kind: "video", id: shot.id });
                                            }}
                                        >
                                            <div
                                                className={`relative h-full w-full overflow-hidden rounded-lg border bg-[var(--studio-surface-raised)] transition-all duration-150 ${
                                                    isActive
                                                        ? "border-[var(--studio-primary)] shadow-lg shadow-[var(--studio-primary-soft)] ring-1 ring-[var(--studio-primary)]"
                                                        : "border-[var(--studio-line)] hover:border-[var(--studio-line-strong)]"
                                                }`}
                                            >
                                                {/* Clip Video Preview or Default Video Icon (Neutral Background) */}
                                                <TimelineClipThumbnail
                                                    url={url}
                                                    hasVideo={hasVideo}
                                                    posterUrl={posterUrl}
                                                    alt={`镜头 #${shot.shotNumber}`}
                                                />

                                                {/* Clip Index & Duration Tag */}
                                                <span className="absolute left-1.5 top-1.5 z-10 rounded bg-[var(--studio-panel-solid)]/90 border border-[var(--studio-line)] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[var(--studio-ink)] backdrop-blur-sm shadow-sm">
                                                    #{pad2(shot.shotNumber)} · {Number.isInteger(dur) ? `${dur}s` : `${dur.toFixed(1)}s`}
                                                </span>

                                                {/* Status Tag */}
                                                <span
                                                    className={`absolute right-1.5 top-1.5 z-10 rounded px-1.5 py-0.5 text-[8.5px] font-medium backdrop-blur-sm shadow-sm ${
                                                        hasVideo
                                                            ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                                            : media?.status === "failed"
                                                            ? "border border-rose-500/30 bg-rose-500/10 text-rose-500"
                                                            : "border border-[var(--studio-line)] bg-[var(--studio-surface-soft)] text-[var(--studio-muted)]"
                                                    }`}
                                                >
                                                    {hasVideo ? "已生成" : media?.status === "failed" ? "失败" : "未生成"}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}

                                {/* Mouse Hover Ghost Needle & Time Tooltip */}
                                {hoverTime !== null && (
                                    <div
                                        className="pointer-events-none absolute top-1 z-10 w-[1.5px] bg-[var(--studio-primary)]/70 shadow-sm shadow-[var(--studio-primary)]"
                                        style={{
                                            height: 190 + (textTrackCount - 1) * 48,
                                            transform: `translateX(${hoverTime * pps}px)`,
                                            willChange: "transform",
                                        }}
                                    >
                                        <span className="absolute -top-4 -translate-x-1/2 rounded bg-[var(--studio-panel-solid)] border border-[var(--studio-primary-line)] px-1 py-0.5 font-mono text-[9px] text-[var(--studio-primary)] backdrop-blur-sm shadow">
                                            {fmtTime(hoverTime)}
                                        </span>
                                    </div>
                                )}

                                {/* Playhead Needle */}
                                <div
                                    className="absolute top-1 z-20 w-3 cursor-ew-resize touch-none"
                                    style={{
                                        height: 190 + (textTrackCount - 1) * 48,
                                        transform: `translateX(${currentTime * pps - 5}px)`,
                                        willChange: "transform",
                                    }}
                                    onPointerDown={handlePointerDown}
                                    title="拖动时间轴竖线"
                                >
                                    <div className="pointer-events-none absolute inset-y-0 left-[5px] w-[2px] bg-gradient-to-b from-[var(--studio-brand-start)] to-[var(--studio-brand-end)] shadow-md shadow-[var(--studio-brand-glow)]" />
                                    {/* Playhead Top Pin */}
                                    <div className="pointer-events-none absolute -top-1.5 left-0 size-3 rounded-sm bg-gradient-to-br from-[var(--studio-brand-start)] to-[var(--studio-brand-end)] shadow-lg shadow-[var(--studio-brand-glow)]" />
                                </div>
                            </div>

                            {Array.from({ length: textTrackCount }, (_, trackNumber) => <div key={trackNumber} className="relative h-12 shrink-0 border-b border-[var(--studio-line)] bg-[var(--studio-surface-soft)]/35">
                                {timelineTexts.filter((item) => item.trackNumber === trackNumber).map((source) => {
                                    // 被拖动片段始终跟随鼠标；只有其他片段预览换位后的落点。
                                    const item = clipDraft?.kind === "text" && clipDraft.item.id === source.id
                                        ? clipDraft.item : textReorderDraft.find((draft) => draft.id === source.id) || source;
                                    return (
                                        <button key={source.id} type="button" title={`${item.content} · 双击编辑，拖动移动，两端调整时间`} aria-pressed={selectedTimelineNode?.kind === "text" && selectedTimelineNode.id === source.id} className={`absolute top-1.5 h-9 min-w-[8px] touch-none cursor-grab overflow-hidden rounded border bg-[var(--studio-primary-soft)] text-left text-xs text-[var(--studio-ink)] active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-[var(--studio-action)] ${selectedTimelineNode?.kind === "text" && selectedTimelineNode.id === source.id ? "border-[var(--studio-primary)] shadow-lg shadow-[var(--studio-primary-soft)] ring-1 ring-[var(--studio-primary)]" : "border-[var(--studio-primary-line)] hover:border-[var(--studio-primary)]"} ${clipDragRef.current?.id === source.id ? "z-30" : ""}`} style={{ left: item.startMs / 1000 * pps, width: (item.endMs - item.startMs) / 1000 * pps }}
                                            onPointerDown={(event) => startClipDrag(event, { kind: "text", item })}
                                            onDragStart={(event) => event.preventDefault()}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                if (clipWasDraggedRef.current) { clipWasDraggedRef.current = false; return; }
                                                setIsPlaying(false);
                                                setFlipSide("preview");
                                                const previewTimeMs = item.startMs + Math.min(50, (item.endMs - item.startMs) / 2);
                                                setSelectedShotId(locate(previewTimeMs / 1000).shot?.id || null);
                                                setSelectedPreviewTimeMs(previewTimeMs);
                                                setSelectedPreviewTextId(item.id);
                                                setSelectedTimelineNode({ kind: "text", id: item.id });
                                            }}
                                            onDoubleClick={(event) => { event.stopPropagation(); setIsPlaying(false); setTextDraft(item); }}
                                            onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setIsPlaying(false); setTextDraft(item); }}>
                                            <span data-edge="left" className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize" />
                                            <span className="block truncate px-2 pt-2">{item.content}</span>
                                            <span data-edge="right" className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize" />
                                        </button>
                                    );
                                })}
                            </div>)}
                            <div className="relative h-12 shrink-0 bg-[var(--studio-surface-soft)]/15">
                                {scheduledVoices.map((source) => {
                                    const item = clipDraft?.kind === "audio" && clipDraft.item.id === source.id ? clipDraft.item : source;
                                    const endMs = voiceTrackEndMs(item);
                                    if (item.timelineStartMs == null || endMs == null) return null;
                                    const error = item.audioStorageKey ? audioErrors[item.audioStorageKey] : "";
                                    return (
                                        <button key={source.id} type="button" title={error || `${item.content} · 点击编辑，拖动移动，两端裁剪音频`} aria-pressed={selectedTimelineNode?.kind === "audio" && selectedTimelineNode.id === source.id} className={`absolute top-1.5 h-9 min-w-[8px] touch-none overflow-hidden rounded border bg-[var(--studio-surface-raised)] text-left text-xs focus-visible:outline-2 focus-visible:outline-[var(--studio-action)] ${clipDragRef.current?.id === source.id ? "z-30" : ""} ${selectedTimelineNode?.kind === "audio" && selectedTimelineNode.id === source.id ? "border-[var(--studio-primary)] shadow-lg shadow-[var(--studio-primary-soft)] ring-1 ring-[var(--studio-primary)]" : error ? "border-red-500" : "border-[var(--studio-line-strong)]"} ${error ? "text-red-500" : "text-[var(--studio-ink)]"}`} style={{ left: item.timelineStartMs / 1000 * pps, width: (endMs - item.timelineStartMs) / 1000 * pps }}
                                            onPointerDown={(event) => startClipDrag(event, { kind: "audio", item })}
                                            onDragStart={(event) => event.preventDefault()}
                                            onClick={(event) => { event.stopPropagation(); if (clipWasDraggedRef.current) { clipWasDraggedRef.current = false; return; } setIsPlaying(false); setSelectedPreviewTextId(null); setSelectedTimelineNode({ kind: "audio", id: item.id }); setAudioFile(null); setAudioDraft(item); }}>
                                            <span data-edge="left" className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize border-r border-[var(--studio-line-strong)]" />
                                            <span className="flex items-center gap-1 truncate px-2 pt-2"><Music2 className="size-3 shrink-0" />{error || item.content}</span>
                                            <span data-edge="right" className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize border-l border-[var(--studio-line-strong)]" />
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                    </div>
                </footer>
            )}

            {scheduledVoices.map((track) => track.audioStorageKey && audioUrls[track.audioStorageKey] ? (
                <audio
                    key={track.id}
                    ref={(element) => { audioRefs.current[track.id] = element; }}
                    src={audioUrls[track.audioStorageKey]}
                    preload="auto"
                    onError={() => setAudioErrors((current) => ({ ...current, [track.audioStorageKey!]: "音频文件加载失败，请重新上传" }))}
                />
            ) : null)}

            <Modal
                title={timelineTexts.some((item) => item.id === textDraft?.id) ? "编辑文字片段" : "添加文字片段"}
                open={Boolean(textDraft)}
                onCancel={() => setTextDraft(null)}
                onOk={() => { if (textDraft) void saveText(textDraft).then((saved) => { if (saved) setTextDraft(null); }); }}
                okText="保存文字"
                confirmLoading={savingTrack}
                destroyOnHidden
                footer={textDraft ? [
                    timelineTexts.some((item) => item.id === textDraft.id) ? <Button key="delete" danger icon={<Trash2 className="size-4" />} onClick={() => confirmDeleteText(textDraft)}>删除</Button> : null,
                    <Button key="cancel" onClick={() => setTextDraft(null)}>取消</Button>,
                    <Button key="save" type="primary" loading={savingTrack} onClick={() => { void saveText(textDraft).then((saved) => { if (saved) setTextDraft(null); }); }}>保存文字</Button>,
                ] : undefined}
            >
                {textDraft ? <div className="space-y-4 pt-3">
                    <div><label className="mb-1 block text-sm font-medium">文字内容</label><Input.TextArea rows={3} maxLength={2000} value={textDraft.content} onChange={(event) => setTextDraft({ ...textDraft, content: event.target.value })} /></div>
                    <div className="grid grid-cols-2 gap-3">
                        <div><label className="mb-1 block text-sm font-medium">字号</label><InputNumber className="w-full" min={12} max={120} value={textDraft.fontSize} onChange={(value) => setTextDraft({ ...textDraft, fontSize: value || 12 })} /></div>
                        <div><label className="mb-1 block text-sm font-medium">对齐方式</label><Select className="w-full" value={textDraft.alignment} options={[{ value: "left", label: "左对齐" }, { value: "center", label: "居中" }, { value: "right", label: "右对齐" }]} onChange={(alignment) => setTextDraft({ ...textDraft, alignment })} /></div>
                        <div><label className="mb-1 block text-sm font-medium">文字颜色</label><input type="color" className="h-9 w-full cursor-pointer rounded border border-[var(--studio-line)] bg-transparent" value={textDraft.color.slice(0, 7)} onChange={(event) => setTextDraft({ ...textDraft, color: event.target.value })} /></div>
                        <div><label className="mb-1 block text-sm font-medium">背景颜色</label><div className="flex h-9 items-center gap-2"><Checkbox checked={Boolean(textDraft.backgroundColor)} onChange={(event) => setTextDraft({ ...textDraft, backgroundColor: event.target.checked ? "#000000" : null })}>启用</Checkbox>{textDraft.backgroundColor ? <input type="color" className="h-8 w-14 cursor-pointer rounded border border-[var(--studio-line)] bg-transparent" value={textDraft.backgroundColor.slice(0, 7)} onChange={(event) => setTextDraft({ ...textDraft, backgroundColor: event.target.value })} /> : null}</div></div>
                    </div>
                </div> : null}
            </Modal>

            <Modal
                title="音频片段"
                open={Boolean(audioDraft)}
                onCancel={() => { setAudioDraft(null); setAudioFile(null); }}
                footer={audioDraft ? [
                    audioDraft.timelineStartMs != null && voiceTracks.some((item) => item.id === audioDraft.id) ? <Button key="remove" danger onClick={() => void removeAudioFromTimeline(audioDraft)}>移出轨道</Button> : null,
                    <Button key="cancel" onClick={() => { setAudioDraft(null); setAudioFile(null); }}>取消</Button>,
                    <Button key="save" type="primary" loading={savingTrack} onClick={() => void saveAudio(audioDraft)}>保存音频</Button>,
                ] : undefined}
                destroyOnHidden
            >
                {audioDraft ? <div className="space-y-4 pt-3">
                    <div><label className="mb-1 block text-sm font-medium">声音条目</label><Select className="w-full" value={voiceTracks.some((item) => item.id === audioDraft.id) ? audioDraft.id : undefined} placeholder="新建声音条目" allowClear options={voiceTracks.filter((item) => voiceTrackEndMs(item) == null || item.id === audioDraft.id).map((item) => ({ value: item.id, label: `${item.trackType} · ${item.content}` }))} onChange={(id) => {
                        const track = voiceTracks.find((item) => item.id === id);
                        setAudioFile(null);
                        if (track) setAudioDraft({ ...track, timelineStartMs: Math.round(currentTime * 1000), trimStartMs: track.audioStorageKey ? 0 : null, trimEndMs: track.audioDurationMs || null });
                        else openNewAudio();
                    }} /></div>
                    <div className="grid grid-cols-2 gap-3"><div><label className="mb-1 block text-sm font-medium">类型</label><Select className="w-full" value={audioDraft.trackType} options={[{ value: "dialogue", label: "对白" }, { value: "narration", label: "旁白" }, { value: "ambient", label: "环境声" }, { value: "soundEffect", label: "音效" }, { value: "music", label: "配乐" }]} onChange={(trackType) => setAudioDraft({ ...audioDraft, trackType })} /></div>
                    <div><label className="mb-1 block text-sm font-medium">上传音频</label><input type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" className="block w-full text-xs" onChange={(event) => void selectAudioFile(event.target.files?.[0] || null)} /></div></div>
                    <div><label className="mb-1 block text-sm font-medium">内容或声音描述</label><Input value={audioDraft.content} maxLength={12000} onChange={(event) => setAudioDraft({ ...audioDraft, content: event.target.value })} /></div>
                    <div className="grid grid-cols-3 gap-3">
                        <div><label className="mb-1 block text-sm font-medium">时间轴起点（秒）</label><InputNumber className="w-full" min={0} max={totalDuration} step={0.1} value={(audioDraft.timelineStartMs || 0) / 1000} onChange={(value) => setAudioDraft({ ...audioDraft, timelineStartMs: Math.round((value || 0) * 1000) })} /></div>
                        <div><label className="mb-1 block text-sm font-medium">裁剪起点（秒）</label><InputNumber className="w-full" min={0} max={(audioDraft.audioDurationMs || 0) / 1000} step={0.1} value={audioDraft.trimStartMs == null ? null : audioDraft.trimStartMs / 1000} onChange={(value) => setAudioDraft({ ...audioDraft, trimStartMs: Math.round((value || 0) * 1000) })} /></div>
                        <div><label className="mb-1 block text-sm font-medium">裁剪终点（秒）</label><InputNumber className="w-full" min={0} max={(audioDraft.audioDurationMs || 0) / 1000} step={0.1} value={audioDraft.trimEndMs == null ? null : audioDraft.trimEndMs / 1000} onChange={(value) => setAudioDraft({ ...audioDraft, trimEndMs: Math.round((value || 0) * 1000) })} /></div>
                    </div>
                    <p className="text-xs text-[var(--studio-muted)]">{audioFile ? `待上传：${audioFile.name}` : audioDraft.audioStorageKey ? `已关联音频 · ${((audioDraft.audioDurationMs || 0) / 1000).toFixed(1)} 秒` : "支持 MP3、WAV，最大 15 MB"}</p>
                </div> : null}
            </Modal>

            {/* Shot Edit Modal */}
            <Modal
                title={`编辑镜头 #${pad2(activeShot?.shotNumber || activeIndex + 1)} 设定`}
                open={editModalOpen}
                onCancel={() => setEditModalOpen(false)}
                onOk={handleSaveEditModal}
                confirmLoading={savingShot}
                okText="保存设定"
                cancelText="取消"
                width={620}
                destroyOnHidden
            >
                <Form form={editForm} layout="vertical" className="mt-4">
                    <Form.Item name="id" hidden><Input /></Form.Item>
                    <Form.Item name="sourceEpisodeId" hidden><Input /></Form.Item>
                    <Form.Item name="sourceSceneId" hidden><Input /></Form.Item>
                    <Form.Item name="sourceScriptExcerpt" hidden><Input /></Form.Item>
                    <Form.Item name="shotNumber" hidden><Input /></Form.Item>
                    <Form.Item name="sortOrder" hidden><Input /></Form.Item>
                    <Form.Item name="revision" hidden><Input /></Form.Item>
                    <Form.Item name="assetVersionIds" hidden><Input /></Form.Item>

                    <div className="grid grid-cols-3 gap-3">
                        <Form.Item label="景别" name="shotSize">
                            <Select options={SHOT_SIZES} />
                        </Form.Item>
                        <Form.Item label="运镜方式" name="cameraMovement">
                            <Select options={CAMERA_MOVEMENT_OPTIONS.map((c) => ({ value: c, label: c }))} />
                        </Form.Item>
                        <Form.Item label="单镜时长 (秒)" name="durationSeconds" rules={[{ required: true, message: "请输入时长" }]}>
                            <InputNumber min={1} max={60} className="w-full" />
                        </Form.Item>
                    </div>

                    <Form.Item label="画面构图与视觉描述" name="visualDescription" rules={[{ required: true, message: "请输入画面描述" }]}>
                        <Input.TextArea rows={3} placeholder="描述画面主体形态、环境细节与视觉焦点..." />
                    </Form.Item>

                    <Form.Item label="动作调度 (可选)" name="actionDescription">
                        <Input placeholder="描述人物动作细节或走位调度..." />
                    </Form.Item>

                    <div className="grid grid-cols-2 gap-3">
                        <Form.Item label="对白 / 旁白" name="dialogueVoiceover">
                            <Input.TextArea rows={2} placeholder="角色对白或旁白文本..." />
                        </Form.Item>
                        <Form.Item label="声音 / 音效" name="soundDescription">
                            <Input.TextArea rows={2} placeholder="环境音效或特殊音效..." />
                        </Form.Item>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <Form.Item label="光线氛围" name="lightingAtmosphere">
                            <Input placeholder="如：阳光斜射、冷色调夜景等" />
                        </Form.Item>
                        <Form.Item label="制作状态" name="productionStatus">
                            <Select
                                options={Object.entries(STATUS_MAP).map(([val, { label }]) => ({
                                    value: val,
                                    label,
                                }))}
                            />
                        </Form.Item>
                    </div>
                </Form>
            </Modal>

            {/* 就地生成镜头视频：参数面板与媒体生成中心同一套，避免跳转阶段；多个镜头即批量提交 */}
            <ShotGenerationModal
                open={generationShotIds.length > 0}
                shotIds={generationShotIds}
                onClose={() => setGenerationShotIds([])}
            />

            {/* Video Modal Preview */}
            <Modal
                open={Boolean(previewVideoUrl)}
                onCancel={() => setPreviewVideoUrl(null)}
                footer={null}
                width={840}
                destroyOnHidden
                centered
            >
                {previewVideoUrl && (
                    <div className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg bg-black">
                        <video src={previewVideoUrl} controls autoPlay className="h-full w-full object-contain" />
                    </div>
                )}
            </Modal>
        </div>
    );
}
