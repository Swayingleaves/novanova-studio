"use client";
import { translateMessage as translate } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";


import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Plus } from "lucide-react";
import * as Three from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

import { getMediaBlob } from "@/features/storage/services/file-storage";
import { getImageBlob } from "@/features/storage/services/image-storage";
import { useCanvasTheme } from "@/features/canvas/components/canvas-theme-provider";
import type { CanvasDirectorDeskAsset, CanvasDirectorDeskCamera, CanvasDirectorDeskJoint, CanvasDirectorDeskMotionPath, CanvasDirectorDeskObject, CanvasDirectorDeskPose, CanvasDirectorDeskProject, CanvasDirectorDeskTransform, CanvasDirectorDeskVector3 } from "@/features/canvas/types";
import { DirectorDeskPathEditor, type PathEditorSettings } from "./director-desk-path-editor";
import { DIRECTOR_DESK_JOINTS, evaluateCharacterAction } from "./director-desk-pose";
import { evaluateDirectorDeskProject } from "./director-desk-evaluator";
import { encodeDirectorDeskVideo } from "./director-desk-video-export";

export type DirectorDeskTransformMode = "translate" | "rotate" | "scale";
export type DirectorDeskSceneHandle = {
    capturePng: (width: number, height: number) => Promise<Blob>;
    captureVideo: (project: CanvasDirectorDeskProject, width: number, height: number, onProgress: (progress: number) => void) => Promise<Blob>;
    finishDrawing: (closed?: boolean) => boolean;
    cancelDrawing: () => void;
};

type SceneProps = {
    objects: CanvasDirectorDeskObject[];
    camera: CanvasDirectorDeskCamera | undefined;
    cameras: CanvasDirectorDeskCamera[];
    assets: CanvasDirectorDeskAsset[];
    backgroundAssetId?: string;
    selectedObjectId: string | null;
    selectedCameraId: string | null;
    transformMode: DirectorDeskTransformMode;
    viewMode: "director" | "camera";
    pathSettings: PathEditorSettings;
    poseEditing: boolean;
    selectedJoint: CanvasDirectorDeskJoint;
    disabled: boolean;
    onSelectObject: (objectId: string) => void;
    onSelectCamera: (cameraId: string) => void;
    onTransformObject: (objectId: string, transform: CanvasDirectorDeskTransform) => void;
    onCameraChange: (cameraId: string, value: Pick<CanvasDirectorDeskCamera, "position" | "target">) => void;
    onPathChange: (path: CanvasDirectorDeskMotionPath) => void;
    onSelectAnchor: (index: number) => void;
    onCancelDrawing: () => void;
    onSelectJoint: (joint: CanvasDirectorDeskJoint) => void;
    onJointRotate: (joint: CanvasDirectorDeskJoint, delta: CanvasDirectorDeskVector3) => void;
    onReadyChange: (ready: boolean) => void;
    onAssetError: (message: string) => void;
};

type CharacterRig = {
    model: Three.Group;
    bones: Partial<Record<CanvasDirectorDeskJoint, Three.Bone>>;
    rest: Map<Three.Bone, Three.Quaternion>;
};

type SceneRuntime = {
    renderer: Three.WebGLRenderer;
    scene: Three.Scene;
    camera: Three.PerspectiveCamera;
    orbit: OrbitControls;
    gizmo: TransformControls;
    roots: Map<string, Three.Object3D>;
    templates: Map<string, Promise<Three.Group>>;
    cameraRoots: Map<string, Three.Object3D>;
    helpers: Three.Group;
    jointMarkers: Three.Group;
    grid: Three.GridHelper;
    pathEditor: DirectorDeskPathEditor;
    assets: CanvasDirectorDeskAsset[];
    directorPosition: Three.Vector3;
    directorTarget: Three.Vector3;
    backgroundKey?: string;
    backgroundTexture?: Three.Texture;
    backgroundRequest: number;
    backgroundSource?: string;
    backgroundLoading?: Promise<void>;
    width: number;
    height: number;
    version: number;
    disposed: boolean;
    showHelpers: boolean;
    exporting: boolean;
    listeners: AbortController;
};

/** 本地人体的固定骨骼映射，不尝试猜测任意外部模型的骨架。 */
const CHARACTER_BONES: Record<CanvasDirectorDeskJoint, string> = {
    body: "pelvis", spine: "spine_01", neck: "neck_01", head: "Head",
    leftShoulder: "upperarm_l", rightShoulder: "upperarm_r", leftElbow: "lowerarm_l", rightElbow: "lowerarm_r",
    leftWrist: "hand_l", rightWrist: "hand_r", leftHip: "thigh_l", rightHip: "thigh_r",
    leftKnee: "calf_l", rightKnee: "calf_r", leftAnkle: "foot_l", rightAnkle: "foot_r",
};

