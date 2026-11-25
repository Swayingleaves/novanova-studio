/**
 * 白模求解器与轻量几何体检（移植自 seedance-skill/engine/solver.mjs）。
 * 纯数学、零 Three.js 依赖，供实时预览、离屏导出与几何体检共用。
 */

export type Vec3 = [number, number, number];
export type RangeOrNumber = number | [number, number];

export type WhitemodelPathPoint = {
    t: number;
    p: Vec3;
    ease?: string;
};

export type WhitemodelSubject = {
    id: string;
    shape?: "human" | "box" | "cone" | "cylinder" | "sphere" | "torus" | "plane";
    height?: number;
    size?: Vec3;
    r?: number;
    r2?: number;
    h?: number;
    tube?: number;
    skirt?: number;
    color?: string;
    yaw?: number;
    faceAlongPath?: boolean;
    path?: WhitemodelPathPoint[];
};

export type WhitemodelPropLayout = {
    type: "ring" | "grid" | "line" | "scatter";
    count: number;
    radius?: number;
    from?: number | Vec3;
    to?: number | Vec3;
    cols?: number;
    spacing?: [number, number];
    area?: [number, number];
    corridor?: number;
    jitter?: number;
    rotY?: number;
};

export type WhitemodelProp = {
    shape: "box" | "cone" | "cylinder" | "sphere" | "torus" | "plane" | "human";
    size?: Vec3;
    r?: number;
    r2?: number;
    h?: number;
    tube?: number;
    y?: number;
    height?: number;
    skirt?: number;
    pos?: Vec3;
    rotY?: number;
    color?: string;
    layout?: WhitemodelPropLayout;
};

export type WhitemodelShake = {
    amp?: number;
    freq?: number;
    phase?: number;
};

export type WhitemodelShot = {
    t: [number, number];
    rig?: "static" | "pan" | "zoom" | "dolly" | "follow" | "lead" | "orbit" | "crane" | "drone" | "topdown" | "pov";
    target?: string;
    lookAt?: string | Vec3;
    center?: string | Vec3;
    pos?: Vec3;
    from?: string | Vec3;
    to?: string | Vec3;
    lens?: RangeOrNumber;
    lag?: number;
    lead?: number;
    side?: number;
    height?: RangeOrNumber;
    radius?: RangeOrNumber;
    angle?: RangeOrNumber;
    eye?: number;
    ahead?: number;
    pitch?: number;
    roll?: [number, number];
    spin?: [number, number];
    ease?: string;
    shake?: WhitemodelShake;
};

export type WhitemodelScene = {
    meta: {
        duration: number;
        fps?: number;
        aspect?: string;
        width?: number;
        height?: number;
        hero?: string;
        seed?: number;
    };
    world?: {
        background?: string | number;
        fog?: [number, number];
        ground?: {
            type?: "plane" | "disc" | "none";
            size?: number;
            y?: number;
            color?: string;
        };
        light?: {
            pos?: Vec3;
            intensity?: number;
            ambient?: number;
            groundColor?: string | number;
            shadowRange?: number;
        };
        props?: WhitemodelProp[];
    };
    subjects?: WhitemodelSubject[];
    shots: WhitemodelShot[];
};

export type SolvedCamera = {
    pos: Vec3;
    aim: Vec3;
    fovY: number;
    mm: number;
    roll: number;
    spin: number;
    shot: WhitemodelShot;
    shotIndex: number;
};

export type SubjectState = {
    id: string;
    height: number;
    foot: Vec3;
    center: Vec3;
    head: Vec3;
    aim: Vec3;
    yaw: number;
    speed: number;
};

export type ProbeIssue = {
    level: "error" | "warn";
    message: string;
};

export const ASPECT_EXPORT_SIZE: Record<string, [number, number]> = {
    "16:9": [1280, 720],
    "9:16": [720, 1280],
    "1:1": [720, 720],
    "4:3": [960, 720],
    "3:4": [720, 960],
    "21:9": [1260, 540],
};

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const seg = (t: number, a: number, b: number) => (b === a ? 1 : clamp((t - a) / (b - a), 0, 1));

