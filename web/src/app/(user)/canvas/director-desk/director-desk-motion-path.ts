
import { translateMessage as translate } from "@/features/locale/translate";
import { CatmullRomCurve3, CubicBezierCurve3, CurvePath, LineCurve3, Vector3, type Curve } from "three";
import { nanoid } from "nanoid";

import type { CanvasDirectorDeskMotionPath, CanvasDirectorDeskPathAnchor, CanvasDirectorDeskPathKind, CanvasDirectorDeskVector3 } from "@/features/canvas/types";

const curveCache = new WeakMap<CanvasDirectorDeskMotionPath, Curve<Vector3>>();

/** 将持久化向量转换为 Three.js 向量，避免在工程中保存运行时实例。 */
function vector(value: CanvasDirectorDeskVector3): Vector3 {
    return new Vector3(value.x, value.y, value.z);
}

/** 按锚点构建共享曲线，弧长查找表随不可变路径对象缓存。 */
export function getMotionPathCurve(path: CanvasDirectorDeskMotionPath): Curve<Vector3> {
    const cached = curveCache.get(path);
    if (cached) return cached;
    if (path.anchors.length < 2) throw new Error(translate("directorDesk.aMotionPathNeedsAtLeastTwoAnchors"));
    let curve: Curve<Vector3>;
    if (path.kind === "pencil") {
        curve = new CatmullRomCurve3(path.anchors.map((anchor) => vector(anchor.position)), path.closed, "centripetal");
    } else {
        const segments = new CurvePath<Vector3>();
        const count = path.closed ? path.anchors.length : path.anchors.length - 1;
        for (let index = 0; index < count; index += 1) {
            const start = path.anchors[index];
            const end = path.anchors[(index + 1) % path.anchors.length];
            segments.add(start.outgoing || end.incoming
                ? new CubicBezierCurve3(vector(start.position), vector(start.outgoing || start.position), vector(end.incoming || end.position), vector(end.position))
                : new LineCurve3(vector(start.position), vector(end.position)));
        }
        curve = segments;
    }
    curve.arcLengthDivisions = Math.max(256, path.anchors.length * 32);
    curve.updateArcLengths();
    curveCache.set(path, curve);
    return curve;
}

/** 根据绝对时间和曲线弧长求位置及前进切线，区间外保持端点。 */
export function evaluateMotionPath(path: CanvasDirectorDeskMotionPath, timeMilliseconds: number): { position: CanvasDirectorDeskVector3; direction: CanvasDirectorDeskVector3 } {
    const progress = Math.max(0, Math.min(1, (timeMilliseconds - path.startTimeMilliseconds) / (path.endTimeMilliseconds - path.startTimeMilliseconds)));
    const curve = getMotionPathCurve(path);
    const position = curve.getPointAt(progress);
    const direction = curve.getTangentAt(progress === 1 && path.closed ? 0 : progress);
    return { position: { x: position.x, y: position.y, z: position.z }, direction: { x: direction.x, y: direction.y, z: direction.z } };
}

/** 根据一次拖动创建直线、矩形或四段贝塞尔圆形。 */
export function createDraggedMotionPath(kind: CanvasDirectorDeskPathKind, start: CanvasDirectorDeskVector3, end: CanvasDirectorDeskVector3, durationMilliseconds: number, followDirection: boolean): CanvasDirectorDeskMotionPath {
    let anchors: CanvasDirectorDeskPathAnchor[] = [{ position: { ...start } }, { position: { ...end } }];
    if (kind === "rectangle") {
        anchors = [start, { x: end.x, y: start.y, z: start.z }, { ...end, y: start.y }, { x: start.x, y: start.y, z: end.z }].map((position) => ({ position: { ...position } }));
    }
    if (kind === "circle") {
        const radius = Math.hypot(end.x - start.x, end.z - start.z);
        const angle = Math.atan2(end.z - start.z, end.x - start.x);
        const handleLength = radius * 4 * (Math.SQRT2 - 1) / 3;
        anchors = Array.from({ length: 4 }, (_, index) => {
            const phase = angle + index * Math.PI / 2;
            const position = { x: start.x + radius * Math.cos(phase), y: start.y, z: start.z + radius * Math.sin(phase) };
            return {
                position,
                incoming: { x: position.x + handleLength * Math.sin(phase), y: start.y, z: position.z - handleLength * Math.cos(phase) },
                outgoing: { x: position.x - handleLength * Math.sin(phase), y: start.y, z: position.z + handleLength * Math.cos(phase) },
            };
        });
    }
    return { id: nanoid(), kind, anchors, closed: kind === "circle" || kind === "rectangle", startTimeMilliseconds: 0, endTimeMilliseconds: durationMilliseconds, followDirection };
}