const JOINT_CONNECTIONS: Array<[CanvasDirectorDeskJoint, CanvasDirectorDeskJoint]> = [
    ["body", "spine"], ["spine", "neck"], ["neck", "head"],
    ["neck", "leftShoulder"], ["leftShoulder", "leftElbow"], ["leftElbow", "leftWrist"],
    ["neck", "rightShoulder"], ["rightShoulder", "rightElbow"], ["rightElbow", "rightWrist"],
    ["body", "leftHip"], ["leftHip", "leftKnee"], ["leftKnee", "leftAnkle"],
    ["body", "rightHip"], ["rightHip", "rightKnee"], ["rightKnee", "rightAnkle"],
];

/** 三维视口复用场景对象，播放只更新变换和骨骼；辅助控件与导出隔离。 */
export const DirectorDeskScene = forwardRef<DirectorDeskSceneHandle, SceneProps>(function DirectorDeskScene(props, ref) {
    const translate = useTranslation();
    const theme = useCanvasTheme();
    const viewportRef = useRef<HTMLDivElement>(null);
    const runtimeRef = useRef<SceneRuntime | null>(null);
    const latest = useRef(props);
    latest.current = props;
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
    const [errorMessage, setErrorMessage] = useState("");
    const [retry, setRetry] = useState(0);
    const colorsRef = useRef({ background: theme.directorDesk.background, grid: theme.directorDesk.grid, accent: theme.node.activeStroke, text: theme.node.text });
    colorsRef.current = { background: theme.directorDesk.background, grid: theme.directorDesk.grid, accent: theme.node.activeStroke, text: theme.node.text };

    useImperativeHandle(ref, () => ({
        finishDrawing: (closed = false) => runtimeRef.current?.pathEditor.finish(closed) || false,
        cancelDrawing: () => runtimeRef.current?.pathEditor.cancel(),
        capturePng: (width, height) => capture(latest.current.objects, latest.current.camera, width, height),
        captureVideo: (project, width, height, onProgress) => withExportViewport(width, height, (runtime) => encodeDirectorDeskVideo({
            canvas: runtime.renderer.domElement, durationMilliseconds: project.timeline.durationMilliseconds, onProgress,
            renderFrame: async (time) => {
                if (runtime.disposed) throw new Error(translate("directorDesk.directorViewportClosedVideoExportStopped"));
                const frame = evaluateDirectorDeskProject(project, time);
                const complete = await synchronize(runtime, { ...latest.current, objects: frame.objects, camera: frame.camera, cameras: frame.cameras }, colorsRef.current, false);
                if (!complete || runtime.disposed) throw new Error(translate("directorDesk.directorRenderingInterruptedExportStopped"));
            },
        })),
    }));

    /** 导出使用拍摄机位，结束后恢复导演视角及编辑辅助物体。 */
    async function capture(objects: CanvasDirectorDeskObject[], camera: CanvasDirectorDeskCamera | undefined, width: number, height: number): Promise<Blob> {
        if (!camera) throw new Error(translate("directorDesk.directorCameraNotFound"));
        return withExportViewport(width, height, async (runtime) => {
            const complete = await synchronize(runtime, { ...latest.current, objects, camera }, colorsRef.current, false);
            if (!complete || runtime.disposed) throw new Error(translate("directorDesk.directorCaptureInterrupted"));
            return new Promise<Blob>((resolve, reject) => runtime.renderer.domElement.toBlob((blob) => blob ? resolve(blob) : reject(new Error(translate("directorDesk.directorPNGExportFailed"))), "image/png"));
        });
    }

    /** 整次视频导出只切换一次渲染尺寸和机位，结束后统一恢复预览。 */
    async function withExportViewport<Result>(width: number, height: number, operation: (runtime: SceneRuntime) => Promise<Result>): Promise<Result> {
        const runtime = runtimeRef.current;
        if (!runtime || runtime.disposed || runtime.exporting) throw new Error(translate("directorDesk.directorViewportIsNotReadyOrExporting"));
        runtime.exporting = true;
        const previous = { width: runtime.width, height: runtime.height, ratio: runtime.renderer.getPixelRatio() };
        try {
            runtime.renderer.setPixelRatio(1);
            resize(runtime, width, height);
            return await operation(runtime);
        } finally {
            try {
                if (!runtime.disposed) {
                    runtime.renderer.setPixelRatio(previous.ratio);
                    resize(runtime, previous.width, previous.height);
                    await synchronize(runtime, latest.current, colorsRef.current, true);
                }
            }
            finally { runtime.exporting = false; }
        }
    }

    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        // effect 在严格模式和热更新中会重新执行，不能复用已主动丢失上下文的画布。
        const canvas = viewport.ownerDocument.createElement("canvas");
        canvas.tabIndex = 0;
        canvas.className = "block size-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-action)]";
        canvas.setAttribute("aria-label", translate("directorDesk.director3DPreviewAndPathEditing"));
        viewport.appendChild(canvas);
        let runtime: SceneRuntime | null = null;
        let initializedRenderer: Three.WebGLRenderer | null = null;
        let initializedOrbit: OrbitControls | null = null;
        let initializedGizmo: TransformControls | null = null;
        let initializedPathEditor: DirectorDeskPathEditor | null = null;
        let observer: ResizeObserver | null = null;
        let stopped = false;
        setStatus("loading");
        props.onReadyChange(false);
        try {
            const renderer = new Three.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
            initializedRenderer = renderer;
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            renderer.outputColorSpace = Three.SRGBColorSpace;
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = Three.PCFSoftShadowMap;
            const scene = new Three.Scene();
            const camera = new Three.PerspectiveCamera(42, 1, 0.01, 1000);
            camera.position.set(5, 4, 7);
            const orbit = new OrbitControls(camera, canvas);
            initializedOrbit = orbit;
            orbit.target.set(0, 0.9, 0);
            orbit.update();
            const gizmo = new TransformControls(camera, canvas);
            initializedGizmo = gizmo;
            scene.add(gizmo.getHelper());
            const helpers = new Three.Group();
            const jointMarkers = new Three.Group();
            helpers.add(jointMarkers);
            const grid = new Three.GridHelper(40, 40);
            // 只使用材质主题色，避免顶点色叠乘后将暗色网格再次压暗。
            const gridMaterial = grid.material as Three.LineBasicMaterial;
            gridMaterial.vertexColors = false;
            gridMaterial.color.set(colorsRef.current.grid);
            grid.position.y = 0.001;
            // 地面网格属于场景内容，在机位预览及图片、视频导出中始终保留。
            scene.add(grid, helpers);
            const key = new Three.DirectionalLight(0xffffff, 2.5);
            key.position.set(4, 8, 5);
            key.castShadow = true;
            scene.add(key, new Three.HemisphereLight(0xd5e8ff, 0x263242, 2));
            const listeners = new AbortController();
            const pathEditor = new DirectorDeskPathEditor(canvas, camera, latest.current.pathSettings,
                () => { if (runtime && !runtime.disposed) renderer.render(scene, camera); },
                (enabled) => { orbit.enabled = enabled && latest.current.viewMode === "director" && !latest.current.disabled; },
                (path) => latest.current.onPathChange(path),
                (index) => latest.current.onSelectAnchor(index),
                () => latest.current.onCancelDrawing());
            initializedPathEditor = pathEditor;
            helpers.add(pathEditor.group);
            runtime = { renderer, scene, camera, orbit, gizmo, roots: new Map(), templates: new Map(), cameraRoots: new Map(), helpers, jointMarkers, grid, pathEditor, assets: [], directorPosition: camera.position.clone(), directorTarget: orbit.target.clone(), backgroundRequest: 0, width: 1, height: 1, version: 0, disposed: false, showHelpers: true, exporting: false, listeners };
            runtimeRef.current = runtime;
            bindInteractions(runtime, canvas, latest);
            observer = new ResizeObserver(() => {
                if (!runtime || runtime.disposed || runtime.exporting) return;
                resize(runtime, Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight));
                runtime.renderer.render(runtime.scene, runtime.camera);
            });
            observer.observe(canvas);
            resize(runtime, Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight));
            void synchronize(runtime, latest.current, colorsRef.current, true).then((complete) => {
                if (!stopped && complete) { setStatus("ready"); latest.current.onReadyChange(true); }
            }).catch((error) => report(error));
        } catch (error) {
            observer?.disconnect();
            releaseScene();
            canvas.remove();
            report(error);
        }

        /** 初始化中途失败时同样释放已创建的控件和渲染器，清理只作用于本次 effect。 */
        function releaseScene(): void {
            if (runtime) {
                const disposedRuntime = runtime;
                runtime = null;
                if (runtimeRef.current === disposedRuntime) runtimeRef.current = null;
                disposeRuntime(disposedRuntime);
            } else {
                initializedPathEditor?.dispose();
                initializedOrbit?.dispose();
                initializedGizmo?.dispose();
                initializedRenderer?.dispose();
                initializedRenderer?.forceContextLoss();
            }
            initializedPathEditor = null;
            initializedOrbit = null;
            initializedGizmo = null;
            initializedRenderer = null;
        }

        /** 加载失败显示可重试错误，不用几何体人偶替代缺失人体。 */
        function report(error: unknown): void {
            if (stopped) return;
            const message = error instanceof Error ? error.message : translate("directorDesk.failedToLoadDirector3DScene");
            console.error("导演台场景加载失败", error);
            setErrorMessage(message);
            setStatus("error");
            latest.current.onReadyChange(false);
            latest.current.onAssetError(message);
        }
        return () => {
            stopped = true;
            observer?.disconnect();
            releaseScene();
            canvas.remove();
            latest.current.onReadyChange(false);
        };
    }, [retry]);

    useEffect(() => {
        const runtime = runtimeRef.current;
        if (!runtime || runtime.exporting) return;
        void synchronize(runtime, props, colorsRef.current, true).then((complete) => { if (complete && !runtime.disposed) { setStatus("ready"); props.onReadyChange(true); } }).catch((error) => {
            if (runtime.disposed) return;
            const message = error instanceof Error ? error.message : translate("directorDesk.failedToUpdateDirectorScene");
            setStatus("error"); setErrorMessage(message); props.onReadyChange(false);
        });
    }, [props.objects, props.camera, props.cameras, props.assets, props.backgroundAssetId, props.selectedObjectId, props.selectedCameraId, props.transformMode, props.viewMode, props.pathSettings, props.poseEditing, props.selectedJoint, props.disabled, theme, retry]);

    return <div className="absolute inset-0">
        <div ref={viewportRef} className="absolute inset-0" />
        {status === "ready" ? <Plus aria-hidden="true" strokeWidth={1} className="pointer-events-none absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 opacity-70" style={{ color: theme.node.text }} /> : null}
        {status !== "ready" ? <div className="absolute inset-0 grid place-items-center p-6 text-center text-xs" style={{ background: theme.node.panel, color: theme.node.text }}>
            <div><p>{status === "loading" ? translate("directorDesk.loadingMannequinAnd3DScene") : errorMessage}</p>{status === "error" ? <button className="mt-3 rounded border px-4 py-2" style={{ borderColor: theme.node.stroke }} onClick={() => setRetry((value) => value + 1)}>{translate("directorDesk.reload")}</button> : null}</div>
        </div> : null}
    </div>;
});

