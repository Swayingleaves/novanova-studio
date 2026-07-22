import assert from "node:assert/strict";
import test from "node:test";
import type { ReactElement } from "react";

import type { ToolCallState } from "@/features/chat/types";

import { VideoGeneratingCard, bindPendingVideoSize, renderPendingVideoToolCall } from "./pending-video-tool-call";

test("bindPendingVideoSize 使用前端选择的尺寸覆盖视频工具参数", () => {
    const call: ToolCallState = {
        callId: "call-video",
        name: "generate_video",
        arguments: { size: "16:9" },
        status: "executing",
        progress: 0,
    };

    const pendingCall = bindPendingVideoSize(call, "704x1280");
    const cardNode = renderPendingVideoToolCall(pendingCall) as ReactElement<{ size?: string }> | null;

    assert.notEqual(pendingCall, call);
    assert.equal(call.arguments.size, "16:9");
    assert.equal(pendingCall.arguments.size, "704x1280");
    assert.ok(cardNode);
    assert.equal(cardNode?.type, VideoGeneratingCard);
    assert.equal(cardNode?.props.size, "704x1280");
    const loadingCard = VideoGeneratingCard({ size: "704x1280" });
    assert.equal(loadingCard.props["data-pending-video-card"], "true");
});