const EASE: Record<string, (t: number) => number> = {
    linear: (t) => t,
    in: (t) => t * t,
    out: (t) => 1 - (1 - t) * (1 - t),
    inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
};

const easeOf = (name: string | undefined, t: number) => (EASE[name || "inOut"] || EASE.inOut)(t);

/** 确定性伪随机数生成器，保证每次预览与导出结果一致。 */
export function makeRand(seed = 20260817): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    };
}

/** 全画幅 36x24mm 焦距转垂直视场角。 */
export const mmToFovY = (mm: number) => (2 * Math.atan(24 / (2 * Math.max(8, mm))) * 180) / Math.PI;
export const visibleHeightAt = (d: number, fovY: number) => 2 * d * Math.tan((fovY * Math.PI) / 360);

function dirOf(path: WhitemodelPathPoint[], i: number): Vec3 {
    const a = path[i].p;
    const b = path[i + 1].p;
    return [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
}

/** 采样主体运动路径，起点之前按首段速度线性外推避免跟拍重叠。 */
export function samplePath(path: WhitemodelPathPoint[] | undefined, time: number): { p: Vec3; v: Vec3 } {
    if (!path || path.length === 0) return { p: [0, 0, 0], v: [0, 0, 0] };
    if (path.length === 1) return { p: [...path[0].p] as Vec3, v: [0, 0, 0] };
    const first = path[0];
    const last = path[path.length - 1];
    if (time < first.t) {
        const b = path[1] ?? first;
        const dt = b.t - first.t || 1;
        const k = (time - first.t) / dt;
        return {
            p: [first.p[0] + (b.p[0] - first.p[0]) * k, first.p[1] + (b.p[1] - first.p[1]) * k, first.p[2] + (b.p[2] - first.p[2]) * k],
            v: dirOf(path, 0),
        };
    }
    if (time === first.t) return { p: [...first.p] as Vec3, v: dirOf(path, 0) };
    if (time >= last.t) return { p: [...last.p] as Vec3, v: dirOf(path, path.length - 2) };
    for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        if (time >= a.t && time <= b.t) {
            const t = easeOf(b.ease || a.ease || "inOut", seg(time, a.t, b.t));
            return { p: lerp3(a.p, b.p, t), v: dirOf(path, i) };
        }
    }
    return { p: [...last.p] as Vec3, v: [0, 0, 0] };
}

/** 按路径切线计算角色朝向（Three.js 默认朝 +Z）。 */
export function yawAlongPath(v: Vec3): number | null {
    const [dx, , dz] = v;
    if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) return null;
    return Math.atan2(dx, dz);
}

/** 求解指定时刻的主体位置与朝向。 */
export function subjectAt(scene: WhitemodelScene, id: string | undefined, time: number): SubjectState | null {
    if (!id) return null;
    const s = (scene.subjects || []).find((x) => x.id === id);
    if (!s) return null;
    const { p, v } = samplePath(s.path, time);
    const h = s.height ?? 1.75;
    return {
        id,
        height: h,
        foot: p,
        center: [p[0], p[1] + h / 2, p[2]],
        head: [p[0], p[1] + h, p[2]],
        aim: [p[0], p[1] + h * 0.62, p[2]],
        yaw: s.faceAlongPath === false ? (s.yaw ?? 0) : (yawAlongPath(v) ?? s.yaw ?? 0),
        speed: Math.hypot(v[0], v[2]),
    };
}

