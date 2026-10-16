import * as Three from "three";
import type { CanvasDirectorDeskMotionPath, CanvasDirectorDeskPathKind, CanvasDirectorDeskVector3 } from "@/features/canvas/types";
import { createDraggedMotionPath, getMotionPathCurve, moveMotionPathAnchor, simplifyPencilPoints, translateMotionPath } from "./director-desk-motion-path";

export type PathEditorSettings = {
    path?: CanvasDirectorDeskMotionPath;
    tool: CanvasDirectorDeskPathKind | null;
    editable: boolean;
    height: number;
    durationMilliseconds: number;
    followDirection: boolean;
    color: string;
    endColor: string;
    startColor: string;
};

/** 路径编辑器把指针连续操作保留在运行时，完成后才提交工程。 */
export class DirectorDeskPathEditor {
    readonly group = new Three.Group();
    private settings: PathEditorSettings;
    private draft: CanvasDirectorDeskMotionPath | undefined;
    private gesture: { pointerId: number; start: CanvasDirectorDeskVector3; points: CanvasDirectorDeskVector3[]; anchor?: { index: number; part: "position" | "incoming" | "outgoing" }; previous?: CanvasDirectorDeskMotionPath } | null = null;
    private listeners = new AbortController();

    /** 绑定绘制监听，使用捕获阶段阻止绘制与视角控制竞争。 */
    constructor(private canvas: HTMLCanvasElement, private camera: Three.PerspectiveCamera, settings: PathEditorSettings, private render: () => void, private setNavigation: (enabled: boolean) => void, private commit: (path: CanvasDirectorDeskMotionPath) => void, private selectAnchor: (index: number) => void, private cancelTool: () => void) {
        this.settings = settings;
        const options = { signal: this.listeners.signal, capture: true };
        canvas.addEventListener("pointerdown", this.pointerDown, options);
        canvas.addEventListener("pointermove", this.pointerMove, options);
        canvas.addEventListener("pointerup", this.pointerUp, options);
        canvas.addEventListener("pointercancel", this.pointerCancel, options);
        canvas.addEventListener("lostpointercapture", this.pointerCancel, options);
        canvas.addEventListener("keydown", this.keyDown, { signal: this.listeners.signal });
        this.redraw();
    }

    /** 同步选中路径和工具状态；工具切换会丢弃未提交草稿。 */
    update(settings: PathEditorSettings): void {
        if (Object.keys(settings).every((key) => settings[key as keyof PathEditorSettings] === this.settings[key as keyof PathEditorSettings])) return;
        if (settings.tool !== this.settings.tool) this.cancel();
        if (this.draft && settings.height !== this.settings.height) this.draft = translateMotionPath(this.draft, { x: 0, y: settings.height - this.settings.height, z: 0 });
        this.settings = settings;
        this.redraw();
    }

    /** 完成钢笔路径；不足两个锚点时保留草稿继续编辑。 */
    finish(closed = false): boolean {
        if (!this.draft || this.draft.anchors.length < (closed ? 3 : 2)) return false;
        const path = { ...this.draft, closed };
        this.draft = undefined;
        this.gesture = null;
        this.setNavigation(true);
        this.commit(path);
        return true;
    }

    /** 放弃本次绘制，不触碰工程中原有路径。 */
    cancel(): void {
        this.draft = undefined;
        this.gesture = null;
        this.setNavigation(true);
        this.redraw();
    }

    /** 关闭视口时释放事件、路径几何体和材质。 */
    dispose(): void {
        this.listeners.abort();
        this.cancel();
        this.clear();
    }

    /** 把鼠标投射到当前路径高度的水平面。 */
    private project(event: PointerEvent): CanvasDirectorDeskVector3 | null {
        const raycaster = this.raycaster(event);
        const target = new Three.Vector3();
        if (!raycaster.ray.intersectPlane(new Three.Plane(new Three.Vector3(0, 1, 0), -this.settings.height), target)) return null;
        return { x: target.x, y: target.y, z: target.z };
    }

    /** 为路径和切线拾取创建屏幕射线。 */
    private raycaster(event: PointerEvent): Three.Raycaster {
        const rectangle = this.canvas.getBoundingClientRect();
        const raycaster = new Three.Raycaster();
        raycaster.setFromCamera(new Three.Vector2((event.clientX - rectangle.left) / rectangle.width * 2 - 1, -(event.clientY - rectangle.top) / rectangle.height * 2 + 1), this.camera);
        return raycaster;
    }

    /** 开始拖形状、笔迹或已有控制点。 */
    private pointerDown = (event: PointerEvent): void => {
        if (event.button !== 0 || (!this.settings.tool && !this.settings.editable)) return;
        const hit = !this.settings.tool || this.draft ? this.raycaster(event).intersectObjects(this.group.children).find((item) => item.object.userData.anchorIndex !== undefined) : undefined;
        if (!this.settings.tool && !hit) return;
        const point = this.project(event);
        if (!point) return;
        event.stopImmediatePropagation();
        this.canvas.focus();
        this.setNavigation(false);
        this.gesture = { pointerId: event.pointerId, start: point, points: [point], previous: this.draft ? structuredClone(this.draft) : undefined };
        if (hit) {
            this.gesture.anchor = { index: hit.object.userData.anchorIndex, part: hit.object.userData.anchorPart };
            if (!this.draft && this.settings.path) this.draft = structuredClone(this.settings.path);
            this.selectAnchor(this.gesture.anchor.index);
        } else if (this.settings.tool === "pen") {
            const current = this.draft || this.createPath("pen", point, point);
            if (current.anchors.length >= 128) { this.gesture = null; this.setNavigation(true); return; }
            const anchors = this.draft ? [...current.anchors, { position: point }] : [{ position: point }];
            this.draft = { ...current, anchors, closed: false };
            this.gesture.anchor = { index: anchors.length - 1, part: "outgoing" };
        } else {
            this.draft = this.createPath(this.settings.tool!, point, point);
        }
        this.canvas.setPointerCapture(event.pointerId);
        this.redraw();
    };