/** 渲染尺寸只在容器变化或逐帧导出时调整。 */
function resize(runtime: SceneRuntime, width: number, height: number): void {
    runtime.width = width; runtime.height = height;
    runtime.renderer.setSize(width, height, false);
    runtime.camera.aspect = width / height;
    runtime.camera.updateProjectionMatrix();
}

/** 对象标识不变时保留模型，异步加载被取消时立即释放产生的实例。 */
async function synchronize(runtime: SceneRuntime, props: SceneProps, colors: { background: string; grid: string; accent: string; text: string }, showHelpers: boolean): Promise<boolean> {
    if (runtime.disposed || !props.camera) return false;
    const version = ++runtime.version;
    runtime.assets = props.assets;
    runtime.showHelpers = showHelpers;
    await synchronizeBackground(runtime, props.backgroundAssetId, colors.background);
    if (runtime.disposed || version !== runtime.version) return false;
    const identifiers = new Set(props.objects.map((object) => object.id));
    for (const [id, root] of runtime.roots) {
        if (!identifiers.has(id)) {
            if (runtime.gizmo.object && (runtime.gizmo.object === root || root.getObjectById(runtime.gizmo.object.id))) runtime.gizmo.detach();
            runtime.scene.remove(root); disposeInstance(root); runtime.roots.delete(id);
        }
    }
    for (const object of props.objects) {
        let root = runtime.roots.get(object.id);
        const identity = object.kind + ":" + (object.assetId || "");
        if (root && root.userData.identity !== identity) { runtime.gizmo.detach(); runtime.scene.remove(root); disposeInstance(root); runtime.roots.delete(object.id); root = undefined; }
        if (!root) {
            const created = await createSceneObject(runtime, object);
            if (runtime.disposed || version !== runtime.version) { disposeInstance(created); return false; }
            root = created; root.userData.identity = identity; runtime.roots.set(object.id, root); runtime.scene.add(root);
        }
        root.name = object.name; root.visible = object.visible;
        root.position.set(object.transform.position.x, object.transform.position.y, object.transform.position.z);
        root.rotation.set(object.transform.rotation.x, object.transform.rotation.y, object.transform.rotation.z);
        root.scale.set(object.transform.scale.x, object.transform.scale.y, object.transform.scale.z);
        if (object.kind === "character") applyCharacterPose(root, object.pose || evaluateCharacterAction("idle", 0));
    }
    if (runtime.disposed || version !== runtime.version) return false;
    synchronizeCameras(runtime, props.cameras, colors.accent);
    if (!showHelpers || props.viewMode === "camera") {
        setCamera(runtime, props.camera);
    } else {
        runtime.camera.position.copy(runtime.directorPosition);
        runtime.camera.fov = 42;
        runtime.orbit.target.copy(runtime.directorTarget);
        runtime.camera.lookAt(runtime.directorTarget);
        runtime.camera.updateProjectionMatrix();
    }
    runtime.orbit.enabled = showHelpers && props.viewMode === "director" && !props.disabled;
    runtime.helpers.visible = showHelpers && props.viewMode === "director";
    runtime.pathEditor.update(showHelpers && props.viewMode === "director" ? props.pathSettings : { ...props.pathSettings, tool: null, editable: false });
    synchronizeSelection(runtime, props, colors.accent);
    const gridMaterial = runtime.grid.material as Three.LineBasicMaterial;
    gridMaterial.color.set(colors.grid);
    runtime.renderer.render(runtime.scene, runtime.camera);
    return true;
}

