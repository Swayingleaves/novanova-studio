import * as THREE from "three";
import { encodeDirectorDeskVideo } from "@/app/(user)/canvas/director-desk/director-desk-video-export";
import { uploadMediaFile, type UploadedFile } from "@/features/storage/services/file-storage";
import { samplePoseFrameAt, type CapturedPoseClip, type PoseLandmark } from "./pose-extractor";

export type MannequinStyle = "clay" | "semantic";

export type PoseMannequinRuntime = {
    renderAt: (timeSeconds: number) => void;
    setStyle: (style: MannequinStyle) => void;
    dispose: () => void;
};

/** 四肢骨骼段连接定义（MediaPipe 33 点索引）。 */
const LIMB_SEGMENTS: { a: number; b: number; radiusScale: number }[] = [
    // 左臂 / 右臂
    { a: 11, b: 13, radiusScale: 0.22 },
    { a: 13, b: 15, radiusScale: 0.18 },
    { a: 12, b: 14, radiusScale: 0.22 },
    { a: 14, b: 16, radiusScale: 0.18 },
    // 手掌
    { a: 15, b: 19, radiusScale: 0.14 },
    { a: 16, b: 20, radiusScale: 0.14 },
    // 左腿 / 右腿
    { a: 23, b: 25, radiusScale: 0.28 },
    { a: 25, b: 27, radiusScale: 0.22 },
    { a: 24, b: 26, radiusScale: 0.28 },
    { a: 26, b: 28, radiusScale: 0.22 },
    // 脚掌
    { a: 27, b: 31, radiusScale: 0.17 },
    { a: 28, b: 32, radiusScale: 0.17 },
    // 锁骨与骨盆横杆
    { a: 11, b: 12, radiusScale: 0.24 },
    { a: 23, b: 24, radiusScale: 0.26 },
];

/** 需要绘制球形关节的点位（肩、肘、腕、髋、膝、踝）。 */
const JOINT_INDICES = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

const UP_VEC = new THREE.Vector3(0, 1, 0);

type PersonRig = {
    group: THREE.Group;
    head: THREE.Mesh;
    nose: THREE.Mesh;
    neck: THREE.Mesh;
    torso: THREE.Mesh;
    pelvis: THREE.Mesh;
    limbs: THREE.Mesh[];
    joints: THREE.Mesh[];
    material: THREE.MeshStandardMaterial;
    jointMaterial: THREE.MeshStandardMaterial;
};

function paletteFor(style: MannequinStyle, personIndex: number): { main: number; joint: number } {
    if (style === "semantic") {
        if (personIndex === 0) return { main: 0xd9483b, joint: 0xb03227 };
        if (personIndex === 1) return { main: 0x3b7dd8, joint: 0x265ca8 };
        return { main: 0xc8cbd2, joint: 0x9ea3ad };
    }
    // 纯白粘土风格：主角高明度白模，其余人物微降明度以区分前后遮挡
    if (personIndex === 0) return { main: 0xe6e8ec, joint: 0xcfd3da };
    if (personIndex === 1) return { main: 0xc2c6ce, joint: 0xa6abb5 };
    return { main: 0xa8adb8, joint: 0x8e94a0 };
}

/** 将一根圆柱网格两端精确对齐到世界坐标点 a 与 b。 */
function placeSegment(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, radius: number) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 1e-4) {
        mesh.visible = false;
        return;
    }
    mesh.visible = true;
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(UP_VEC, dir.normalize());
    mesh.scale.set(radius, len, radius);
}

/**
 * 构建 3D 关节白模人偶渲染运行时（与原视频画面 1:1 逐帧位置、画幅与动作对齐）。
 */