function resolveTarget(scene: WhitemodelScene, target: string | Vec3 | undefined, time: number): Vec3 {
    if (Array.isArray(target) && target.length >= 3) {
        return [Number(target[0]) || 0, Number(target[1]) || 0, Number(target[2]) || 0];
    }
    if (typeof target === "string") {
        const s = subjectAt(scene, target, time);
        if (s) return s.aim;
    }
    const heroId = scene.meta.hero ?? scene.subjects?.[0]?.id;
    const hero = subjectAt(scene, heroId, time);
    return hero ? hero.aim : [0, 1.1, 0];
}

function shakeOffset(time: number, sh?: WhitemodelShake): { pos: Vec3; aim: Vec3 } {
    if (!sh) return { pos: [0, 0, 0], aim: [0, 0, 0] };
    const a = sh.amp ?? 0.02;
    const f = sh.freq ?? 1.1;
    const ph = sh.phase ?? 0;
    const n = (k: number, m: number) =>
        Math.sin(time * f * 2 * Math.PI * m + ph + k) * 0.6 +
        Math.sin(time * f * 2 * Math.PI * m * 2.7 + ph + k * 2) * 0.3 +
        Math.sin(time * f * 2 * Math.PI * m * 0.41 + ph + k * 3) * 0.1;
    return {
        pos: [n(0, 1) * a, n(1.7, 0.83) * a * 0.7, n(3.4, 1.19) * a],
        aim: [n(5.1, 0.61) * a * 1.8, n(6.8, 0.77) * a * 1.4, 0],
    };
}

function pair(v: RangeOrNumber | undefined, d: number | [number, number]): [number, number] {
    if (Array.isArray(v)) return [Number(v[0]) || 0, Number(v[1]) || 0];
    if (typeof v === "number") return [v, v];
    return Array.isArray(d) ? d : [d, d];
}

function asVec3(v: string | Vec3 | undefined, fallback: Vec3): Vec3 {
    if (Array.isArray(v) && v.length >= 3) {
        return [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0];
    }
    return fallback;
}