/** 摄影机视角直接使用统一求值结果，禁止视角操作改变时间轴。 */
function setCamera(runtime: SceneRuntime, source: CanvasDirectorDeskCamera): void {
    runtime.camera.position.set(source.position.x, source.position.y, source.position.z);
    runtime.camera.fov = source.fieldOfView;
    runtime.camera.lookAt(source.target.x, source.target.y, source.target.z);
    runtime.camera.updateProjectionMatrix();
}

/** 缓存本地人体和上传道具模板，实例仅独立克隆骨架。 */
async function loadTemplate(runtime: SceneRuntime, key: string, asset?: CanvasDirectorDeskAsset): Promise<Three.Group> {
    const existing = runtime.templates.get(key);
    if (existing) return existing;
    const promise = (async () => {
        let url = "/models/director-desk/character.gltf";
        let temporaryUrl: string | undefined;
        if (asset) {
            const blob = await getMediaBlob(asset.storageKey);
            if (!blob) throw new Error(translate("directorDesk.cannotReadDirectorGLBResource") + asset.name);
            temporaryUrl = URL.createObjectURL(blob); url = temporaryUrl;
        }
        try {
            const loaded = await new GLTFLoader().loadAsync(url);
            if (!asset) {
                const materials = new Set<Three.Material>();
                loaded.scene.traverse((child) => {
                    if (child instanceof Three.Mesh) {
                        for (const material of Array.isArray(child.material) ? child.material : [child.material]) materials.add(material);
                        child.material = new Three.MeshStandardMaterial({ color: 0x4384d6, roughness: 0.68, metalness: 0.05 });
                    }
                });
                materials.forEach(disposeMaterial);
            }
            if (runtime.disposed) { disposeTree(loaded.scene); throw new Error(translate("directorDesk.directorSceneClosed")); }
            return loaded.scene;
        } finally { if (temporaryUrl) URL.revokeObjectURL(temporaryUrl); }
    })();
    runtime.templates.set(key, promise);
    return promise;
}