/** 选择当前运动片段；间隙保持上一段终点，首段开始前保持其起点。 */
export function findMotionPathAtTime(paths: CanvasDirectorDeskMotionPath[], timeMilliseconds: number): CanvasDirectorDeskMotionPath | undefined {
    const sorted = [...paths].sort((first, second) => first.startTimeMilliseconds - second.startTimeMilliseconds);
    return sorted.findLast((path) => path.startTimeMilliseconds <= timeMilliseconds) || sorted[0];
}

/** 按稳定标识编辑单段路径，新增、重绘均不会覆盖其他片段。 */
export function upsertMotionPath(paths: CanvasDirectorDeskMotionPath[], path: CanvasDirectorDeskMotionPath): CanvasDirectorDeskMotionPath[] {
    return [...paths.filter((item) => item.id !== path.id), path].sort((first, second) => first.startTimeMilliseconds - second.startTimeMilliseconds);
}

/** 连续笔迹先过滤密集点，再按曲线等距采样，限制持久化锚点数量。 */
export function simplifyPencilPoints(points: CanvasDirectorDeskVector3[]): CanvasDirectorDeskPathAnchor[] {
    const filtered: CanvasDirectorDeskVector3[] = [];
    for (const [index, point] of points.entries()) {
        if (!filtered.length || index === points.length - 1 || vector(point).distanceTo(vector(filtered[filtered.length - 1])) >= 0.04) filtered.push(point);
    }
    if (filtered.length <= 128) return filtered.map((position) => ({ position: { ...position } }));
    return new CatmullRomCurve3(filtered.map(vector), false, "centripetal").getSpacedPoints(127).map((position) => ({ position: { x: position.x, y: position.y, z: position.z } }));
}

/** 平移路径时同步移动锚点和切线，保留曲线形状。 */
export function translateMotionPath(path: CanvasDirectorDeskMotionPath, offset: CanvasDirectorDeskVector3): CanvasDirectorDeskMotionPath {
    const move = (point: CanvasDirectorDeskVector3) => ({ x: point.x + offset.x, y: point.y + offset.y, z: point.z + offset.z });
    return { ...path, anchors: path.anchors.map((anchor) => ({ position: move(anchor.position), ...(anchor.incoming ? { incoming: move(anchor.incoming) } : {}), ...(anchor.outgoing ? { outgoing: move(anchor.outgoing) } : {}) })) };
}

/** 移动单个锚点时保持它的切线相对位置，独立手柄则只更新对应切线。 */
export function moveMotionPathAnchor(path: CanvasDirectorDeskMotionPath, index: number, part: "position" | "incoming" | "outgoing", position: CanvasDirectorDeskVector3): CanvasDirectorDeskMotionPath {
    return { ...path, anchors: path.anchors.map((anchor, current) => {
        if (current !== index) return anchor;
        if (part !== "position") return { ...anchor, [part]: position };
        const offset = vector(position).sub(vector(anchor.position));
        const shift = (point: CanvasDirectorDeskVector3) => ({ x: point.x + offset.x, y: point.y + offset.y, z: point.z + offset.z });
        return { position, ...(anchor.incoming ? { incoming: shift(anchor.incoming) } : {}), ...(anchor.outgoing ? { outgoing: shift(anchor.outgoing) } : {}) };
    }) };
}