/** 求解单个镜头在指定时刻的相机姿态。 */
export function solveShot(scene: WhitemodelScene, shot: WhitemodelShot, time: number): Omit<SolvedCamera, "shotIndex"> {
    const [t0, t1] = shot.t;
    const raw = seg(time, t0, t1);
    const t01 = easeOf(shot.ease || "inOut", raw);
    const lensRange = pair(shot.lens, 35);
    const mm = lerp(lensRange[0], lensRange[1], t01);

    let pos: Vec3;
    let aim: Vec3;
    const rig = shot.rig || "static";
    const tgt = () => resolveTarget(scene, shot.lookAt ?? shot.target, time);

    switch (rig) {
        case "static":
        case "zoom": {
            pos = asVec3(shot.pos, [0, 1.8, -6]);
            aim = tgt();
            break;
        }
        case "pan": {
            pos = asVec3(shot.pos, [0, 1.8, -6]);
            const a = resolveTarget(scene, shot.from, time);
            const b = resolveTarget(scene, shot.to, time);
            aim = lerp3(a, b, t01);
            break;
        }
        case "dolly":
        case "crane":
        case "drone": {
            pos = lerp3(asVec3(shot.from, [0, 2, -8]), asVec3(shot.to, [0, 2, -2]), t01);
            aim = tgt();
            break;
        }
        case "follow": {
            const id = shot.target ?? scene.meta.hero ?? scene.subjects?.[0]?.id;
            const s = subjectAt(scene, id, time);
            const back = subjectAt(scene, id, time - (shot.lag ?? 2));
            const h = pair(shot.height, 1.5);
            const off = shot.side ?? 0;
            if (s && back) {
                pos = [back.foot[0] + off, lerp(h[0], h[1], t01), back.foot[2]];
                aim = [...s.aim] as Vec3;
            } else {
                pos = [off, lerp(h[0], h[1], t01), -5];
                aim = [0, 1.1, 0];
            }
            break;
        }
        case "lead": {
            const id = shot.target ?? scene.meta.hero ?? scene.subjects?.[0]?.id;
            const s = subjectAt(scene, id, time);
            const d = shot.lead ?? 3;
            const h = pair(shot.height, 1.4);
            if (s) {
                const fx = Math.sin(s.yaw);
                const fz = Math.cos(s.yaw);
                pos = [s.foot[0] + fx * d, lerp(h[0], h[1], t01), s.foot[2] + fz * d];
                aim = [...s.aim] as Vec3;
            } else {
                pos = [0, lerp(h[0], h[1], t01), d];
                aim = [0, 1.1, 0];
            }
            break;
        }
        case "orbit": {
            const c = resolveTarget(scene, shot.center ?? shot.target, time);
            const r = pair(shot.radius, 6);
            const h = pair(shot.height, 1.6);
            const ang = pair(shot.angle, [90, 270]);
            const a = (lerp(ang[0], ang[1], t01) * Math.PI) / 180;
            const rr = lerp(r[0], r[1], t01);
            pos = [c[0] + Math.cos(a) * rr, lerp(h[0], h[1], t01), c[2] + Math.sin(a) * rr];
            aim = tgt();
            break;
        }
        case "topdown": {
            const c = resolveTarget(scene, shot.center ?? shot.target, time);
            const h = pair(shot.height, 14);
            pos = [c[0], lerp(h[0], h[1], t01), c[2]];
            aim = [c[0], 0, c[2]];
            break;
        }
        case "pov": {
            const id = shot.target ?? scene.meta.hero ?? scene.subjects?.[0]?.id;
            const s = subjectAt(scene, id, time);
            if (s) {
                const eye = shot.eye ?? s.height * 0.94;
                const fx = Math.sin(s.yaw);
                const fz = Math.cos(s.yaw);
                const ahead = shot.ahead ?? 0.2;
                pos = [s.foot[0] + fx * ahead, s.foot[1] + eye, s.foot[2] + fz * ahead];
                aim = [pos[0] + fx * 10, pos[1] + (shot.pitch ?? 0) * 10, pos[2] + fz * 10];
            } else {
                pos = [0, 1.6, 0];
                aim = [0, 1.6, 10];
            }
            break;
        }
        default: {
            pos = asVec3(shot.pos, [0, 1.8, -6]);
            aim = tgt();
        }
    }

    const sh = shakeOffset(time, shot.shake);
    pos = [pos[0] + sh.pos[0], pos[1] + sh.pos[1], pos[2] + sh.pos[2]];
    aim = [aim[0] + sh.aim[0], aim[1] + sh.aim[1], aim[2] + sh.aim[2]];

    const roll = shot.roll ? lerp(shot.roll[0], shot.roll[1], t01) : 0;
    const spin = shot.spin ? lerp(shot.spin[0], shot.spin[1], t01) : 0;
    return { pos, aim, fovY: mmToFovY(mm), mm, roll, spin, shot };
}

/** 查找指定时刻对应的镜头。 */
export function shotAt(scene: WhitemodelScene, time: number): { shot: WhitemodelShot; index: number } {
    const shots = scene.shots || [];
    for (let i = 0; i < shots.length; i++) {
        const [a, b] = shots[i].t;
        if (time >= a && (time < b || (i === shots.length - 1 && time <= b))) {
            return { shot: shots[i], index: i };
        }
    }
    return { shot: shots[shots.length - 1], index: Math.max(0, shots.length - 1) };
}

/** 求解指定时刻的全局相机状态。 */
export function solveAt(scene: WhitemodelScene, time: number): SolvedCamera {
    const { shot, index } = shotAt(scene, time);
    return { ...solveShot(scene, shot, time), shotIndex: index };
}

function sub(a: Vec3, b: Vec3): Vec3 {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: Vec3, b: Vec3): Vec3 {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: Vec3, b: Vec3): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function norm(a: Vec3): Vec3 {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
}