/** 建立具有独立骨骼状态的角色或普通场景对象。 */
async function createSceneObject(runtime: SceneRuntime, object: CanvasDirectorDeskObject): Promise<Three.Object3D> {
    let root: Three.Object3D;
    if (object.kind === "character" || object.kind === "glb") {
        const asset = object.kind === "glb" ? runtime.assets.find((item) => item.id === object.assetId && item.kind === "glb") : undefined;
        if (object.kind === "glb" && !asset) throw new Error(translate("directorDesk.directorPropHasNoGLBResource"));
        const template = await loadTemplate(runtime, asset?.storageKey || "builtin-character", asset);
        const model = cloneSkeleton(template) as Three.Group;
        root = new Three.Group(); root.add(model); root.userData.sharedModel = true;
        if (object.kind === "character") {
            const bounds = new Three.Box3().setFromObject(model);
            const height = bounds.max.y - bounds.min.y;
            if (height <= 0) { disposeInstance(root); throw new Error(translate("directorDesk.invalidMannequinDimensions")); }
            model.scale.multiplyScalar(1.8 / height);
            bounds.setFromObject(model); model.position.y -= bounds.min.y;
            const bones: CharacterRig["bones"] = {};
            const rest = new Map<Three.Bone, Three.Quaternion>();
            model.traverse((child) => { if (child instanceof Three.Bone) rest.set(child, child.quaternion.clone()); });
            for (const [joint, name] of Object.entries(CHARACTER_BONES)) {
                const bone = model.getObjectByName(name);
                if (!(bone instanceof Three.Bone)) { disposeInstance(root); throw new Error(translate("directorDesk.missingMannequinJoint") + name); }
                bones[joint as CanvasDirectorDeskJoint] = bone;
            }
            root.userData.rig = { model, bones, rest, basePosition: model.position.clone() };
        }
    } else if (object.kind === "ground") {
        // 地面只保留场景基准，不绘制实体色块；编辑网格由辅助图层显示。
        root = new Three.Group();
    } else {
        const material = new Three.MeshStandardMaterial({ color: object.kind === "sphere" ? 0xf0a43c : 0x4385ad, roughness: 0.75 });
        const geometry = object.kind === "sphere" ? new Three.SphereGeometry(0.55, 24, 16) : new Three.BoxGeometry(1, 1, 1);
        root = new Three.Mesh(geometry, material);
    }
    root.userData.objectId = object.id;
    root.traverse((child) => { if (child instanceof Three.Mesh) { child.castShadow = object.kind !== "ground"; child.receiveShadow = true; } });
    return root;
}

/** 相对绑定姿势应用角度，身体重心只影响模型，不改变路径原点。 */
function applyCharacterPose(root: Three.Object3D, pose: CanvasDirectorDeskPose): void {
    const rig = root.userData.rig as CharacterRig & { basePosition: Three.Vector3 };
    rig.model.position.copy(rig.basePosition).add(new Three.Vector3(pose.rootOffset.x, pose.rootOffset.y, pose.rootOffset.z));
    
    for (const joint of DIRECTOR_DESK_JOINTS) {
        const bone = rig.bones[joint];
        if (!bone) continue;
        const rotation = pose.joints[joint];
        const shoulder = joint.endsWith("Shoulder");
        // 先放下 T 型双臂，再按局部轴前举，避免把前举错误解释为手臂扭转。
        const adjustment = new Three.Euler(shoulder ? -rotation.x : rotation.x, rotation.y, rotation.z, shoulder ? "ZYX" : "XYZ");
        bone.quaternion.copy(rig.rest.get(bone)!).multiply(new Three.Quaternion().setFromEuler(adjustment));
    }
    root.updateMatrixWorld(true);
}

