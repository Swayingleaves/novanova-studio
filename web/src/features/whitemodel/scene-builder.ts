import * as THREE from "three";
import { encodeDirectorDeskVideo } from "@/app/(user)/canvas/director-desk/director-desk-video-export";
import { uploadMediaFile, type UploadedFile } from "@/features/storage/services/file-storage";
import {
    ASPECT_EXPORT_SIZE,
    lerp,
    makeRand,
    solveAt,
    subjectAt,
    type SolvedCamera,
    type Vec3,
    type WhitemodelProp,
    type WhitemodelScene,
    type WhitemodelSubject,
} from "./solver";

/** 语义配色：白模只保留明暗与主体身份色，主角用唯一饱和红，第二主体用蓝色。 */
const PALETTE: Record<string, number> = {
    hero: 0xc0392b,
    second: 0x2c6fbb,
    crowd: 0xb9b9bf,
    env: 0xdedede,
    dark: 0x6a6a70,
    ground: 0x8a8a8a,
};

function toColor(value: string | number | undefined, fallback: number): number {
    if (value === undefined || value === null) return fallback;
    if (typeof value === "number") return value;
    const parsed = Number.parseInt(String(value).replace(/^#|^0x/i, ""), 16);
    return Number.isNaN(parsed) ? fallback : parsed;
}

export type WhitemodelRuntime = {
    renderer: THREE.WebGLRenderer;
    renderAt: (timeSeconds: number) => SolvedCamera;
    resize: (width: number, height: number) => void;
    dispose: () => void;
};

/**
 * 构建与 seedance-skill/engine/renderer.html 一致的 Three.js 3D 白模渲染运行时。
 * 保证实时预览与离屏编码导出的每一帧都为时间的确定性纯函数。
 */
export function createWhitemodelRuntime(
    canvas: HTMLCanvasElement,
    sceneSpec: WhitemodelScene,
    width: number,
    height: number,
): WhitemodelRuntime {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    const bg = new THREE.Color(toColor(sceneSpec.world?.background, 0x1a1c20));
    scene.background = bg;
    if (sceneSpec.world?.fog && sceneSpec.world.fog.length >= 2) {
        scene.fog = new THREE.Fog(bg, sceneSpec.world.fog[0], sceneSpec.world.fog[1]);
    }

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 600);

    const materials: Record<string, THREE.MeshStandardMaterial> = {};
    for (const [key, color] of Object.entries(PALETTE)) {
        materials[key] = new THREE.MeshStandardMaterial({
            color,
            roughness: key === "ground" ? 1 : 0.82,
            metalness: 0,
        });
    }
    const matOf = (name?: string) => materials[name || "env"] ?? materials.env;
    const geometries: THREE.BufferGeometry[] = [];
    const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
        geometries.push(g);
        return g;
    };

    const rand = makeRand(sceneSpec.meta?.seed ?? 20260817);

    // 人形：胶囊躯干 + 球头 + 前胸标与鼻子朝向标记（便于区分正反面）
    const makeHuman = (spec: { height?: number; color?: string; skirt?: number }) => {
        const h = spec.height ?? 1.75;
        const group = new THREE.Group();
        const mat = matOf(spec.color ?? "crowd");

        const body = new THREE.Mesh(trackGeo(new THREE.CapsuleGeometry(h * 0.11, h * 0.52, 6, 14)), mat);
        body.position.y = h * 0.47;
        body.castShadow = true;
        group.add(body);

        const head = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(h * 0.095, 16, 12)), mat);
        head.position.y = h * 0.92;
        head.castShadow = true;
        group.add(head);

        const nose = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(h * 0.035, h * 0.1, 8)), mat);
        nose.rotation.x = Math.PI / 2;
        nose.position.set(0, h * 0.92, h * 0.11);
        group.add(nose);

        const chest = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(h * 0.16, h * 0.16, h * 0.02)), mat);
        chest.position.set(0, h * 0.6, h * 0.11);
        group.add(chest);

        if (spec.skirt) {
            const skirt = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(spec.skirt, h * 0.3, 24)), mat);
            skirt.position.y = h * 0.28;
            skirt.rotation.x = Math.PI;
            group.add(skirt);
        }
        return group;
    };

    const makeMesh = (spec: WhitemodelProp | WhitemodelSubject): THREE.Group => {
        const shape = spec.shape ?? "box";
        if (shape === "human") return makeHuman(spec);
        const s = spec.size ?? [1, 1, 1];
        let geo: THREE.BufferGeometry;
        switch (shape) {
            case "cone":
                geo = trackGeo(new THREE.ConeGeometry(spec.r ?? 1, spec.h ?? 3, 24));
                break;
            case "cylinder":
                geo = trackGeo(new THREE.CylinderGeometry(spec.r ?? 0.4, spec.r2 ?? spec.r ?? 0.4, spec.h ?? 2, 20));
                break;
            case "sphere":
                geo = trackGeo(new THREE.SphereGeometry(spec.r ?? 1, 20, 14));
                break;
            case "torus":
                geo = trackGeo(new THREE.TorusGeometry(spec.r ?? 3, spec.tube ?? 0.3, 12, 40));
                break;
            case "plane":
                geo = trackGeo(new THREE.PlaneGeometry(s[0], s[1]));
                break;
            case "box":
            default:
                geo = trackGeo(new THREE.BoxGeometry(s[0], s[1], s[2]));
                break;
        }
        const mesh = new THREE.Mesh(geo, matOf(spec.color ?? "env"));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (shape === "cone" || shape === "cylinder") mesh.position.y = (spec.h ?? 2) / 2;
        if (shape === "box") mesh.position.y = s[1] / 2;
        if (shape === "sphere") mesh.position.y = spec.r ?? 1;
        if (shape === "torus") {
            mesh.rotation.x = -Math.PI / 2;
            mesh.position.y = ("y" in spec && spec.y !== undefined ? spec.y : undefined) ?? (spec.tube ?? 0.3);
        }
        if (shape === "plane") mesh.rotation.x = -Math.PI / 2;
        const wrap = new THREE.Group();
        wrap.add(mesh);
        return wrap;
    };

    const placements = (spec: WhitemodelProp): { pos: Vec3; rot: number }[] => {
        const layout = spec.layout;
        const base: Vec3 = spec.pos ?? [0, 0, 0];
        if (!layout || !layout.count) return [{ pos: base, rot: spec.rotY ?? 0 }];
        const out: { pos: Vec3; rot: number }[] = [];
        const jitter = layout.jitter ?? 0;
        const jt = () => (rand() - 0.5) * 2 * jitter;
        for (let i = 0; i < layout.count; i++) {
            if (layout.type === "ring") {
                const fromDeg = typeof layout.from === "number" ? layout.from : 0;
                const toDeg = typeof layout.to === "number" ? layout.to : 360;
                const a = ((fromDeg + (toDeg - fromDeg) * (i / layout.count)) * Math.PI) / 180;
                const r = (layout.radius ?? 5) + jt();
                out.push({ pos: [base[0] + Math.cos(a) * r, base[1], base[2] + Math.sin(a) * r], rot: -a + Math.PI / 2 });
            } else if (layout.type === "grid") {
                const cols = layout.cols ?? Math.ceil(Math.sqrt(layout.count));
                const sp = layout.spacing ?? [2, 2];
                const x = (i % cols) - (cols - 1) / 2;
                const z = Math.floor(i / cols) - (Math.ceil(layout.count / cols) - 1) / 2;
                out.push({ pos: [base[0] + x * sp[0] + jt(), base[1], base[2] + z * sp[1] + jt()], rot: layout.rotY ?? 0 });
            } else if (layout.type === "line" && Array.isArray(layout.from) && Array.isArray(layout.to)) {
                const t = layout.count === 1 ? 0 : i / (layout.count - 1);
                out.push({
                    pos: [lerp(layout.from[0], layout.to[0], t) + jt(), lerp(layout.from[1], layout.to[1], t), lerp(layout.from[2], layout.to[2], t) + jt()],
                    rot: layout.rotY ?? 0,
                });
            } else if (layout.type === "scatter") {
                const area = layout.area ?? [30, 30];
                let x = (rand() - 0.5) * area[0];
                const z = (rand() - 0.5) * area[1];
                if (layout.corridor) {
                    const side = rand() > 0.5 ? 1 : -1;
                    x = side * (layout.corridor + rand() * Math.max(0.5, area[0] / 2 - layout.corridor));
                }
                out.push({ pos: [base[0] + x, base[1], base[2] + z], rot: rand() * Math.PI * 2 });
            }
        }
        return out;
    };

    // 地面
    const groundCfg = sceneSpec.world?.ground ?? { type: "plane", size: 400 };
    if (groundCfg.type !== "none") {
        const groundGeo =
            groundCfg.type === "disc"
                ? trackGeo(new THREE.CircleGeometry(groundCfg.size ?? 20, 64))
                : trackGeo(new THREE.PlaneGeometry(groundCfg.size ?? 400, groundCfg.size ?? 400));
        const groundMesh = new THREE.Mesh(groundGeo, matOf(groundCfg.color ?? "ground"));
        groundMesh.rotation.x = -Math.PI / 2;
        groundMesh.position.y = groundCfg.y ?? 0;
        groundMesh.receiveShadow = true;
        scene.add(groundMesh);
    }

    // 静态道具
    for (const spec of sceneSpec.world?.props ?? []) {
        for (const pl of placements(spec)) {
            const obj = makeMesh(spec);
            obj.position.set(pl.pos[0], pl.pos[1], pl.pos[2]);
            obj.rotation.y = spec.rotY !== undefined ? (spec.rotY * Math.PI) / 180 : pl.rot;
            scene.add(obj);
        }
    }

    // 动态主体
    const subjectObjects: Record<string, THREE.Group> = {};
    for (const s of sceneSpec.subjects ?? []) {
        const obj = !s.shape || s.shape === "human" ? makeHuman(s) : makeMesh(s);
        scene.add(obj);
        subjectObjects[s.id] = obj;
    }

    // 灯光：单一方向主光（阴影交代空间）+ 半球环境光（避免底面死黑）
    const lightCfg = sceneSpec.world?.light ?? {};
    const keyLight = new THREE.DirectionalLight(0xffffff, lightCfg.intensity ?? 2.4);
    const lightPos = lightCfg.pos ?? [-14, 26, 10];
    keyLight.position.set(lightPos[0], lightPos[1], lightPos[2]);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    const range = lightCfg.shadowRange ?? 45;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = range * 3;
    keyLight.shadow.camera.left = -range;
    keyLight.shadow.camera.right = range;
    keyLight.shadow.camera.top = range;
    keyLight.shadow.camera.bottom = -range;
    scene.add(keyLight);
    scene.add(new THREE.HemisphereLight(0xffffff, toColor(lightCfg.groundColor, 0x6e6e78), lightCfg.ambient ?? 0.9));

    const duration = sceneSpec.meta?.duration ?? 5;

    const renderAt = (timeRaw: number): SolvedCamera => {
        const time = Math.max(0, Math.min(duration, timeRaw));
        for (const s of sceneSpec.subjects ?? []) {
            const st = subjectAt(sceneSpec, s.id, time);
            const obj = subjectObjects[s.id];
            if (st && obj) {
                obj.position.set(st.foot[0], st.foot[1], st.foot[2]);
                obj.rotation.y = st.yaw;
            }
        }
        const cam = solveAt(sceneSpec, time);
        camera.fov = cam.fovY;
        camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
        const ang = ((cam.spin ?? 0) + (cam.roll ?? 0)) * (Math.PI / 180);
        if (Math.abs(cam.pos[0] - cam.aim[0]) < 1e-4 && Math.abs(cam.pos[2] - cam.aim[2]) < 1e-4) {
            camera.up.set(Math.sin(ang), 0, -Math.cos(ang));
        } else {
            camera.up.set(Math.sin(ang), Math.cos(ang), 0);
        }
        camera.lookAt(cam.aim[0], cam.aim[1], cam.aim[2]);
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);
        return cam;
    };

    return {
        renderer,
        renderAt,
        resize: (w: number, h: number) => {
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h, false);
        },
        dispose: () => {
            geometries.forEach((g) => g.dispose());
            Object.values(materials).forEach((m) => m.dispose());
            renderer.dispose();
        },
    };
}

