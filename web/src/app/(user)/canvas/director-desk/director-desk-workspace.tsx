"use client";
import { translateMessage as translate } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, InputNumber, Modal, Segmented, Select, Tabs, Tooltip } from "antd";
import { Box, Camera, Cuboid, Download, KeyRound, Move, PersonStanding, Plus, RotateCw, Scaling, Trash2, X } from "lucide-react";
import { saveAs } from "file-saver";
import { nanoid } from "nanoid";

import { useCanvasTheme } from "../../../../features/canvas/components/canvas-theme-provider";
import { uploadMediaFile, type UploadedFile } from "../../../../features/storage/services/file-storage";
import { uploadImage, type UploadedImage } from "../../../../features/storage/services/image-storage";
import { createMediaDownloadFileName } from "../../../../features/storage/services/media-download-name";
import type { CanvasDirectorDeskJoint, CanvasDirectorDeskMotionPath, CanvasDirectorDeskPathKind, CanvasDirectorDeskPose, CanvasDirectorDeskActionPreset, CanvasDirectorDeskAsset, CanvasDirectorDeskCamera, CanvasDirectorDeskExportSource, CanvasDirectorDeskKeyframe, CanvasDirectorDeskNode, CanvasDirectorDeskObject, CanvasDirectorDeskObjectKind, CanvasDirectorDeskProject, CanvasDirectorDeskTransform, CanvasDirectorDeskVector3 } from "../../../../features/canvas/types";
import { evaluateDirectorDeskProject, readDirectorDeskPoseAdjustment, validateDirectorDeskProject } from "./director-desk-evaluator";
import { createNeutralPose } from "./director-desk-pose";
import { removeDirectorDeskObjects } from "./director-desk-object-editing";
import { evaluateMotionPath, findMotionPathAtTime, translateMotionPath, upsertMotionPath } from "./director-desk-motion-path";
import { editDirectorDeskTimelineSegment, findActiveTimelineSegment, getEmptyTimelineInterval, setTimelineCharacterAction, type DirectorDeskTimelineSegmentReference, type TimelineInterval } from "./director-desk-timeline-segments";
import { DirectorDeskPathPanel, DirectorDeskPosePanel, DirectorDeskVectorInput, setMotionPathHeight } from "./director-desk-inspector";
import { DirectorDeskTimeline } from "./director-desk-timeline";
import { DirectorDeskScene, type DirectorDeskSceneHandle, type DirectorDeskTransformMode } from "./director-desk-scene";

type DirectorDeskWorkspaceProps = {
    open: boolean;
    projectId: string;
    node: CanvasDirectorDeskNode | null;
    onClose: () => void;
    onChangeProject: (nodeId: string, updater: (project: CanvasDirectorDeskProject) => CanvasDirectorDeskProject) => void;
    onChangeSettings: (nodeId: string, updater: (node: CanvasDirectorDeskNode) => CanvasDirectorDeskNode) => void;
    onImageExported?: (nodeId: string, image: UploadedImage, source: CanvasDirectorDeskExportSource) => void;
    onVideoExported?: (nodeId: string, video: UploadedFile, source: CanvasDirectorDeskExportSource) => void;
};

const createObjectLabels = (translator: typeof translate = translate): Record<CanvasDirectorDeskObjectKind, string> => ({
    get ground() { return translator("directorDesk.ground"); },
    get cube() { return translator("directorDesk.cube"); },
    get sphere() { return translator("directorDesk.sphere"); },
    get character() { return translator("directorDesk.mannequin"); },
    get glb() { return translator("directorDesk.gLBProp"); },
});