/** 摄像机对象和视锥仅作为导演视图辅助，不进入成片。 */
function synchronizeCameras(runtime: SceneRuntime, cameras: CanvasDirectorDeskCamera[], color: string): void {
    const ids = new Set(cameras.map((camera) => camera.id));
    for (const [id, root] of runtime.cameraRoots) if (!ids.has(id)) { runtime.helpers.remove(root); disposeTree(root); runtime.cameraRoots.delete(id); }
    for (const camera of cameras) {
        let root = runtime.cameraRoots.get(camera.id);
        if (!root) {
            root = new Three.Group();
            const body = new Three.Mesh(new Three.BoxGeometry(0.22, 0.15, 0.16), new Three.MeshBasicMaterial({ color }));
            const coneGeometry = new Three.ConeGeometry(0.4, 0.6, 4, 1, true);
            const cone = new Three.LineSegments(new Three.EdgesGeometry(coneGeometry), new Three.LineBasicMaterial({ color }));
            coneGeometry.dispose();
            cone.rotation.x = -Math.PI / 2; cone.position.z = -0.4;
            root.add(body, cone); root.userData.cameraId = camera.id;
            runtime.cameraRoots.set(camera.id, root); runtime.helpers.add(root);
        }
        root.position.set(camera.position.x, camera.position.y, camera.position.z);
        root.lookAt(camera.target.x, camera.target.y, camera.target.z);
        root.rotateY(Math.PI);
    }
}

/** 关节点与旋转手柄共享真实骨骼引用，实现面板与视口双向编辑。 */
function synchronizeSelection(runtime: SceneRuntime, props: SceneProps, color: string): void {
    const object = props.objects.find((item) => item.id === props.selectedObjectId);
    const root = object ? runtime.roots.get(object.id) : undefined;
    const rig = root?.userData.rig as CharacterRig | undefined;
    if (!props.poseEditing || !rig || !object?.visible) clearGroup(runtime.jointMarkers);
    else {
        if (!runtime.jointMarkers.children.length) for (const joint of DIRECTOR_DESK_JOINTS) {
            const marker = new Three.Mesh(new Three.SphereGeometry(0.045, 12, 8), new Three.MeshBasicMaterial({ color, depthTest: false }));
            marker.userData.joint = joint; marker.renderOrder = 20; runtime.jointMarkers.add(marker);
        }
        for (const marker of runtime.jointMarkers.children) {
            if (!marker.userData.joint) continue;
            const joint = marker.userData.joint as CanvasDirectorDeskJoint;
            rig.bones[joint]!.getWorldPosition(marker.position);
            marker.scale.setScalar(joint === props.selectedJoint ? 1.3 : 1);
            ((marker as Three.Mesh).material as Three.MeshBasicMaterial).color.set(color);
        }
        updateJointConnections(runtime.jointMarkers, rig, color);
    }
    const enabled = runtime.showHelpers && props.viewMode === "director" && !props.disabled && !props.pathSettings.tool;
    let selected: Three.Object3D | undefined;
    if (enabled && object?.visible && !object.locked && root) selected = props.poseEditing && rig ? rig.bones[props.selectedJoint] : root;
    if (enabled && props.selectedCameraId) selected = runtime.cameraRoots.get(props.selectedCameraId);
    if (!selected) { runtime.gizmo.detach(); runtime.gizmo.getHelper().visible = false; return; }
    runtime.gizmo.setMode(props.poseEditing && rig ? "rotate" : props.selectedCameraId ? "translate" : props.transformMode);
    runtime.gizmo.setSpace(props.poseEditing ? "local" : "world");
    if (runtime.gizmo.object !== selected) runtime.gizmo.attach(selected);
    runtime.gizmo.getHelper().visible = true;
}

/** 骨架连线跟随关节世界坐标更新，直观展示头、躯干与四肢的层级关系。 */
function updateJointConnections(group: Three.Group, rig: CharacterRig, color: string): void {
    let lines = group.children.find((child) => child.userData.jointConnections) as Three.LineSegments | undefined;
    if (!lines) {
        const geometry = new Three.BufferGeometry();
        geometry.setAttribute("position", new Three.Float32BufferAttribute(new Float32Array(JOINT_CONNECTIONS.length * 6), 3));
        lines = new Three.LineSegments(geometry, new Three.LineBasicMaterial({ color, transparent: true, opacity: 0.65, depthTest: false }));
        lines.userData.jointConnections = true;
        lines.renderOrder = 19;
        group.add(lines);
    }
    const positions = lines.geometry.getAttribute("position") as Three.BufferAttribute;
    const position = new Three.Vector3();
    JOINT_CONNECTIONS.forEach((connection, index) => connection.forEach((joint, endpoint) => {
        rig.bones[joint]!.getWorldPosition(position);
        positions.setXYZ(index * 2 + endpoint, position.x, position.y, position.z);
    }));
    positions.needsUpdate = true;
    lines.geometry.computeBoundingSphere();
    (lines.material as Three.LineBasicMaterial).color.set(color);
}