    /** 连续拖动只更新视口草稿，不产生自动保存或撤销记录。 */
    private pointerMove = (event: PointerEvent): void => {
        const gesture = this.gesture;
        if (!gesture || gesture.pointerId !== event.pointerId || !this.draft) return;
        event.stopImmediatePropagation();
        const point = this.project(event);
        if (!point) return;
        if (gesture.anchor) {
            const { index, part } = gesture.anchor;
            this.draft = moveMotionPathAnchor(this.draft, index, part, point);
            if (this.settings.tool === "pen" && part === "outgoing") {
                const center = this.draft.anchors[index].position;
                this.draft = moveMotionPathAnchor(this.draft, index, "incoming", { x: center.x * 2 - point.x, y: center.y * 2 - point.y, z: center.z * 2 - point.z });
            }
        } else if (this.settings.tool === "pencil") {
            const previous = gesture.points[gesture.points.length - 1];
            if (Math.hypot(point.x - previous.x, point.z - previous.z) > 0.015) gesture.points.push(point);
            this.draft = { ...this.draft, anchors: simplifyPencilPoints(gesture.points) };
        } else if (this.settings.tool) this.draft = this.createPath(this.settings.tool, gesture.start, point);
        this.redraw();
    };

    /** 拖动完成后一次提交有效路径，钢笔保留草稿等待显式结束。 */
    private pointerUp = (event: PointerEvent): void => {
        if (!this.gesture || this.gesture.pointerId !== event.pointerId) return;
        event.stopImmediatePropagation();
        this.gesture = null;
        this.setNavigation(true);
        if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
        if (this.settings.tool === "pen") return;
        const path = this.draft;
        this.draft = undefined;
        if (path && path.anchors.length >= 2 && getMotionPathCurve(path).getLength() > 0.001) this.commit(path);
        this.redraw();
    };

    /** 丢失指针或系统中断时恢复之前的钢笔草稿。 */
    private pointerCancel = (): void => {
        if (!this.gesture) return;
        this.draft = this.gesture.previous;
        this.gesture = null;
        this.setNavigation(true);
        this.redraw();
    };

    /** 提供键盘完成和取消，输入框事件不由视口接收。 */
    private keyDown = (event: KeyboardEvent): void => {
        if (event.key === "Escape") { event.preventDefault(); this.cancel(); this.cancelTool(); }
        if (event.key === "Enter" && this.settings.tool === "pen") { event.preventDefault(); this.finish(event.shiftKey); }
    };

    /** 创建继承当前工程时长及朝向策略的草稿路径。 */
    private createPath(kind: CanvasDirectorDeskPathKind, start: CanvasDirectorDeskVector3, end: CanvasDirectorDeskVector3): CanvasDirectorDeskMotionPath {
        return createDraggedMotionPath(kind, start, end, this.settings.durationMilliseconds, this.settings.followDirection);
    }

    /** 释放旧辅助几何体，避免编辑控制点时持续积累 GPU 资源。 */
    private clear(): void {
        for (const child of [...this.group.children]) {
            this.group.remove(child);
            const mesh = child as Three.Mesh;
            mesh.geometry?.dispose();
            if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
            else mesh.material?.dispose();
        }
    }

    /** 显示曲线、锚点和钢笔切线，辅助物体不参与导出。 */
    private redraw(): void {
        this.clear();
        const path = this.draft || this.settings.path;
        if (!path) { this.render(); return; }
        if (path.anchors.length >= 2) {
            const line = new Three.Line(new Three.BufferGeometry().setFromPoints(getMotionPathCurve(path).getPoints(Math.max(64, path.anchors.length * 12))), new Three.LineBasicMaterial({ color: this.settings.color, depthTest: false }));
            line.renderOrder = 10;
            this.group.add(line);
        }
        path.anchors.forEach((anchor, index) => {
            const parts = this.settings.editable || this.settings.tool === "pen" ? ["position", "incoming", "outgoing"] as const : ["position"] as const;
            parts.forEach((part) => {
                const point = anchor[part];
                if (!point) return;
                const color = part !== "position" ? this.settings.color : index === 0 ? this.settings.startColor : index === path.anchors.length - 1 ? this.settings.endColor : this.settings.color;
                const geometry = part === "position" ? new Three.SphereGeometry(0.065, 12, 8) : new Three.BoxGeometry(0.075, 0.075, 0.075);
                const mesh = new Three.Mesh(geometry, new Three.MeshBasicMaterial({ color, depthTest: false }));
                mesh.position.set(point.x, point.y + 0.025, point.z);
                mesh.userData.anchorIndex = index;
                mesh.userData.anchorPart = part;
                mesh.renderOrder = 12;
                this.group.add(mesh);
                if (part !== "position") this.group.add(new Three.Line(new Three.BufferGeometry().setFromPoints([new Three.Vector3(anchor.position.x, anchor.position.y, anchor.position.z), new Three.Vector3(point.x, point.y, point.z)]), new Three.LineBasicMaterial({ color: this.settings.color, transparent: true, opacity: 0.5, depthTest: false })));
            });
        });
        this.render();
    }
}
