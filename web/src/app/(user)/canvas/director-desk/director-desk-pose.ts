import type { CanvasDirectorDeskActionPreset, CanvasDirectorDeskJoint, CanvasDirectorDeskPose, CanvasDirectorDeskVector3 } from "@/features/canvas/types";

/** 关节顺序同时用于骨骼映射、编辑面板与姿势校验。 */
export const DIRECTOR_DESK_JOINTS: CanvasDirectorDeskJoint[] = ["body", "spine", "neck", "head", "leftShoulder", "rightShoulder", "leftElbow", "rightElbow", "leftWrist", "rightWrist", "leftHip", "rightHip", "leftKnee", "rightKnee", "leftAnkle", "rightAnkle"];

export const JOINT_LABELS: Record<CanvasDirectorDeskJoint, string> = {
    body: "身体", spine: "躯干", neck: "颈部", head: "头部", leftShoulder: "左肩", rightShoulder: "右肩", leftElbow: "左肘", rightElbow: "右肘", leftWrist: "左腕", rightWrist: "右腕", leftHip: "左髋", rightHip: "右髋", leftKnee: "左膝", rightKnee: "右膝", leftAnkle: "左踝", rightAnkle: "右踝",
};

type ActionDefinition = { label: string; durationMilliseconds: number; loop: boolean };

/** 持续动作循环播放，入姿及单次动作到达终点后保持。 */
export const CHARACTER_ACTIONS: Record<CanvasDirectorDeskActionPreset, ActionDefinition> = {
    idle: { label: "站立", durationMilliseconds: 2400, loop: true },
    tPose: { label: "T 型", durationMilliseconds: 2400, loop: true },
    walk: { label: "行走", durationMilliseconds: 900, loop: true },
    run: { label: "跑步", durationMilliseconds: 600, loop: true },
    sit: { label: "坐姿", durationMilliseconds: 1100, loop: false },
    crouch: { label: "蹲下", durationMilliseconds: 1000, loop: false },
    kneelSingle: { label: "单膝跪", durationMilliseconds: 1300, loop: false },
    kneelDouble: { label: "双膝跪", durationMilliseconds: 1300, loop: false },
    handsOnHips: { label: "叉腰", durationMilliseconds: 850, loop: false },
    lean: { label: "倚靠", durationMilliseconds: 1000, loop: false },
    bow: { label: "鞠躬", durationMilliseconds: 1600, loop: false },
    think: { label: "思考", durationMilliseconds: 1000, loop: false },
    fight: { label: "格斗", durationMilliseconds: 1000, loop: true },
    kick: { label: "踢球", durationMilliseconds: 1200, loop: false },
    throw: { label: "投掷", durationMilliseconds: 1400, loop: false },
    push: { label: "推进", durationMilliseconds: 1300, loop: false },
    wave: { label: "招手", durationMilliseconds: 800, loop: true },
    reach: { label: "伸手", durationMilliseconds: 900, loop: false },
    crossArms: { label: "抱臂", durationMilliseconds: 1000, loop: false },
    phone: { label: "看手机", durationMilliseconds: 1000, loop: false },
};

/** 创建独立的零偏移姿势，避免多个角色或关键帧共享可变关节对象。 */
export function createNeutralPose(): CanvasDirectorDeskPose {
    return { joints: Object.fromEntries(DIRECTOR_DESK_JOINTS.map((joint) => [joint, { x: 0, y: 0, z: 0 }])) as CanvasDirectorDeskPose["joints"], rootOffset: { x: 0, y: 0, z: 0 } };
}

/** 动作姿势和手动关节偏移逐轴相加。 */
export function addPoseOffsets(animation: CanvasDirectorDeskPose, adjustment: CanvasDirectorDeskPose): CanvasDirectorDeskPose {
    const result = createNeutralPose();
    for (const joint of DIRECTOR_DESK_JOINTS) {
        for (const axis of ["x", "y", "z"] as const) result.joints[joint][axis] = animation.joints[joint][axis] + adjustment.joints[joint][axis];
    }
    for (const axis of ["x", "y", "z"] as const) result.rootOffset[axis] = animation.rootOffset[axis] + adjustment.rootOffset[axis];
    return result;
}

/** 对入姿过程采用平滑插值，减少突然加速。 */
function smooth(value: number): number {
    const progress = Math.max(0, Math.min(1, value));
    return progress * progress * (3 - 2 * progress);
}