/** 编辑手柄完成时提交一次，导演视角导航不写回拍摄机位。 */
function bindInteractions(runtime: SceneRuntime, canvas: HTMLCanvasElement, latest: { current: SceneProps }): void {
    const render = () => { if (!runtime.disposed) runtime.renderer.render(runtime.scene, runtime.camera); };
    runtime.orbit.addEventListener("change", () => {
        if (latest.current.viewMode !== "director") return;
        runtime.directorPosition.copy(runtime.camera.position); runtime.directorTarget.copy(runtime.orbit.target); render();
    });
    runtime.gizmo.addEventListener("change", render);
    runtime.gizmo.addEventListener("objectChange", () => {
        const props = latest.current;
        if (props.poseEditing) {
            const root = props.selectedObjectId ? runtime.roots.get(props.selectedObjectId) : undefined;
            const rig = root?.userData.rig as CharacterRig | undefined;
            root?.updateMatrixWorld(true);
            for (const marker of runtime.jointMarkers.children) if (marker.userData.joint && rig) rig.bones[marker.userData.joint as CanvasDirectorDeskJoint]?.getWorldPosition(marker.position);
            if (rig) updateJointConnections(runtime.jointMarkers, rig, props.pathSettings.color);
        }
        render();
    });
    runtime.gizmo.addEventListener("dragging-changed", (event) => { runtime.orbit.enabled = !event.value && latest.current.viewMode === "director"; });
    let initialRotation: Three.Quaternion | null = null;
    runtime.gizmo.addEventListener("mouseDown", () => { initialRotation = runtime.gizmo.object?.quaternion.clone() || null; });
    runtime.gizmo.addEventListener("mouseUp", () => {
        const selected = runtime.gizmo.object;
        const props = latest.current;
        if (!selected || props.disabled) return;
        if (props.poseEditing && props.selectedObjectId && initialRotation) {
            const object = props.objects.find((item) => item.id === props.selectedObjectId);
            const rig = runtime.roots.get(props.selectedObjectId)?.userData.rig as CharacterRig | undefined;
            const bone = rig?.bones[props.selectedJoint];
            if (!bone || !rig || !object?.pose) return;
            const shoulder = props.selectedJoint.endsWith("Shoulder");
            const angles = new Three.Euler().setFromQuaternion(rig.rest.get(bone)!.clone().invert().multiply(bone.quaternion), shoulder ? "ZYX" : "XYZ");
            const previous = object.pose.joints[props.selectedJoint];
            props.onJointRotate(props.selectedJoint, { x: (shoulder ? -angles.x : angles.x) - previous.x, y: angles.y - previous.y, z: angles.z - previous.z });
        } else if (props.selectedCameraId) {
            const camera = props.cameras.find((item) => item.id === props.selectedCameraId);
            if (camera) props.onCameraChange(camera.id, { position: { x: selected.position.x, y: selected.position.y, z: selected.position.z }, target: camera.target });
        } else if (props.selectedObjectId) props.onTransformObject(props.selectedObjectId, {
            position: { x: selected.position.x, y: selected.position.y, z: selected.position.z },
            rotation: { x: selected.rotation.x, y: selected.rotation.y, z: selected.rotation.z },
            scale: { x: selected.scale.x, y: selected.scale.y, z: selected.scale.z },
        });
        initialRotation = null;
    });
    let start: { x: number; y: number; gizmo: boolean } | null = null;
    canvas.addEventListener("pointercancel", () => { start = null; }, { signal: runtime.listeners.signal });
    canvas.addEventListener("pointerdown", (event) => { start = { x: event.clientX, y: event.clientY, gizmo: runtime.gizmo.axis !== null }; }, { signal: runtime.listeners.signal });
    canvas.addEventListener("pointerup", (event) => {
        const initial = start; start = null;
        if (!initial || initial.gizmo || latest.current.disabled || latest.current.viewMode !== "director" || Math.hypot(event.clientX - initial.x, event.clientY - initial.y) > 4) return;
        const rectangle = canvas.getBoundingClientRect();
        const raycaster = new Three.Raycaster();
        raycaster.setFromCamera(new Three.Vector2((event.clientX - rectangle.left) / rectangle.width * 2 - 1, -(event.clientY - rectangle.top) / rectangle.height * 2 + 1), runtime.camera);
        const targets = [...runtime.jointMarkers.children, ...runtime.cameraRoots.values(), ...runtime.roots.values()];
        const hits = raycaster.intersectObjects(targets, true);
        const jointHit = hits.find((hit) => hit.object.userData.joint);
        if (jointHit && latest.current.poseEditing) { latest.current.onSelectJoint(jointHit.object.userData.joint); return; }
        for (const hit of hits) {
            let node: Three.Object3D | null = hit.object;
            let visible = true;
            for (let current: Three.Object3D | null = node; current; current = current.parent) if (!current.visible) visible = false;
            if (!visible) continue;
            while (node) {
                if (node.userData.joint) { latest.current.onSelectJoint(node.userData.joint); return; }
                if (node.userData.objectId) { latest.current.onSelectObject(node.userData.objectId); return; }
                if (node.userData.cameraId) { latest.current.onSelectCamera(node.userData.cameraId); return; }
                node = node.parent;
            }
        }
    }, { signal: runtime.listeners.signal });
}