/**
 * 离屏逐帧渲染 3D 白模并编码为 H.264 MP4 Blob（不上传，供本地下载或继续上传）。
 */
export async function exportWhitemodelBlob(
    sceneSpec: WhitemodelScene,
    onProgress: (progress: number) => void,
    aspectOverride?: string,
): Promise<Blob> {
    const aspect = aspectOverride || sceneSpec.meta?.aspect || "16:9";
    const [width, height] = ASPECT_EXPORT_SIZE[aspect] ?? [1280, 720];
    const durationSeconds = Math.max(1, Math.min(60, sceneSpec.meta?.duration ?? 5));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const runtime = createWhitemodelRuntime(canvas, sceneSpec, width, height);
    try {
        // 先预渲染首帧完成着色器编译，避免首帧黑屏或未结算
        runtime.renderAt(0);
        return await encodeDirectorDeskVideo({
            canvas,
            durationMilliseconds: Math.round(durationSeconds * 1000),
            renderFrame: async (timeMilliseconds) => {
                runtime.renderAt(timeMilliseconds / 1000);
            },
            onProgress,
        });
    } finally {
        runtime.dispose();
    }
}

/**
 * 离屏逐帧渲染 3D 白模并编码为 H.264 MP4，上传至对象存储后返回可直接用于参考视频的 UploadedFile。
 */
export async function exportAndUploadWhitemodelVideo(
    sceneSpec: WhitemodelScene,
    onProgress: (stage: "encoding" | "uploading", progress: number) => void,
    aspectOverride?: string,
): Promise<UploadedFile> {
    const blob = await exportWhitemodelBlob(sceneSpec, (progress) => onProgress("encoding", progress), aspectOverride);
    onProgress("uploading", 100);
    const file = new File([blob], `whitemodel-${Date.now()}.mp4`, { type: "video/mp4" });
    return await uploadMediaFile(file);
}