export function createPoseMannequinRuntime(
    canvas: HTMLCanvasElement,
    clip: CapturedPoseClip,
    width: number,
    height: number,
    initialStyle: MannequinStyle = "clay",
): PoseMannequinRuntime {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x16181d);

    const aspect = width / height;
    const worldHeight = 4.0;
    const worldWidth = worldHeight * aspect;

    // 使用正交对齐相机：确保 3D 白模人偶的 (x, y) 与原视频像素位置 100% 严丝合缝，同时保留 Z 深度立体光影与遮挡
    const camera = new THREE.OrthographicCamera(
        -worldWidth / 2,
        worldWidth / 2,
        worldHeight / 2,
        -worldHeight / 2,
        0.1,
        50,
    );
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);

    // 灯光：柔和主方向光 + 背面轮廓补光 + 半球环境光，突出白模粘土体积感
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(-4, 6, 8);
    keyLight.castShadow = true;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xdbe8ff, 0.85);
    rimLight.position.set(5, 3, -5);
    scene.add(rimLight);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x555b66, 0.95));

    // 底部极简舞台参考网格（低视觉重量，交代空间基准面）
    const grid = new THREE.GridHelper(Math.max(worldWidth, worldHeight) * 2.2, 16, 0x3b404c, 0x262a33);
    grid.position.set(0, -worldHeight * 0.45, -0.5);
    scene.add(grid);

    // 共用基础几何体，零重复分配
    const unitSphere = new THREE.SphereGeometry(1, 18, 14);
    const unitCylinder = new THREE.CylinderGeometry(1, 0.88, 1, 14);
    const unitCone = new THREE.ConeGeometry(0.55, 1.2, 10);
    const unitTorso = new THREE.CylinderGeometry(1, 0.78, 1, 16);

    const rigs: PersonRig[] = [];
    const maxSlots = Math.max(1, clip.maxPoses || 1);
    for (let i = 0; i < maxSlots; i++) {
        const colors = paletteFor(initialStyle, i);
        const material = new THREE.MeshStandardMaterial({ color: colors.main, roughness: 0.84, metalness: 0.02 });
        const jointMaterial = new THREE.MeshStandardMaterial({ color: colors.joint, roughness: 0.78, metalness: 0.02 });
        const group = new THREE.Group();

        const head = new THREE.Mesh(unitSphere, material);
        const nose = new THREE.Mesh(unitCone, jointMaterial);
        const neck = new THREE.Mesh(unitCylinder, material);
        const torso = new THREE.Mesh(unitTorso, material);
        const pelvis = new THREE.Mesh(unitSphere, material);
        group.add(head, nose, neck, torso, pelvis);

        const limbs = LIMB_SEGMENTS.map(() => {
            const m = new THREE.Mesh(unitCylinder, material);
            group.add(m);
            return m;
        });
        const joints = JOINT_INDICES.map(() => {
            const m = new THREE.Mesh(unitSphere, jointMaterial);
            group.add(m);
            return m;
        });

        group.visible = false;
        scene.add(group);
        rigs.push({ group, head, nose, neck, torso, pelvis, limbs, joints, material, jointMaterial });
    }

    const toWorld = (lm: PoseLandmark): THREE.Vector3 => {
        const x = (lm.x - 0.5) * worldWidth;
        const y = (0.5 - lm.y) * worldHeight;
        // MediaPipe z 越小越靠近镜头，取反后正 Z 朝向相机
        const z = -lm.z * worldWidth * 0.55;
        return new THREE.Vector3(x, y, z);
    };

    const updateRig = (rig: PersonRig, pose: PoseLandmark[]) => {
        const pts = pose.map(toWorld);
        const lSh = pts[11];
        const rSh = pts[12];
        const lHip = pts[23];
        const rHip = pts[24];
        const nosePt = pts[0];
        if (!lSh || !rSh || !lHip || !rHip || !nosePt) {
            rig.group.visible = false;
            return;
        }
        rig.group.visible = true;

        const shoulderMid = new THREE.Vector3().addVectors(lSh, rSh).multiplyScalar(0.5);
        const hipMid = new THREE.Vector3().addVectors(lHip, rHip).multiplyScalar(0.5);
        const torsoLen = Math.max(0.15, shoulderMid.distanceTo(hipMid));
        const shoulderWidth = Math.max(0.12, lSh.distanceTo(rSh));
        // 根据人物当前画面尺幅自适应躯干/四肢粗细
        const bodyUnit = Math.max(shoulderWidth * 0.52, torsoLen * 0.34);

        // 躯干与骨盆
        placeSegment(rig.torso, hipMid, shoulderMid, bodyUnit * 0.52);
        rig.pelvis.position.copy(hipMid);
        rig.pelvis.scale.set(bodyUnit * 0.48, bodyUnit * 0.34, bodyUnit * 0.36);

        // 头部与颈部
        const headRadius = bodyUnit * 0.44;
        const lEar = pts[7];
        const rEar = pts[8];
        const headCenter =
            lEar && rEar
                ? new THREE.Vector3().addVectors(lEar, rEar).multiplyScalar(0.5).lerp(nosePt, 0.25)
                : nosePt.clone();
        rig.head.position.copy(headCenter);
        rig.head.scale.set(headRadius * 0.88, headRadius * 1.08, headRadius * 0.95);
        placeSegment(rig.neck, shoulderMid, headCenter, bodyUnit * 0.19);

        // 鼻锥朝向标记（明确展示脸部转向）
        const faceDir = new THREE.Vector3().subVectors(nosePt, headCenter);
        if (faceDir.lengthSq() < 1e-4) faceDir.set(0, 0, 1);
        faceDir.normalize();
        rig.nose.position.copy(headCenter).addScaledVector(faceDir, headRadius * 0.95);
        rig.nose.quaternion.setFromUnitVectors(UP_VEC, faceDir);
        rig.nose.scale.setScalar(headRadius * 0.38);

        // 四肢骨骼段
        LIMB_SEGMENTS.forEach((seg, idx) => {
            const pa = pts[seg.a];
            const pb = pts[seg.b];
            const vis = Math.min(pose[seg.a]?.visibility ?? 1, pose[seg.b]?.visibility ?? 1);
            if (!pa || !pb || vis < 0.2) {
                rig.limbs[idx].visible = false;
                return;
            }
            placeSegment(rig.limbs[idx], pa, pb, bodyUnit * seg.radiusScale);
        });

        // 关节球
        JOINT_INDICES.forEach((lmIdx, idx) => {
            const p = pts[lmIdx];
            const vis = pose[lmIdx]?.visibility ?? 1;
            const sphere = rig.joints[idx];
            if (!p || vis < 0.2) {
                sphere.visible = false;
                return;
            }
            sphere.visible = true;
            sphere.position.copy(p);
            const r = lmIdx === 11 || lmIdx === 12 || lmIdx === 23 || lmIdx === 24 ? bodyUnit * 0.24 : bodyUnit * 0.19;
            sphere.scale.setScalar(r);
        });
    };

    let lastTime = 0;

    const renderAt = (timeSeconds: number) => {
        lastTime = timeSeconds;
        const poses = samplePoseFrameAt(clip, timeSeconds);
        for (let i = 0; i < rigs.length; i++) {
            const pose = poses[i];
            if (pose && pose.length >= 29) {
                updateRig(rigs[i], pose);
            } else {
                rigs[i].group.visible = false;
            }
        }
        renderer.render(scene, camera);
    };

    const setStyle = (style: MannequinStyle) => {
        rigs.forEach((rig, idx) => {
            const colors = paletteFor(style, idx);
            rig.material.color.setHex(colors.main);
            rig.jointMaterial.color.setHex(colors.joint);
        });
        renderAt(lastTime);
    };

    return {
        renderAt,
        setStyle,
        dispose: () => {
            unitSphere.dispose();
            unitCylinder.dispose();
            unitCone.dispose();
            unitTorso.dispose();
            rigs.forEach((rig) => {
                rig.material.dispose();
                rig.jointMaterial.dispose();
            });
            grid.geometry.dispose();
            if (Array.isArray(grid.material)) grid.material.forEach((m) => m.dispose());
            else grid.material.dispose();
            renderer.dispose();
        },
    };
}