/** 背景纹理加载采用请求序号，旧异步结果只释放不回填。 */
async function synchronizeBackground(runtime: SceneRuntime, assetId: string | undefined, color: string): Promise<void> {
    if (runtime.backgroundSource === assetId && runtime.backgroundLoading) return runtime.backgroundLoading;
    if (runtime.backgroundSource === assetId && runtime.backgroundKey === assetId) {
        if (!assetId) runtime.scene.background = new Three.Color(color);
        return;
    }
    const request = ++runtime.backgroundRequest;
    runtime.backgroundSource = assetId;
    if (!assetId) {
        runtime.backgroundTexture?.dispose(); runtime.backgroundTexture = undefined; runtime.backgroundKey = undefined;
        runtime.backgroundLoading = undefined; runtime.scene.background = new Three.Color(color); return;
    }
    const loading = (async () => {
        const asset = runtime.assets.find((item) => item.id === assetId);
        if (!asset) throw new Error(translate("directorDesk.directorBackgroundImageNotFound"));
        const blob = await getImageBlob(asset.storageKey);
        if (!blob) throw new Error(translate("directorDesk.cannotReadDirectorBackgroundImage"));
        const url = URL.createObjectURL(blob);
        try {
            const texture = await new Three.TextureLoader().loadAsync(url);
            if (runtime.disposed || request !== runtime.backgroundRequest) { texture.dispose(); return; }
            texture.colorSpace = Three.SRGBColorSpace;
            runtime.backgroundTexture?.dispose(); runtime.backgroundTexture = texture; runtime.backgroundKey = assetId; runtime.scene.background = texture;
        } finally { URL.revokeObjectURL(url); }
    })();
    runtime.backgroundLoading = loading;
    try { await loading; }
    finally { if (request === runtime.backgroundRequest) runtime.backgroundLoading = undefined; }
}

/** 清空辅助组并释放独占资源。 */
function clearGroup(group: Three.Group): void {
    for (const child of [...group.children]) { group.remove(child); disposeTree(child); }
}

/** 骨骼实例释放自身骨骼纹理，模型几何体与材质由模板统一持有。 */
function disposeInstance(root: Three.Object3D): void {
    if (!root.userData.sharedModel) { disposeTree(root); return; }
    const skeletons = new Set<Three.Skeleton>();
    root.traverse((child) => { if (child instanceof Three.SkinnedMesh) skeletons.add(child.skeleton); });
    skeletons.forEach((skeleton) => skeleton.dispose());
}

/** 去重释放几何体、材质和骨骼，避免共享模型重复释放。 */
function disposeTree(root: Three.Object3D): void {
    const geometries = new Set<Three.BufferGeometry>();
    const materials = new Set<Three.Material>();
    const skeletons = new Set<Three.Skeleton>();
    root.traverse((child) => {
        const mesh = child as Three.Mesh;
        if (mesh.geometry) geometries.add(mesh.geometry);
        if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
        if (child instanceof Three.SkinnedMesh) skeletons.add(child.skeleton);
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach(disposeMaterial);
    skeletons.forEach((skeleton) => skeleton.dispose());
}

/** 纹理随材质生命周期释放。 */
function disposeMaterial(material: Three.Material): void {
    for (const value of Object.values(material)) if (value instanceof Three.Texture) value.dispose();
    material.dispose();
}

/** 关闭视口取消监听、释放所有实例和异步缓存。 */
function disposeRuntime(runtime: SceneRuntime): void {
    runtime.disposed = true; runtime.version += 1; runtime.backgroundRequest += 1;
    runtime.listeners.abort(); runtime.pathEditor.dispose(); runtime.orbit.dispose(); runtime.gizmo.detach(); runtime.gizmo.dispose();
    runtime.roots.forEach(disposeInstance);
    runtime.templates.forEach((promise) => { void promise.then(disposeTree).catch(() => undefined); });
    runtime.helpers.remove(runtime.pathEditor.group); disposeTree(runtime.helpers);
    disposeTree(runtime.grid);
    runtime.backgroundTexture?.dispose();
    runtime.scene.traverse((child) => { if (child instanceof Three.DirectionalLight) child.shadow.dispose(); });
    runtime.renderer.dispose(); runtime.renderer.forceContextLoss();
}
