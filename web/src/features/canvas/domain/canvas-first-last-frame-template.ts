import { translateMessage as translate } from "@/features/locale/translate";

import { CANVAS_BACKGROUND_LABEL_DEFAULT_FONT_SIZE, CANVAS_BACKGROUND_PADDING, getCanvasNodeTemplate, createBackgroundNode, createImageNode, createVideoNode } from "../constants.ts";
import { applyCanvasNodeAttributes, updateCanvasNodeFrame } from "./canvas-node.ts";
import { createBackgroundLabel, createCanvasConnection } from "./canvas-page-node.ts";
import type { CanvasConnection, CanvasNode, CanvasPoint } from "../types.ts";

/** 说明放在成员数量角标下方，避免和左上角「N 个节点」重叠。 */
const LABEL_X = 24;
const LABEL_Y = 36;
/** 节点标题画在框体上方：text-xs 加上下内边距约 24px，再留 8px 间距。 */
const NODE_TITLE_HEIGHT = 24;
const NODE_TITLE_GAP = 8;
const LABEL_LINE_HEIGHT = Math.round(CANVAS_BACKGROUND_LABEL_DEFAULT_FONT_SIZE * 1.4);
/** 图片顶边要低于说明，并给浮在节点上方的标题留出位置。 */
const IMAGE_TOP = LABEL_Y + LABEL_LINE_HEIGHT + NODE_TITLE_HEIGHT + NODE_TITLE_GAP * 2;
/** 尾帧排在首帧下方，中间留出尾帧标题的高度。 */
const IMAGE_STACK_GAP = NODE_TITLE_HEIGHT + NODE_TITLE_GAP * 2;
/** 视频节点留在背景板右侧，给连线留出弯曲空间。 */
const VIDEO_GAP = 96;

/**
 * 在指定中心点生成首尾帧视频模板。
 *
 * @param center 整组节点的中心，包含背景板和右侧视频节点
 * @param createId 为节点、说明和连线分配标识
 * @return 背景板、首帧、尾帧、视频节点，以及按首帧、尾帧顺序连到视频节点的连线
 */
export function createFirstLastFrameVideoTemplate(center: CanvasPoint, createId: () => string): { nodes: CanvasNode[]; connections: CanvasConnection[] } {
    const imageTemplate = getCanvasNodeTemplate("image");
    const videoTemplate = getCanvasNodeTemplate("video");
    const boardWidth = CANVAS_BACKGROUND_PADDING + imageTemplate.width + CANVAS_BACKGROUND_PADDING;
    const boardHeight = IMAGE_TOP + imageTemplate.height + IMAGE_STACK_GAP + imageTemplate.height + CANVAS_BACKGROUND_PADDING;
    const videoY = IMAGE_TOP + (imageTemplate.height + IMAGE_STACK_GAP + imageTemplate.height) / 2 - videoTemplate.height / 2;
    const groupWidth = boardWidth + VIDEO_GAP + videoTemplate.width;
    const groupHeight = Math.max(boardHeight, videoY + videoTemplate.height);
    const originX = center.x - groupWidth / 2;
    const originY = center.y - groupHeight / 2;

    const firstFrame = createImageNode({
        id: createId(),
        title: translate("canvas.firstFrame"),
        position: { x: originX + CANVAS_BACKGROUND_PADDING, y: originY + IMAGE_TOP },
    });
    const lastFrame = createImageNode({
        id: createId(),
        title: translate("canvas.lastFrame"),
        position: { x: firstFrame.frame.position.x, y: firstFrame.frame.position.y + imageTemplate.height + IMAGE_STACK_GAP },
    });
    const video = applyCanvasNodeAttributes(createVideoNode({
        id: createId(),
        position: { x: originX + boardWidth + VIDEO_GAP, y: originY + videoY },
    }), { videoGenerationMode: "first-last-frame-to-video" });
    const board = updateCanvasNodeFrame(createBackgroundNode({
        id: createId(),
        position: { x: originX, y: originY },
        memberNodeIds: [firstFrame.id, lastFrame.id],
    }), { width: boardWidth, height: boardHeight });
    const label = createBackgroundLabel({
        id: createId(),
        text: translate("canvas.useFirstAndLastFramesToGenerateVideo"),
        x: LABEL_X,
        y: LABEL_Y,
    }, board.frame.width, board.frame.height);

    return {
        nodes: [{ ...board, labels: [label] }, firstFrame, lastFrame, video],
        connections: [
            createCanvasConnection(createId(), firstFrame.id, video.id, "right", "left"),
            createCanvasConnection(createId(), lastFrame.id, video.id, "right", "left"),
        ],
    };
}