/** 世界坐标投影到画面归一化坐标 [-1, 1]。 */
export function projectPoint(worldP: Vec3, cam: SolvedCamera, aspect: number) {
    const fwd = norm(sub(cam.aim, cam.pos));
    let up: Vec3 = [0, 1, 0];
    if (Math.abs(dot(fwd, up)) > 0.999) up = [0, 0, 1];
    const right = norm(cross(fwd, up));
    const trueUp = cross(right, fwd);
    const d = sub(worldP, cam.pos);
    const z = dot(d, fwd);
    if (z <= 0.001) return { x: Number.NaN, y: Number.NaN, z, behind: true };
    const tanH = Math.tan((cam.fovY * Math.PI) / 360);
    return {
        x: dot(d, right) / (z * tanH * aspect),
        y: dot(d, trueUp) / (z * tanH),
        z,
        behind: false,
    };
}

/** 对 scene.json 执行快速几何体检（防穿帮、防撞机、防出画）。 */
export function probeWhitemodelScene(scene: WhitemodelScene): ProbeIssue[] {
    const issues: ProbeIssue[] = [];
    const duration = scene.meta?.duration ?? 5;
    if (!scene.shots?.length) {
        issues.push({ level: "error", message: "缺少镜头配置（shots）" });
        return issues;
    }
    const [aw, ah] = (scene.meta?.aspect ?? "16:9").split(":").map(Number);
    const aspect = aw > 0 && ah > 0 ? aw / ah : 16 / 9;
    const heroId = scene.meta?.hero ?? scene.subjects?.[0]?.id;

    let overlapCount = 0;
    let outOfFrameCount = 0;
    const samples = Math.max(10, Math.round(duration * 6));
    for (let i = 0; i <= samples; i++) {
        const t = (duration * i) / samples;
        const cam = solveAt(scene, t);
        if (cam.shot.rig === "pov" || !heroId) continue;
        const hero = subjectAt(scene, heroId, t);
        if (!hero) continue;
        const dist = Math.hypot(cam.pos[0] - hero.aim[0], cam.pos[1] - hero.aim[1], cam.pos[2] - hero.aim[2]);
        if (dist < 0.4) overlapCount++;
        const proj = projectPoint(hero.aim, cam, aspect);
        if (proj.behind || Math.abs(proj.x) > 1.05 || Math.abs(proj.y) > 1.05) outOfFrameCount++;
    }
    if (overlapCount > 0) {
        issues.push({ level: "error", message: `相机与主角距离过近/重叠（${overlapCount} 处采样点）` });
    }
    if (outOfFrameCount > Math.ceil(samples * 0.25)) {
        issues.push({ level: "warn", message: `主角在部分时刻接近或离开画面边界（${outOfFrameCount}/${samples + 1} 采样点）` });
    }
    return issues;
}

const SCENE_FENCE_REGEX = /```whitemodel-scene\s*([\s\S]*?)```/i;

/** 从助手文案或 draftedPrompts 中提取合法的 WhitemodelScene。 */
export function extractWhitemodelScene(text?: string, draftedPrompts?: Record<string, string>): WhitemodelScene | null {
    const candidates: string[] = [];
    if (draftedPrompts?.sceneJson) candidates.push(draftedPrompts.sceneJson);
    if (text) {
        const match = text.match(SCENE_FENCE_REGEX);
        if (match?.[1]) candidates.push(match[1].trim());
    }
    for (const raw of candidates) {
        try {
            const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
            if (parsed && typeof parsed === "object" && parsed.meta && Array.isArray(parsed.shots) && parsed.shots.length > 0) {
                return parsed as WhitemodelScene;
            }
        } catch {
            // 忽略非法片段，继续尝试下一个候选
        }
    }
    return null;
}

/** 剥离嵌入的 whitemodel-scene 围栏代码块，避免在气泡里直接展示大段 JSON。 */
export function stripWhitemodelSceneBlock(text?: string): string {
    if (!text) return "";
    return text.replace(SCENE_FENCE_REGEX, "").trim();
}
