import assert from "node:assert/strict";
import test from "node:test";
import type { ReactElement } from "react";

import type { ToolCallState } from "@/features/chat/types";

import { ImageGeneratingCard, isPendingImageToolCall, renderPendingImageToolCall } from "./pending-image-tool-call";

test("isPendingImageToolCall 只识别生图和图片编辑工具", () => {
    const imageCall: ToolCallState = {
        callId: "call-image",
        name: "generate_image",
        arguments: {},
        status: "executing",
        progress: 0,
    };
    const editCall: ToolCallState = {
        callId: "call-edit",
        name: "edit_image",
        arguments: {},
        status: "executing",
        progress: 0,
    };
    const videoCall: ToolCallState = {
        callId: "call-video",
        name: "generate_video",
        arguments: {},
        status: "executing",
        progress: 0,
    };

    assert.equal(isPendingImageToolCall(imageCall), true);
    assert.equal(isPendingImageToolCall(editCall), true);
    assert.equal(isPendingImageToolCall(videoCall), false);
});

test("renderPendingImageToolCall 为图片工具返回纯Loading卡片", () => {
    const imageCall: ToolCallState = {
        callId: "call-image",
        name: "generate_image",
        arguments: {},
        status: "executing",
        progress: 0,
    };
    const videoCall: ToolCallState = {
        callId: "call-video",
        name: "generate_video",
        arguments: {},
        status: "executing",
        progress: 0,
    };

    const imageNode = renderPendingImageToolCall(imageCall) as ReactElement | null;
    const videoNode = renderPendingImageToolCall(videoCall);
    const cardNode = ImageGeneratingCard({});

    assert.ok(imageNode);
    assert.equal(imageNode?.type, ImageGeneratingCard);
    assert.equal(videoNode, null);
    assert.equal(cardNode.props["data-pending-image-card"], "true");
});