/** 计算与原视频画幅一致且满足 H.264 偶数宽高要求的导出分辨率（最大边长 1280）。 */
function exportResolutionOf(clip: CapturedPoseClip): [number, number] {
    const maxSide = 1280;
    const scale = Math.min(1, maxSide / Math.max(clip.width, clip.height));
    const w = Math.max(256, Math.round((clip.width * scale) / 2) * 2);
    const h = Math.max(256, Math.round((clip.height * scale) / 2) * 2);
    return [w, h];
}

/** 离屏 30fps 逐帧渲染 3D 骨骼白模人偶并编码为 H.264 MP4 Blob。 */
export async function exportPoseWhitemodelBlob(
    clip: CapturedPoseClip,
    style: MannequinStyle,
    onProgress: (progress: number) => void,
): Promise<Blob> {
    const [width, height] = exportResolutionOf(clip);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const runtime = createPoseMannequinRuntime(canvas, clip, width, height, style);
    try {
        runtime.renderAt(0);
        return await encodeDirectorDeskVideo({
            canvas,
            durationMilliseconds: Math.round(clip.durationSeconds * 1000),
            renderFrame: async (timeMs) => {
                runtime.renderAt(timeMs / 1000);
            },
            onProgress,
        });
    } finally {
        runtime.dispose();
    }
}

/** 编码并上传 3D 骨骼白模 MP4 到云端对象存储。 */
export async function exportAndUploadPoseWhitemodel(
    clip: CapturedPoseClip,
    style: MannequinStyle,
    onProgress: (stage: "encoding" | "uploading", progress: number) => void,
): Promise<UploadedFile> {
    const blob = await exportPoseWhitemodelBlob(clip, style, (progress) => onProgress("encoding", progress));
    onProgress("uploading", 100);
    const file = new File([blob], `whitemodel-pose-${Date.now()}.mp4`, { type: "video/mp4" });
    return await uploadMediaFile(file);
}