/** 通过解剖学关节角度按绝对时间求动作，不依赖之前播放过的帧。 */
export function evaluateCharacterAction(preset: CanvasDirectorDeskActionPreset, elapsedMilliseconds: number): CanvasDirectorDeskPose {
    const definition = CHARACTER_ACTIONS[preset];
    if (!definition) throw new Error("人物动作预设不存在");
    const elapsed = Math.max(0, elapsedMilliseconds);
    const progress = definition.loop ? (elapsed % definition.durationMilliseconds) / definition.durationMilliseconds : Math.min(1, elapsed / definition.durationMilliseconds);
    const phase = progress * Math.PI * 2;
    const wave = Math.sin(phase);
    const transition = smooth(progress);
    const pose = createNeutralPose();
    // 模型的绑定姿势为 T 型，默认关节姿势将双臂自然放下。
    pose.joints.leftShoulder.z = -1.42;
    pose.joints.rightShoulder.z = 1.42;
    pose.joints.leftElbow.x = 0.12;
    pose.joints.rightElbow.x = 0.12;
    const rotate = (joint: CanvasDirectorDeskJoint, x = 0, y = 0, z = 0) => { pose.joints[joint] = { x, y, z }; };
    const bendArms = (left: number, right = left) => {
        pose.joints.leftElbow.x = left;
        pose.joints.rightElbow.x = right;
    };
    if (preset === "idle" || preset === "tPose") {
        if (preset === "tPose") {
            rotate("leftShoulder");
            rotate("rightShoulder");
            bendArms(0);
        }
        pose.joints.spine.x = wave * 0.012;
        pose.rootOffset.y = wave * 0.003;
    } else if (preset === "walk" || preset === "run") {
        const running = preset === "run";
        const amplitude = running ? 0.85 : 0.48;
        pose.joints.leftHip.x = -wave * amplitude;
        pose.joints.rightHip.x = wave * amplitude;
        pose.joints.leftKnee.x = Math.max(0, wave) * (running ? 1.5 : 0.75);
        pose.joints.rightKnee.x = Math.max(0, -wave) * (running ? 1.5 : 0.75);
        pose.joints.leftAnkle.x = -pose.joints.leftKnee.x * 0.4;
        pose.joints.rightAnkle.x = -pose.joints.rightKnee.x * 0.4;
        pose.joints.leftShoulder.x = wave * amplitude * 0.8;
        pose.joints.rightShoulder.x = -wave * amplitude * 0.8;
        bendArms(running ? 1.35 : 0.25);
        pose.joints.body.x = running ? 0.16 : 0.02;
        pose.joints.spine.y = wave * 0.05;
        pose.rootOffset.y = Math.abs(Math.cos(phase)) * (running ? 0.075 : 0.025);
    } else if (preset === "wave") {
        pose.joints.rightShoulder.z = 0.35;
        pose.joints.rightElbow.x = 1.5;
        pose.joints.rightElbow.y = -0.5 + wave * 0.3;
        pose.joints.rightWrist.z = wave * 0.25;
        pose.joints.head.z = -0.08;
    } else if (preset === "fight") {
        pose.joints.body.y = -0.3;
        pose.joints.leftHip.x = -0.3;
        pose.joints.rightHip.x = 0.3;
        pose.joints.leftKnee.x = 0.35;
        pose.joints.rightKnee.x = 0.4;
        pose.joints.leftShoulder.x = -0.85 - Math.max(0, wave) * 0.5;
        pose.joints.rightShoulder.x = -0.85 - Math.max(0, -wave) * 0.5;
        bendArms(1.8 - Math.max(0, wave) * 1.5, 1.8 - Math.max(0, -wave) * 1.5);
        pose.rootOffset.y = -0.06 + Math.abs(wave) * 0.02;
    } else {
        // 一次性动作先构造目标姿势，再按过程权重混入自然站姿。
        const target = createNeutralPose();
        target.joints.leftShoulder = { ...pose.joints.leftShoulder };
        target.joints.rightShoulder = { ...pose.joints.rightShoulder };
        target.joints.leftElbow.x = 0.12;
        target.joints.rightElbow.x = 0.12;
        let weight = transition;
        const set = (joint: CanvasDirectorDeskJoint, x = 0, y = 0, z = 0) => { target.joints[joint] = { x, y, z }; };
        switch (preset) {
            case "sit":
                set("leftHip", -1.55); set("rightHip", -1.55); set("leftKnee", 1.55); set("rightKnee", 1.55);
                target.rootOffset.y = -0.48; target.rootOffset.z = -0.2;
                break;
            case "crouch":
                set("leftHip", -1.35, 0, -0.12); set("rightHip", -1.35, 0, 0.12); set("leftKnee", 2.3); set("rightKnee", 2.3);
                set("leftAnkle", -0.9); set("rightAnkle", -0.9); set("spine", 0.35);
                target.rootOffset.y = -0.72;
                break;
            case "kneelSingle":
                set("leftHip", -1.45); set("leftKnee", 1.5); set("rightHip", 0.2); set("rightKnee", 1.75); set("rightAnkle", -0.3);
                target.rootOffset.y = -0.5;
                break;
            case "kneelDouble":
                set("leftHip", -0.25); set("rightHip", -0.25); set("leftKnee", 2.1); set("rightKnee", 2.1);
                set("leftAnkle", -0.4); set("rightAnkle", -0.4); target.rootOffset.y = -0.6; target.rootOffset.z = -0.12;
                break;
            case "handsOnHips":
                set("leftShoulder", 0.1, -0.2, -1); set("rightShoulder", 0.1, 0.2, 1); set("leftElbow", 1.6, -0.8); set("rightElbow", 1.6, 0.8);
                break;
            case "lean":
                set("body", 0, 0, 0.15); set("rightHip", -0.3, 0, 0.1); set("rightKnee", 0.7); set("leftShoulder", 0, 0, -0.4);
                target.rootOffset.x = -0.08;
                break;
            case "bow":
                set("body", 0.35); set("spine", 0.45); set("head", 0.2);
                weight = progress < 0.45 ? smooth(progress / 0.45) : progress < 0.65 ? 1 : 1 - smooth((progress - 0.65) / 0.35);
                break;
            case "think":
                set("head", 0.12, -0.15); set("rightShoulder", -0.55, 0.2, 1.1); set("rightElbow", 2.2, 0.4); set("leftShoulder", -0.2, -0.2, -1.2); set("leftElbow", 1.5, -0.8);
                break;
            case "kick": {
                const kick = progress < 0.35 ? -0.65 * smooth(progress / 0.35) : progress < 0.6 ? -0.65 + 2 * smooth((progress - 0.35) / 0.25) : 1.35 * (1 - smooth((progress - 0.6) / 0.4));
                set("rightHip", -kick); set("rightKnee", progress < 0.4 ? smooth(progress / 0.4) * 1.5 : 1.5 * (1 - smooth((progress - 0.4) / 0.3)));
                set("body", -kick * 0.1); set("leftShoulder", -0.3, 0, -1); set("rightShoulder", 0.4, 0, 1);
                weight = 1;
                break;
            }
            case "throw": {
                const release = smooth((progress - 0.4) / 0.25);
                set("body", 0.15 * release, -0.5 + release * 0.9); set("rightShoulder", 0.7 - release * 2.2, 0, 0.25); set("rightElbow", 1.8 * (1 - release));
                set("leftShoulder", -0.5, 0, -0.9); set("leftHip", -0.15); set("rightHip", 0.2); set("rightKnee", 0.2);
                weight = smooth(progress / 0.3);
                break;
            }
            case "push":
                set("body", 0.22); set("leftShoulder", -1.4, 0, -1.2); set("rightShoulder", -1.4, 0, 1.2); set("leftElbow", 0.25); set("rightElbow", 0.25);
                set("leftHip", -0.2); set("rightHip", 0.2); set("rightKnee", 0.3); target.rootOffset.z = 0.08;
                break;
            case "reach":
                set("rightShoulder", -1.45, 0, 1.3); set("rightElbow", 0.1); set("head", 0, -0.15);
                break;
            case "crossArms":
                set("leftShoulder", -0.7, -0.4, -1.1); set("rightShoulder", -0.65, 0.4, 1.1); set("leftElbow", 1.6, -1); set("rightElbow", 1.7, 1);
                break;
            case "phone":
                set("head", 0.35); set("neck", 0.12); set("rightShoulder", -0.5, 0.15, 1.3); set("rightElbow", 1.8); set("rightWrist", -0.3, 0.1);
                break;
        }
        for (const joint of DIRECTOR_DESK_JOINTS) {
            for (const axis of ["x", "y", "z"] as const) pose.joints[joint][axis] += (target.joints[joint][axis] - pose.joints[joint][axis]) * weight;
        }
        for (const axis of ["x", "y", "z"] as const) pose.rootOffset[axis] = target.rootOffset[axis] * weight;
    }
    return pose;
}

/** 显示时使用角度，工程与骨骼保持弧度。 */
export function radiansToDegrees(value: number): number { return value * 180 / Math.PI; }

/** 把编辑面板输入转换为工程弧度。 */
export function degreesToRadians(value: number): number { return value * Math.PI / 180; }

/** 各关节旋转轴的中文标签。 */
export function jointAxisLabel(joint: CanvasDirectorDeskJoint, axis: keyof CanvasDirectorDeskVector3): string {
    if (joint.endsWith("Elbow") || joint.endsWith("Knee")) return axis === "x" ? "弯曲" : axis === "y" ? "扭转" : "侧弯";
    return axis === "x" ? "前倾 / 前举" : axis === "y" ? "转身 / 扭转" : "侧倾 / 外展";
}