/** 导演台原生编辑器的首版工作区，负责工程编辑、时间轴预览和可复现求值。 */
export function DirectorDeskWorkspace({ open, projectId, node, onClose, onChangeProject, onChangeSettings, onImageExported, onVideoExported }: DirectorDeskWorkspaceProps) {
    const translate = useTranslation();
    const { message, modal } = App.useApp();
    const theme = useCanvasTheme();
    const [timeMilliseconds, setTimeMilliseconds] = useState(0);
    const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
    const [transformMode, setTransformMode] = useState<DirectorDeskTransformMode>("translate");
    const [drawingTool, setDrawingTool] = useState<CanvasDirectorDeskPathKind | null>(null);
    const [editingCameraId, setEditingCameraId] = useState<string | null>(null);
    const [inspectorTab, setInspectorTab] = useState("properties");
    const [viewMode, setViewMode] = useState<"director" | "camera">("director");
    const [selectedJoint, setSelectedJoint] = useState<CanvasDirectorDeskJoint>("body");
    const [selectedAnchor, setSelectedAnchor] = useState(0);
    const [selectedMotionPathId, setSelectedMotionPathId] = useState<string | null>(null);
    const [drawingInterval, setDrawingInterval] = useState<Pick<CanvasDirectorDeskMotionPath, "id" | "startTimeMilliseconds" | "endTimeMilliseconds"> | null>(null);
    const [drawingHeight, setDrawingHeight] = useState(0);
    const [poseKeyframing, setPoseKeyframing] = useState(false);
    const [previewPose, setPreviewPose] = useState<CanvasDirectorDeskPose | null>(null);
    const [playing, setPlaying] = useState(false);
    const [loop, setLoop] = useState(false);
    const timeRef = useRef(0);
    timeRef.current = timeMilliseconds;
    const [sceneReady, setSceneReady] = useState(false);
    const [assetUploading, setAssetUploading] = useState(false);
    const [videoExporting, setVideoExporting] = useState(false);
    const [videoExportProgress, setVideoExportProgress] = useState(0);
    const [videoExportStage, setVideoExportStage] = useState<"encoding" | "uploading">("encoding");
    const sceneRef = useRef<DirectorDeskSceneHandle>(null);
    const workspaceRef = useRef<HTMLDivElement>(null);
    const glbInputRef = useRef<HTMLInputElement>(null);
    const backgroundInputRef = useRef<HTMLInputElement>(null);

    const project = node?.director.project || null;
    const handleSceneAssetError = useCallback((error: string) => message.error(error), [message]);
    const selectedObject = project?.objects.find((object) => object.id === selectedObjectId) || null;
    const evaluation = useMemo(() => {
        if (!project) return { state: null, error: null };
        try {
            const time = Number((Math.round(timeMilliseconds * 30 / 1000) * 1000 / 30).toFixed(6));
            const source = previewPose ? { ...project, objects: project.objects.map((object) => object.id === selectedObjectId ? applyPoseAdjustment(object, previewPose, time, poseKeyframing) : object) } : project;
            return { state: evaluateDirectorDeskProject(source, timeMilliseconds), error: null };
        } catch (error) {
            return { state: null, error: error instanceof Error ? error.message : translate("directorDesk.directorSceneEvaluationFailed") };
        }
    }, [project, timeMilliseconds, previewPose, selectedObjectId, poseKeyframing, translate.locale]);
    const evaluated = evaluation.state;
    const motionPaths = (editingCameraId ? project?.cameras.find((camera) => camera.id === editingCameraId)?.motionPaths : selectedObject?.track?.motionPaths) || [];
    const selectedMotionPath = motionPaths.find((path) => path.id === selectedMotionPathId) || findActiveTimelineSegment(motionPaths, timeMilliseconds, project?.timeline.durationMilliseconds || 0);
    const poseAdjustment = useMemo(() => selectedObject ? (poseKeyframing ? readDirectorDeskPoseAdjustment(selectedObject, timeMilliseconds) : selectedObject.pose || createNeutralPose()) : createNeutralPose(), [selectedObject, timeMilliseconds, poseKeyframing, translate.locale]);

    /** 播放按钮与空格快捷键共用入口，预览不会修改工程数据。 */
    const changePlaying = useCallback((enabled: boolean) => {
        if (videoExporting) return;
        setPreviewPose(null); setSelectedMotionPathId(null);
        if (enabled) {
            sceneRef.current?.cancelDrawing(); setDrawingTool(null); setDrawingInterval(null);
            // 播放预览使用拍摄机位，与图片和视频导出的视角一致。
            setViewMode("camera");
        }
        setPlaying(enabled);
    }, [videoExporting]);

    useEffect(() => {
        if (!open || !node || !project) return;
        const togglePlayback = (event: KeyboardEvent) => {
            if (event.code !== "Space" || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
            const target = event.target;
            if (!(target instanceof Element)) return;
            const dialog = workspaceRef.current?.closest('[role="dialog"]');
            if (!dialog || target.closest('[role="dialog"]') !== dialog) return;
            if (target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="menu"],[role="menuitem"],[role="listbox"],[role="slider"],[role="spinbutton"],[role="switch"],[role="tab"]')) return;
            if (document.querySelector(".ant-dropdown:not(.ant-dropdown-hidden)")) return;
            event.preventDefault(); event.stopPropagation();
            if (!event.repeat) changePlaying(!playing);
        };
        window.addEventListener("keydown", togglePlayback, true);
        return () => window.removeEventListener("keydown", togglePlayback, true);
    }, [open, node?.id, Boolean(project), playing, changePlaying]);

    useEffect(() => {
        if (!open || !node) return;
        setTimeMilliseconds(0);
        setTransformMode("translate");
        setEditingCameraId(null);
        setPlaying(false);
        setViewMode("director");
        setDrawingTool(null);
        setDrawingInterval(null);
        setSelectedMotionPathId(null);
        setInspectorTab("properties");
        setSelectedObjectId(node.director.project.objects.find((object) => !object.locked)?.id || node.director.project.objects[0]?.id || null);
    }, [node?.id, open]);

    useEffect(() => {
        setDrawingTool(null);
        setDrawingInterval(null);
        setSelectedMotionPathId(null);
        setSelectedAnchor(0);
        setInspectorTab((tab) => tab === "pose" && selectedObject?.kind !== "character" ? "properties" : tab);
        setPoseKeyframing(false);
        setPreviewPose(null);
        sceneRef.current?.cancelDrawing();
    }, [selectedObjectId, editingCameraId]);

    useEffect(() => {
        if (editingCameraId || (selectedObjectId && project?.objects.some((object) => object.id === selectedObjectId))) return;
        setSelectedObjectId(project?.objects[0]?.id || null);
    }, [project?.objects, selectedObjectId, editingCameraId]);

    useEffect(() => {
        if (!playing || !open || !project || videoExporting) return;
        let request = 0;
        const initial = timeRef.current >= project.timeline.durationMilliseconds ? 0 : timeRef.current;
        const started = performance.now();
        const duration = project.timeline.durationMilliseconds;
        const advance = (now: number) => {
            const elapsed = initial + now - started;
            if (elapsed >= duration && !loop) { setTimeMilliseconds(duration); setPlaying(false); return; }
            const time = loop ? elapsed % duration : elapsed;
            const snapped = Number((Math.round(time * 30 / 1000) * 1000 / 30).toFixed(6));
            if (snapped !== timeRef.current) setTimeMilliseconds(snapped);
            request = requestAnimationFrame(advance);
        };
        request = requestAnimationFrame(advance);
        return () => cancelAnimationFrame(request);
    }, [playing, loop, open, project?.timeline.durationMilliseconds, videoExporting]);

    if (!node || !project) return null;

    const updateProject = (updater: (current: CanvasDirectorDeskProject) => CanvasDirectorDeskProject) => {
        if (videoExporting) return false;
        const next = updater(project);
        const errors = validateDirectorDeskProject(next);
        if (errors.length) { message.warning(errors[0]); return false; }
        setPlaying(false);
        onChangeProject(node.id, updater);
        return true;
    };
    const assets = project.assets || [];
    const updateObject = (objectId: string, updater: (object: CanvasDirectorDeskObject) => CanvasDirectorDeskObject) => {
        updateProject((current) => ({ ...current, objects: current.objects.map((object) => (object.id === objectId ? updater(object) : object)) }));
    };
    const addObject = (kind: CanvasDirectorDeskObjectKind) => {
        if (kind === "glb") {
            glbInputRef.current?.click();
            return;
        }
        const id = `${kind}-${nanoid(8)}`;
        const object: CanvasDirectorDeskObject = {
            id,
            name: `${createObjectLabels(translate)[kind]} ${project.objects.filter((item) => item.kind === kind).length + 1}`,
            kind,
            ...(kind === "character" ? { pose: createNeutralPose() } : {}),
            transform: {
                position: { x: 0, y: kind === "sphere" ? 1 : 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 },
            },
            visible: true,
            locked: false,
            track: { position: [], rotation: [], actionClips: [] },
        };
        updateProject((current) => ({ ...current, objects: [...current.objects, object] }));
        setEditingCameraId(null);
        setSelectedObjectId(id);
    };
    const addGlbAsset = async (file: File) => {
        setAssetUploading(true);
        try {
            const uploaded = await uploadMediaFile(file, "glb", { mimeType: file.type || "model/gltf-binary" });
            const asset: CanvasDirectorDeskAsset = {
                id: `asset-${nanoid(8)}`,
                name: file.name || translate("directorDesk.gLBProp"),
                kind: "glb",
                storageKey: uploaded.storageKey,
                mimeType: uploaded.mimeType || file.type || "model/gltf-binary",
                bytes: uploaded.bytes || file.size,
                ...(uploaded.objectStorage ? { objectStorage: uploaded.objectStorage } : {}),
            };
            const id = `glb-${nanoid(8)}`;
            const object: CanvasDirectorDeskObject = {
                id,
                name: asset.name,
                kind: "glb",
                assetId: asset.id,
                transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
                visible: true,
                locked: false,
                track: { position: [], rotation: [] },
            };
            updateProject((current) => ({ ...current, assets: [...(current.assets || []), asset], objects: [...current.objects, object] }));
            setEditingCameraId(null);
            setSelectedObjectId(id);
            message.success(translate("directorDesk.gLBPropAdded"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("directorDesk.gLBUploadFailed"));
        } finally {
            setAssetUploading(false);
        }
    };
    const setBackgroundImage = async (file: File) => {
        setAssetUploading(true);
        try {
            const uploaded = await uploadImage(file);
            const asset: CanvasDirectorDeskAsset = {
                id: `asset-${nanoid(8)}`,
                name: file.name || translate("directorDesk.backgroundImage"),
                kind: "image",
                storageKey: uploaded.storageKey,
                mimeType: uploaded.mimeType || file.type || "image/png",
                bytes: uploaded.bytes || file.size,
                ...(uploaded.objectStorage ? { objectStorage: uploaded.objectStorage } : {}),
            };
            updateProject((current) => ({ ...current, assets: [...(current.assets || []), asset], background: { assetId: asset.id } }));
            message.success(translate("directorDesk.backgroundImageAdded"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("directorDesk.failedToUploadBackground"));
        } finally {
            setAssetUploading(false);
        }
    };
    const clearBackground = () => updateProject((current) => ({ ...current, background: undefined }));
    const confirmRemoveObject = (objectId: string) => {
        const object = project.objects.find((item) => item.id === objectId);
        if (!object || object.locked || videoExporting || playing || assetUploading) return;
        const following = project.cameras.some((camera) => camera.targetObjectId === objectId);
        modal.confirm({
            title: translate("directorDesk.delete", { value0: object.name }),
            content: translate("directorDesk.deletesThisObjectAndAllItsMotionActionsPoses") + (following ? translate("directorDesk.linkedCamerasStopFollowingAndKeepTheirTarget") : ""),
            okText: translate("directorDesk.confirmDeletion"), cancelText: translate("directorDesk.cancel"), okButtonProps: { danger: true }, focusable: { autoFocusButton: "cancel" },
            onOk: () => {
                try {
                    const updated = updateProject((current) => removeDirectorDeskObjects(current, [objectId], timeMilliseconds));
                    if (updated && selectedObjectId === objectId) { cancelDrawing(); setPreviewPose(null); setSelectedMotionPathId(null); setSelectedObjectId(null); }
                } catch (error) { message.error(error instanceof Error ? error.message : translate("directorDesk.failedToDeleteSceneObject")); }
            },
        });
    };
    const addObjectKeyframe = () => {
        if (!selectedObject || selectedObject.locked) return;
        const evaluatedObject = stageObjects.find((object) => object.id === selectedObject.id) || selectedObject;
        const position = evaluatedObject.transform.position;
        const rotation = evaluatedObject.transform.rotation;
        const keyframeTimeMilliseconds = Number((currentFrame * frameDuration).toFixed(6));
        updateObject(selectedObject.id, (object) => ({
            ...object,
            track: {
                ...object.track,
                position: object.track?.motionPaths?.length ? [] : [
                    ...(object.track?.position || []).filter((keyframe) => keyframe.timeMilliseconds !== keyframeTimeMilliseconds),
                    { id: `${object.id}-position-${keyframeTimeMilliseconds}`, timeMilliseconds: keyframeTimeMilliseconds, value: { ...position } },
                ].sort((a, b) => a.timeMilliseconds - b.timeMilliseconds),
                rotation: [
                    ...(object.track?.rotation || []).filter((keyframe) => keyframe.timeMilliseconds !== keyframeTimeMilliseconds),
                    { id: `${object.id}-rotation-${keyframeTimeMilliseconds}`, timeMilliseconds: keyframeTimeMilliseconds, value: { ...rotation } },
                ].sort((a, b) => a.timeMilliseconds - b.timeMilliseconds),
                actionClips: object.track?.actionClips || [],
            },
        }));
    };
    const updateCamera = (cameraId: string) => {
        if (project.selectedCameraId !== cameraId) updateProject((current) => ({ ...current, selectedCameraId: cameraId }));
        setSelectedObjectId(null); setEditingCameraId(cameraId);
    };
    const selectedCamera = evaluated?.camera;
    const frameDuration = 1000 / project.timeline.frameRate;
    const currentFrame = Math.round(timeMilliseconds / frameDuration);
    const stageObjects = evaluated?.objects || [];
    const writeCameraKeyframe = (value: Pick<CanvasDirectorDeskCamera, "position" | "target" | "fieldOfView">) => {
        const keyframeTimeMilliseconds = Number((currentFrame * frameDuration).toFixed(6));
        updateProject((current) => ({
            ...current,
            cameras: current.cameras.map((camera) =>
                camera.id === current.selectedCameraId
                    ? {
                          ...camera,
                          keyframes: [
                              ...camera.keyframes.filter((keyframe) => keyframe.timeMilliseconds !== keyframeTimeMilliseconds),
                              { id: `${camera.id}-keyframe-${nanoid(8)}`, timeMilliseconds: keyframeTimeMilliseconds, value: { position: { ...(camera.motionPaths?.length ? camera.position : value.position) }, target: { ...value.target }, fieldOfView: value.fieldOfView } },
                          ].sort((a, b) => a.timeMilliseconds - b.timeMilliseconds),
                      }
                    : camera,
            ),
        }));
    };
    const updateCameraFieldOfView = (value: number | null) => {
        if (!selectedCamera || typeof value !== "number" || !Number.isFinite(value)) return;
        writeCameraKeyframe({ ...selectedCamera, fieldOfView: value });
    };
    /** 视口拖动手柄后回写对象变换：没有运动轨道的部分直接改基础值，已有轨道的部分写当前帧关键帧。 */
    const applyObjectTransform = (objectId: string, transform: CanvasDirectorDeskTransform) => {
        const keyframeTimeMilliseconds = Number((currentFrame * frameDuration).toFixed(6));
        updateObject(objectId, (object) => {
            if (object.locked) return object;
            const positionTrack = object.track?.position || [];
            const paths = object.track?.motionPaths || [];
            const path = findMotionPathAtTime(paths, timeMilliseconds);
            const currentPosition = path ? evaluateMotionPath(path, timeMilliseconds).position : object.transform.position;
            const rotationTrack = object.track?.rotation || [];
            const nextTrack = object.track
                ? {
                      ...object.track,
                      ...(path ? { motionPaths: paths.map((item) => translateMotionPath(item, { x: transform.position.x - currentPosition.x, y: transform.position.y - currentPosition.y, z: transform.position.z - currentPosition.z })) } : {}),
                      position: positionTrack.length
                          ? upsertVectorKeyframe(positionTrack, { id: `${object.id}-position-${keyframeTimeMilliseconds}`, timeMilliseconds: keyframeTimeMilliseconds, value: transform.position })
                          : positionTrack,
                      rotation: rotationTrack.length
                          ? upsertVectorKeyframe(rotationTrack, { id: `${object.id}-rotation-${keyframeTimeMilliseconds}`, timeMilliseconds: keyframeTimeMilliseconds, value: transform.rotation })
                          : rotationTrack,
                  }
                : undefined;
            return {
                ...object,
                transform: {
                    position: positionTrack.length || path ? object.transform.position : transform.position,
                    rotation: rotationTrack.length ? object.transform.rotation : transform.rotation,
                    scale: transform.scale,
                },
                ...(nextTrack ? { track: nextTrack } : {}),
            };
        });
    };
    /** 选中对象与机位互斥，视口和时间轨道使用同一选择入口。 */
    const selectObject = (id: string) => { setEditingCameraId(null); setSelectedObjectId(id); };
    const selectCamera = (id: string) => updateCamera(id);
    const applyCharacterAction = (preset: CanvasDirectorDeskActionPreset) => {
        if (!selectedObject || selectedObject.locked) return;
        const frameTime = Number((currentFrame * frameDuration).toFixed(6));
        const clips = selectedObject.track?.actionClips || [];
        try {
            const actionClips = setTimelineCharacterAction(clips, preset, frameTime, project.timeline.durationMilliseconds, nanoid());
            updateObject(selectedObject.id, (object) => ({ ...object, track: { position: [], rotation: [], ...object.track, actionClips } }));
        } catch (error) { message.warning(error instanceof Error ? error.message : translate("directorDesk.failedToAddMotion")); }
    };
    const writePoseAdjustment = (pose: CanvasDirectorDeskPose, forceKeyframe = poseKeyframing) => {
        if (!selectedObject || selectedObject.locked) return;
        const time = Number((currentFrame * frameDuration).toFixed(6));
        setPreviewPose(null);
        updateObject(selectedObject.id, (object) => applyPoseAdjustment(object, pose, time, forceKeyframe));
    };
    const rotateJoint = (joint: CanvasDirectorDeskJoint, delta: CanvasDirectorDeskVector3) => {
        const rotation = poseAdjustment.joints[joint];
        writePoseAdjustment({ ...poseAdjustment, joints: { ...poseAdjustment.joints, [joint]: { x: rotation.x + delta.x, y: rotation.y + delta.y, z: rotation.z + delta.z } } });
    };
    const updateMotionPath = (path: CanvasDirectorDeskMotionPath | undefined) => {
        if (!editingCameraId && (!selectedObject || selectedObject.locked)) return;
        const changePaths = (paths: CanvasDirectorDeskMotionPath[]) => path ? upsertMotionPath(paths, path) : paths.filter((item) => item.id !== selectedMotionPath?.id);
        const updated = updateProject((current) => editingCameraId ? {
            ...current, cameras: current.cameras.map((camera) => camera.id === editingCameraId ? {
                ...camera, motionPaths: changePaths(camera.motionPaths || []),
                keyframes: path ? camera.keyframes.map((keyframe) => ({ ...keyframe, value: { ...keyframe.value, position: { ...camera.position } } })) : camera.keyframes,
            } : camera),
        } : {
            ...current, objects: current.objects.map((object) => object.id === selectedObjectId ? { ...object, track: { position: [], rotation: [], ...object.track, motionPaths: changePaths(object.track?.motionPaths || []), ...(path ? { position: [] } : {}) } } : object),
        });
        if (updated) {
            setSelectedMotionPathId(path?.id || null);
            if (!path || path.id !== selectedMotionPath?.id) setSelectedAnchor(0);
        }
    };
    const completePath = (path: CanvasDirectorDeskMotionPath) => {
        if (!drawingInterval) return;
        const nextPath = { ...path, ...drawingInterval };
        const replacingPath = motionPaths.some((item) => item.id === nextPath.id);
        const camera = project.cameras.find((item) => item.id === editingCameraId);
        const replacingKeyframes = camera ? camera.keyframes.some((keyframe) => (["x", "y", "z"] as const).some((axis) => keyframe.value.position[axis] !== camera.position[axis])) : Boolean(selectedObject?.track?.position.length);
        setDrawingTool(null);
        setDrawingInterval(null);
        if (replacingPath || replacingKeyframes) modal.confirm({ title: replacingPath ? translate("directorDesk.redrawThisMotionSegment") : translate("directorDesk.replacePositionKeyframe"), content: replacingPath ? translate("directorDesk.onlyThisSegmentSPathIsReplacedOtherMotion") : translate("directorDesk.bindingAPathRemovesPositionKeyframesKeepingRotationPose"), okText: translate("directorDesk.replace"), cancelText: translate("directorDesk.keepOriginalMotion"), onOk: () => updateMotionPath(nextPath) });
        else updateMotionPath(nextPath);
    };
    const cancelDrawing = () => { sceneRef.current?.cancelDrawing(); setDrawingTool(null); setDrawingInterval(null); };
    const startTimelineEditing = () => { cancelDrawing(); setPlaying(false); setPreviewPose(null); };
    const editTimelineSegment = (reference: DirectorDeskTimelineSegmentReference, interval: TimelineInterval | null) => {
        try {
            const updated = updateProject((current) => editDirectorDeskTimelineSegment(current, reference, interval));
            const editingOwnerId = reference.kind === "cameraPath" ? editingCameraId : selectedObjectId;
            if (updated && !interval && reference.kind !== "action" && editingOwnerId === reference.ownerId && selectedMotionPath?.id === reference.segmentId) { setSelectedMotionPathId(null); setSelectedAnchor(0); }
        } catch (error) { message.warning(error instanceof Error ? error.message : translate("directorDesk.failedToEditTimelineClip")); }
    };
    const seek = (time: number) => {
        cancelDrawing(); setPlaying(false); setPreviewPose(null); setSelectedMotionPathId(null); setSelectedAnchor(0);
        setTimeMilliseconds(Number((Math.round(time * 30 / 1000) * 1000 / 30).toFixed(6)));
    };
    const seekPreview = (time: number) => { seek(time); setViewMode("camera"); };
    const selectMotionPath = (pathId: string) => {
        const path = motionPaths.find((item) => item.id === pathId);
        if (!path) return;
        seek(path.startTimeMilliseconds); setSelectedMotionPathId(pathId); setViewMode("director");
    };
    const appendMotionPath = () => {
        const time = Math.max(timeMilliseconds, ...motionPaths.map((path) => path.endTimeMilliseconds));
        if (time >= project.timeline.durationMilliseconds) { message.info(translate("directorDesk.extendProjectDurationBeforeAppendingMotion")); return; }
        seek(time); setInspectorTab("trajectory");
    };
    const startDrawing = (tool: CanvasDirectorDeskPathKind) => {
        const interval = selectedMotionPath || getEmptyTimelineInterval(motionPaths, timeMilliseconds, project.timeline.durationMilliseconds);
        if (!interval) { message.info(translate("directorDesk.movePlayheadToAnEmptyIntervalOrExtendDuration")); return; }
        setPlaying(false); setViewMode("director");
        const currentPosition = editingCameraId ? evaluated?.cameras.find((camera) => camera.id === editingCameraId)?.position : evaluated?.objects.find((object) => object.id === selectedObjectId)?.transform.position;
        setDrawingHeight(selectedMotionPath?.anchors[0].position.y ?? currentPosition?.y ?? 0);
        sceneRef.current?.cancelDrawing();
        setDrawingInterval({ id: selectedMotionPath?.id || nanoid(), startTimeMilliseconds: interval.startTimeMilliseconds, endTimeMilliseconds: interval.endTimeMilliseconds });
        setDrawingTool(tool); setInspectorTab("trajectory");
    };
    const applyCameraTransform = (cameraId: string, { position, target }: Pick<CanvasDirectorDeskCamera, "position" | "target">) => {
        const camera = project.cameras.find((item) => item.id === cameraId);
        const currentCamera = evaluated?.cameras.find((item) => item.id === cameraId);
        if (!camera || !currentCamera) return;
        updateProject((current) => ({ ...current, cameras: current.cameras.map((item) => {
            if (item.id !== cameraId) return item;
            if (item.motionPaths?.length) return { ...item, motionPaths: item.motionPaths.map((path) => translateMotionPath(path, { x: position.x - currentCamera.position.x, y: position.y - currentCamera.position.y, z: position.z - currentCamera.position.z })), target };
            if (!item.keyframes.length) return { ...item, position, target };
            const time = Number((currentFrame * frameDuration).toFixed(6));
            return { ...item, keyframes: [...item.keyframes.filter((keyframe) => keyframe.timeMilliseconds !== time), { id: nanoid(), timeMilliseconds: time, value: { position, target, fieldOfView: currentCamera.fieldOfView } }].sort((a, b) => a.timeMilliseconds - b.timeMilliseconds) };
        }) }));
    };
    const changeDuration = (seconds: number) => {
        const durationMilliseconds = Math.round(seconds) * 1000;
        const latestTime = Math.max(0, ...project.objects.flatMap((object) => [
            ...(object.track?.position || []).map((keyframe) => keyframe.timeMilliseconds), ...(object.track?.rotation || []).map((keyframe) => keyframe.timeMilliseconds), ...(object.track?.pose || []).map((keyframe) => keyframe.timeMilliseconds),
            ...(object.track?.actionClips || []).map((clip) => clip.endTimeMilliseconds), ...(object.track?.motionPaths || []).map((path) => path.endTimeMilliseconds),
        ]), ...project.cameras.flatMap((camera) => [...(camera.motionPaths || []).map((path) => path.endTimeMilliseconds), ...camera.keyframes.map((keyframe) => keyframe.timeMilliseconds)]));
        if (durationMilliseconds < latestTime) { modal.info({ title: translate("directorDesk.existingContentExceedsNewDuration"), content: translate("directorDesk.adjustTheEndTimesOfPathsActionClipsAnd"), okText: translate("directorDesk.gotIt") }); return; }
        if (updateProject((current) => ({ ...current, timeline: { ...current.timeline, durationMilliseconds } }))) {
            seek(durationMilliseconds > project.timeline.durationMilliseconds ? project.timeline.durationMilliseconds : Math.min(timeMilliseconds, durationMilliseconds));
        }
    };
    const exportPng = async () => {
        if (!node || !sceneRef.current) return;
        try {
            const blob = await sceneRef.current.capturePng(node.director.exportSettings.width, node.director.exportSettings.height);
            const image = await uploadImage(blob);
            saveAs(blob, createMediaDownloadFileName("img", "png"));
            onImageExported?.(node.id, image, {
                sourceCanvasDocumentId: projectId,
                sourceDirectorNodeId: node.id,
                sourceProjectRevision: node.director.projectRevision,
                sourceCameraId: project.selectedCameraId,
                sourceDurationMilliseconds: project.timeline.durationMilliseconds,
                sourceFrameRate: project.timeline.frameRate,
                sourceTimeMilliseconds: Math.round(timeMilliseconds),
            });
            message.success(translate("directorDesk.directorPNGExported"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("directorDesk.directorPNGExportFailed"));
        }
    };
    /** 浏览器生成完整MP4后，只将最终文件上传云端，编码期间不发送图片帧。 */
    const exportVideo = async () => {
        const scene = sceneRef.current;
        if (!scene || videoExporting || !sceneReady || evaluation.error) return;
        const snapshot = structuredClone(project);
        const settings = { ...node.director.exportSettings };
        const source: CanvasDirectorDeskExportSource = {
            sourceCanvasDocumentId: projectId,
            sourceDirectorNodeId: node.id,
            sourceProjectRevision: node.director.projectRevision,
            sourceCameraId: snapshot.selectedCameraId,
            sourceDurationMilliseconds: snapshot.timeline.durationMilliseconds,
            sourceFrameRate: snapshot.timeline.frameRate,
        };
        setVideoExporting(true);
        setVideoExportStage("encoding");
        setVideoExportProgress(0);
        try {
            const blob = await scene.captureVideo(snapshot, settings.width, settings.height, setVideoExportProgress);
            setVideoExportStage("uploading");
            const title = (node.title || translate("directorDesk.3DDirectorDesk")).replace(/[\\/:*?"<>|]/g, "_");
            const file = new File([blob], title + ".mp4", { type: "video/mp4" });
            const uploaded = await uploadMediaFile(file, "video", { mimeType: "video/mp4", durationMs: snapshot.timeline.durationMilliseconds });
            onVideoExported?.(node.id, { ...uploaded, width: settings.width, height: settings.height, durationMs: snapshot.timeline.durationMilliseconds }, source);
            message.success(translate("directorDesk.videoComposedInBrowserAndSavedToCloud"));
        } catch (error) {
            console.error("导演台本地视频导出失败", error);
            message.error(error instanceof Error ? error.message : translate("directorDesk.directorVideoExportFailed"));
        } finally {
            setVideoExporting(false);
            setVideoExportProgress(0);
            setVideoExportStage("encoding");
        }
    };
    const handleClose = () => {
        setPlaying(false);
        cancelDrawing();
        if (videoExporting) {
            message.info(translate("directorDesk.videoExportInProgressPleaseWait"));
            return;
        }
        onClose();
    };


    const previewObject = evaluated?.objects.find((object) => object.id === selectedObjectId);
    const editingDisabled = videoExporting || playing || Boolean(selectedObject?.locked);
    const pathPanel = <DirectorDeskPathPanel
        paths={motionPaths} path={selectedMotionPath} drawingInterval={drawingInterval} onSelectPath={selectMotionPath} onAppend={appendMotionPath}
        tool={drawingTool} height={drawingTool ? drawingHeight : selectedMotionPath?.anchors[0].position.y ?? drawingHeight}
        selectedAnchor={selectedAnchor} durationMilliseconds={project.timeline.durationMilliseconds} disabled={editingDisabled} showDirection={!editingCameraId}
        onToolChange={startDrawing} onPathChange={updateMotionPath} onHeightChange={(height) => { setDrawingHeight(height); if (selectedMotionPath && !drawingTool) updateMotionPath(setMotionPathHeight(selectedMotionPath, height)); }}
        onSelectAnchor={setSelectedAnchor} onFinish={(closed) => { if (!sceneRef.current?.finishDrawing(closed)) message.info(closed ? translate("directorDesk.aClosedPathNeedsAtLeastThreeAnchors") : translate("directorDesk.aPathNeedsAtLeastTwoAnchors")); }}
        onCancel={cancelDrawing} onRemove={() => updateMotionPath(undefined)}
    />;
    const propertiesPanel = selectedObject && previewObject ? <div className="space-y-3">
        <label className="block space-y-1 text-xs"><span>{translate("directorDesk.objectName")}</span><input className="h-8 w-full rounded border bg-transparent px-2 outline-none focus-visible:ring-2" style={{ borderColor: theme.node.stroke }} value={selectedObject.name} disabled={editingDisabled} onChange={(event) => updateObject(selectedObject.id, (object) => ({ ...object, name: event.target.value }))} /></label>
        {(["position", "rotation", "scale"] as const).map((field) => <DirectorDeskVectorInput key={field} label={field === "position" ? translate("directorDesk.position_1fb4d5") : field === "rotation" ? translate("directorDesk.rotationRadians") : translate("directorDesk.zoom")} value={previewObject.transform[field]} disabled={editingDisabled} onChange={(value) => applyObjectTransform(selectedObject.id, { ...previewObject.transform, [field]: value })} />)}
        <Button size="small" disabled={editingDisabled} onClick={() => updateObject(selectedObject.id, (object) => ({ ...object, track: { ...object.track, position: (object.track?.position || []).filter((keyframe) => Math.round(keyframe.timeMilliseconds * 30 / 1000) !== currentFrame), rotation: (object.track?.rotation || []).filter((keyframe) => Math.round(keyframe.timeMilliseconds * 30 / 1000) !== currentFrame) } }))}>{translate("directorDesk.deleteTransformKeyframe")}</Button>
        <Button size="small" disabled={editingDisabled} icon={<KeyRound className="size-3.5" />} onClick={addObjectKeyframe}>{translate("directorDesk.recordTransformKeyframe")}</Button>
    </div> : editingCameraId && selectedCamera ? <div className="space-y-3">
        <DirectorDeskVectorInput label={translate("directorDesk.cameraPosition_14221d")} value={selectedCamera.position} disabled={editingDisabled} onChange={(position) => applyCameraTransform(editingCameraId, { position, target: selectedCamera.target })} />
        <DirectorDeskVectorInput label={translate("directorDesk.target")} value={selectedCamera.target} disabled={editingDisabled || Boolean(selectedCamera.targetObjectId)} onChange={(target) => applyCameraTransform(editingCameraId, { position: selectedCamera.position, target })} />
        <label className="flex items-center justify-between text-xs"><span>{translate("directorDesk.fieldOfView")}</span><InputNumber size="small" min={1} max={179} value={selectedCamera.fieldOfView} disabled={editingDisabled} onChange={updateCameraFieldOfView} /></label>
        <label className="block space-y-1 text-xs"><span>{translate("directorDesk.cameraTarget_39f37d")}</span><Select className="w-full!" size="small" value={selectedCamera.targetObjectId || "fixed"} disabled={editingDisabled} options={[{ label: translate("directorDesk.fixedTarget"), value: "fixed" }, ...project.objects.filter((object) => object.kind !== "ground").map((object) => ({ label: translate("directorDesk.follow") + object.name, value: object.id }))]} onChange={(value) => updateProject((current) => ({ ...current, cameras: current.cameras.map((camera) => camera.id === editingCameraId ? { ...camera, targetObjectId: value === "fixed" ? undefined : value, target: selectedCamera.target, targetOffset: { x: 0, y: value === "fixed" ? 0 : project.objects.find((object) => object.id === value)?.kind === "character" ? 1 : 0, z: 0 } } : camera) }))} /></label>
        {selectedCamera.targetObjectId ? <DirectorDeskVectorInput label={translate("directorDesk.targetPositionOffset")} value={selectedCamera.targetOffset || { x: 0, y: 1, z: 0 }} disabled={editingDisabled} onChange={(targetOffset) => updateProject((current) => ({ ...current, cameras: current.cameras.map((camera) => camera.id === editingCameraId ? { ...camera, targetOffset } : camera) }))} /> : null}
        <div className="flex flex-wrap gap-2"><Button size="small" disabled={editingDisabled} onClick={() => writeCameraKeyframe(selectedCamera)}>{translate("directorDesk.recordCameraKeyframe")}</Button><Button size="small" disabled={editingDisabled} onClick={() => updateProject((current) => ({ ...current, cameras: current.cameras.map((camera) => camera.id === editingCameraId ? { ...camera, keyframes: camera.keyframes.filter((keyframe) => Math.round(keyframe.timeMilliseconds * 30 / 1000) !== currentFrame) } : camera) }))}>{translate("directorDesk.deleteCurrentFrame")}</Button></div>
    </div> : <p className="text-xs text-[var(--studio-muted)]">{translate("directorDesk.selectAnObjectOrCameraToEdit")}</p>;
    return (
        <Modal title={null} open={open} onCancel={handleClose} footer={null} closable={false} width="calc(100vw - 24px)" style={{ top: 12 }} styles={{ body: { height: "calc(100dvh - 72px)", padding: 0, overflow: "hidden" } }} destroyOnHidden>
            <div ref={workspaceRef} className="flex h-full min-h-0 flex-col" style={{ background: theme.node.panel, color: theme.node.text }}>
                <header className="flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2" style={{ borderColor: theme.node.stroke }}>
                    <Box className="size-4" aria-hidden="true" /><h2 className="text-sm font-semibold">{node.title || translate("directorDesk.3DDirectorDesk_41e832")}</h2>
                    <Segmented size="small" disabled={videoExporting || Boolean(drawingTool)} value={viewMode} options={[{ label: translate("directorDesk.directorView"), value: "director" }, { label: translate("directorDesk.cameraView"), value: "camera" }]} onChange={(value) => setViewMode(value as "director" | "camera")} />
                    <Select size="small" className="min-w-28" disabled={videoExporting} aria-label={translate("directorDesk.shootingCamera")} value={project.selectedCameraId} options={project.cameras.map((camera) => ({ label: camera.name, value: camera.id }))} onChange={updateCamera} />
                    <div className="ml-auto flex items-center gap-2">
                        <Button size="small" icon={<Download className="size-3.5" />} disabled={!sceneReady || Boolean(evaluation.error) || videoExporting || assetUploading || playing || Boolean(drawingTool)} onClick={() => void exportPng()}>{translate("directorDesk.exportPNG")}</Button>
                        <Button size="small" loading={videoExporting} disabled={!sceneReady || Boolean(evaluation.error) || assetUploading || playing || Boolean(drawingTool)} onClick={() => void exportVideo()}>{videoExporting ? videoExportStage === "uploading" ? translate("directorDesk.savingToCloud") : translate("directorDesk.encodingLocally", { value0: videoExportProgress }) : translate("directorDesk.exportVideo")}</Button>
                        <Button size="small" type="text" icon={<X className="size-4" />} aria-label={translate("directorDesk.closeDirectorDesk")} onClick={handleClose} />
                    </div>
                </header>
                <div className="grid min-h-0 flex-1 grid-cols-[176px_minmax(0,1fr)_292px] max-[1100px]:grid-cols-[136px_minmax(0,1fr)_260px]">
                    <aside className="min-h-0 overflow-y-auto border-r p-3" style={{ borderColor: theme.node.stroke }}>
                        <h3 className="mb-2 text-xs font-medium">{translate("directorDesk.scene")}</h3>
                        <div className="space-y-1">{project.cameras.map((camera) => <button key={camera.id} type="button" disabled={videoExporting || playing} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs" style={{ background: editingCameraId === camera.id ? theme.toolbar.activeBg : undefined, color: editingCameraId === camera.id ? theme.toolbar.activeText : undefined }} onClick={() => selectCamera(camera.id)}><Camera className="size-3.5 shrink-0" /><span className="truncate">{camera.name}</span></button>)}
                            {project.objects.map((object) => <div key={object.id} className="flex items-center rounded" style={{ background: selectedObjectId === object.id ? theme.toolbar.activeBg : undefined, color: selectedObjectId === object.id ? theme.toolbar.activeText : undefined }}>
                                <button type="button" disabled={videoExporting || playing} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-xs" onClick={() => selectObject(object.id)}>{object.kind === "character" ? <PersonStanding className="size-3.5 shrink-0" /> : <Cuboid className="size-3.5 shrink-0" />}<span className="truncate">{object.name}</span></button>
                                {object.kind !== "ground" ? <Tooltip title={translate("directorDesk.delete_cea126", { value0: object.name })}><Button size="small" type="text" danger className="size-6! shrink-0" disabled={videoExporting || playing || assetUploading || object.locked} aria-label={translate("directorDesk.delete_cea126", { value0: object.name })} icon={<X className="size-3.5" />} onClick={(event) => { event.stopPropagation(); confirmRemoveObject(object.id); }} /></Tooltip> : null}
                            </div>)}
                        </div>
                        <fieldset disabled={videoExporting || playing} className="mt-4 space-y-2">
                            <div className="grid grid-cols-2 gap-1">{(["character", "cube", "sphere", "glb"] as const).map((kind) => <Button key={kind} className="px-1!" size="small" onClick={() => addObject(kind)}>{createObjectLabels(translate)[kind]}</Button>)}</div>
                            <Button size="small" block icon={<Plus className="size-3" />} onClick={() => {
                                const id = "camera-" + nanoid(8);
                                updateProject((current) => ({ ...current, selectedCameraId: id, cameras: [...current.cameras, { id, name: translate("directorDesk.camera_5b6671", { value0: current.cameras.length + 1 }), position: { x: 4, y: 3, z: 6 }, target: { x: 0, y: 1, z: 0 }, fieldOfView: 42, keyframes: [] }] }));
                                setSelectedObjectId(null); setEditingCameraId(id);
                            }}>{translate("directorDesk.addCamera")}</Button>
                            <div className="border-t pt-3" style={{ borderColor: theme.node.stroke }}><h3 className="mb-2 text-xs font-medium">{translate("directorDesk.sceneAssets")}</h3>
                                <input ref={glbInputRef} hidden type="file" accept=".glb,model/gltf-binary" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void addGlbAsset(file); }} />
                                <input ref={backgroundInputRef} hidden type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void setBackgroundImage(file); }} />
                                <div className="space-y-2"><Button size="small" block loading={assetUploading} onClick={() => glbInputRef.current?.click()}>{translate("directorDesk.uploadGLB")}</Button><Button size="small" block loading={assetUploading} onClick={() => backgroundInputRef.current?.click()}>{translate("directorDesk.setBackground")}</Button>{project.background ? <Button size="small" block onClick={clearBackground}>{translate("directorDesk.removeBackground")}</Button> : null}</div>
                            </div>
                            <div className="border-t pt-3" style={{ borderColor: theme.node.stroke }}><h3 className="mb-2 text-xs font-medium">{translate("directorDesk.exportAspectRatio")}</h3><Select className="w-full!" size="small" disabled={videoExporting || playing} value={node.director.exportSettings.aspectRatio} options={[{ value: "16:9", label: translate("directorDesk.landscape169") }, { value: "9:16", label: translate("directorDesk.portrait916") }, { value: "1:1", label: translate("directorDesk.square11") }]} onChange={(aspectRatio) => onChangeSettings(node.id, (current) => ({ ...current, director: { ...current.director, exportSettings: { ...current.director.exportSettings, aspectRatio, width: aspectRatio === "16:9" ? 1280 : 720, height: aspectRatio === "9:16" ? 1280 : 720 } } }))} /></div>
                        </fieldset>
                    </aside>
                    <main className="relative min-h-0 overflow-hidden" style={{ containerType: "size", background: theme.canvas.background }}>
                        <div className="absolute inset-0 grid place-items-center">
                            <div className="relative max-h-full max-w-full overflow-hidden" style={{ aspectRatio: `${node.director.exportSettings.width} / ${node.director.exportSettings.height}`, width: `min(100cqw, calc(100cqh * ${node.director.exportSettings.width} / ${node.director.exportSettings.height}))` }}>
                                <DirectorDeskScene ref={sceneRef} objects={stageObjects} camera={selectedCamera} cameras={evaluated?.cameras || []} assets={assets} backgroundAssetId={project.background?.assetId}
                                    selectedObjectId={selectedObjectId} selectedCameraId={editingCameraId} transformMode={transformMode} viewMode={viewMode} disabled={videoExporting || playing}
                                    poseEditing={inspectorTab === "pose" && selectedObject?.kind === "character"} selectedJoint={selectedJoint}
                                    pathSettings={{ path: selectedMotionPath, tool: videoExporting || playing ? null : drawingTool, editable: inspectorTab === "trajectory" && !editingDisabled && viewMode === "director", height: drawingTool ? drawingHeight : selectedMotionPath?.anchors[0].position.y ?? drawingHeight, durationMilliseconds: project.timeline.durationMilliseconds, followDirection: selectedObject?.kind === "character", color: theme.node.activeStroke, startColor: theme.node.text, endColor: theme.node.muted }}
                                    onSelectObject={selectObject} onSelectCamera={selectCamera} onTransformObject={applyObjectTransform} onCameraChange={applyCameraTransform} onPathChange={drawingTool ? completePath : updateMotionPath} onSelectAnchor={setSelectedAnchor}
                                    onCancelDrawing={cancelDrawing} onSelectJoint={setSelectedJoint} onJointRotate={rotateJoint} onReadyChange={setSceneReady} onAssetError={handleSceneAssetError} />
                                {evaluation.error ? <div className="absolute inset-0 grid place-items-center p-6 text-center text-xs" style={{ background: theme.node.panel, color: "var(--studio-danger)" }}>{evaluation.error}</div> : null}
                            </div>
                        </div>
                        <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
                            <Segmented size="small" disabled={editingDisabled || Boolean(drawingTool) || inspectorTab === "pose" || Boolean(editingCameraId)} value={transformMode} onChange={(value) => setTransformMode(value as DirectorDeskTransformMode)} options={[{ value: "translate", label: <Tooltip title={translate("directorDesk.move")}><Move className="size-3.5" aria-label={translate("directorDesk.move")} /></Tooltip> }, { value: "rotate", label: <Tooltip title={translate("directorDesk.rotate")}><RotateCw className="size-3.5" aria-label={translate("directorDesk.rotate")} /></Tooltip> }, { value: "scale", label: <Tooltip title={translate("directorDesk.zoom")}><Scaling className="size-3.5" aria-label={translate("directorDesk.zoom")} /></Tooltip> }]} />
                        </div>
                        {drawingTool ? <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-2 rounded px-2 py-1" style={{ background: theme.node.panel }}><Button size="small" onClick={cancelDrawing}>{translate("directorDesk.cancelDrawing")}</Button>{drawingTool === "pen" ? <><Button size="small" onClick={() => { if (!sceneRef.current?.finishDrawing()) message.info(translate("directorDesk.aPathNeedsAtLeastTwoAnchors")); }}>{translate("directorDesk.done")}</Button><Button size="small" onClick={() => { if (!sceneRef.current?.finishDrawing(true)) message.info(translate("directorDesk.aClosedPathNeedsAtLeastThreeAnchors")); }}>{translate("directorDesk.closePath_f82f34")}</Button></> : null}</div> : null}
                    </main>
                    <aside className="flex min-h-0 flex-col overflow-hidden border-l px-3 pb-3" style={{ borderColor: theme.node.stroke }}>
                        <h3 className="shrink-0 pt-3 text-xs font-medium">{selectedObject?.name || (editingCameraId ? selectedCamera?.name : translate("directorDesk.properties"))}</h3>
                        <Tabs className="min-h-0 flex-1 [&>.ant-tabs-content-holder]:overflow-y-auto" size="small" activeKey={inspectorTab} onChange={(tab) => { cancelDrawing(); setInspectorTab(tab); }} items={[
                            { key: "properties", label: translate("directorDesk.properties"), children: propertiesPanel },
                            ...(selectedObject?.kind === "character" ? [{ key: "pose", label: translate("directorDesk.pose_94049d"), children: <DirectorDeskPosePanel object={selectedObject} adjustment={poseAdjustment} selectedJoint={selectedJoint} keyframing={poseKeyframing} durationMilliseconds={project.timeline.durationMilliseconds} disabled={editingDisabled}
                                onPreset={applyCharacterAction} onClipsChange={(actionClips) => updateObject(selectedObject.id, (object) => ({ ...object, track: { position: [], rotation: [], ...object.track, actionClips } }))}
                                onAdjustmentChange={writePoseAdjustment} onPreviewAdjustment={setPreviewPose} onSelectJoint={setSelectedJoint} onKeyframingChange={(enabled) => { setPreviewPose(null); setPoseKeyframing(enabled); }} onRecord={() => { writePoseAdjustment(poseAdjustment, true); setPoseKeyframing(true); }}
                                onRemoveKeyframe={() => updateObject(selectedObject.id, (object) => ({ ...object, track: { position: [], rotation: [], ...object.track, pose: (object.track?.pose || []).filter((keyframe) => Math.round(keyframe.timeMilliseconds * 30 / 1000) !== currentFrame) } }))} /> }] : []),
                            { key: "trajectory", label: translate("directorDesk.motionPath"), children: selectedObject || editingCameraId ? pathPanel : null },
                        ]} />
                        {inspectorTab === "properties" && selectedObject && selectedObject.kind !== "ground" ? <div className="shrink-0 border-t pt-3" style={{ borderColor: theme.node.stroke }}><Button block size="small" danger icon={<Trash2 className="size-3.5" />} disabled={editingDisabled || assetUploading} onClick={() => confirmRemoveObject(selectedObject.id)}>{translate("directorDesk.deleteCurrentObject")}</Button></div> : null}
                    </aside>
                </div>
                <DirectorDeskTimeline project={project} timeMilliseconds={timeMilliseconds} playing={playing} loop={loop} disabled={videoExporting} selectedId={editingCameraId || selectedObjectId} selectedPathId={selectedMotionPath?.id}
                    onEditingStart={startTimelineEditing} onSegmentChange={editTimelineSegment}
                    onSeek={seekPreview} onPlayingChange={changePlaying} onLoopChange={setLoop} onDurationChange={changeDuration} onSelect={(id, camera, pathId) => { if (camera) selectCamera(id); else selectObject(id); if (pathId) { setSelectedMotionPathId(pathId); setInspectorTab("trajectory"); setViewMode("director"); } }} />
            </div>
        </Modal>
    );
}


/** 更新同帧关键帧并维持时间顺序。 */
function upsertVectorKeyframe(keyframes: CanvasDirectorDeskKeyframe<CanvasDirectorDeskVector3>[], keyframe: CanvasDirectorDeskKeyframe<CanvasDirectorDeskVector3>): CanvasDirectorDeskKeyframe<CanvasDirectorDeskVector3>[] {
    return [...keyframes.filter((item) => item.timeMilliseconds !== keyframe.timeMilliseconds), keyframe].sort((first, second) => first.timeMilliseconds - second.timeMilliseconds);
}

/** 临时预览和最终提交使用相同姿势编辑规则，连续拖动不写入工程。 */
function applyPoseAdjustment(object: CanvasDirectorDeskObject, pose: CanvasDirectorDeskPose, timeMilliseconds: number, keyframing: boolean): CanvasDirectorDeskObject {
    if (!keyframing) return { ...object, pose: structuredClone(pose) };
    return { ...object, track: { position: [], rotation: [], ...object.track, pose: [...(object.track?.pose || []).filter((keyframe) => keyframe.timeMilliseconds !== timeMilliseconds), { id: object.id + "-pose-" + timeMilliseconds, timeMilliseconds, value: structuredClone(pose) }].sort((first, second) => first.timeMilliseconds - second.timeMilliseconds) } };
}
