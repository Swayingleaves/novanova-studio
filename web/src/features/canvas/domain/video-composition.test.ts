import assert from "node:assert/strict";
import test from "node:test";

import { createTextNode, createVideoCompositionNode, createVideoNode } from "../constants.ts";
import { readVideoCompositionConnectionError, canComposeVideo, reorderVideoCompositionInputIds, synchronizeVideoCompositionInputs } from "./video-composition.ts";

test("合成视频节点只接收直接视频输入，且限制重复和最多二十段", () => {
    const composition = createVideoCompositionNode({ id: "composition-1", position: { x: 0, y: 0 } });
    const text = createTextNode({ id: "text-1", position: { x: 0, y: 0 } });
    const videos = Array.from({ length: 21 }, (_, index) => createVideoNode({ id: `video-${index + 1}`, position: { x: index * 20, y: 0 } }));
    const nodes = [composition, text, ...videos];
    const connections = videos.slice(0, 20).map((video, index) => ({
        id: `connection-${index + 1}`,
        source: { nodeId: video.id },
        target: { nodeId: composition.id },
    }));

    assert.equal(readVideoCompositionConnectionError(text.id, composition.id, nodes, []), "合成视频节点仅支持直接连接视频节点");
    assert.equal(readVideoCompositionConnectionError(videos[0].id, composition.id, nodes, connections), "该视频已经连接到合成视频节点");
    assert.equal(readVideoCompositionConnectionError(videos[20].id, composition.id, nodes, connections), "单个合成视频节点最多连接20段视频");
});

test("合成视频输入随连线变化同步，并保留用户调整后的顺序", () => {
    const composition = createVideoCompositionNode({ id: "composition-1", position: { x: 0, y: 0 } });
    composition.composition.inputVideoNodeIds = ["video-2", "missing", "video-1"];
    const video1 = createVideoNode({ id: "video-1", position: { x: 0, y: 0 } });
    const video2 = createVideoNode({ id: "video-2", position: { x: 0, y: 0 } });
    const video3 = createVideoNode({ id: "video-3", position: { x: 0, y: 0 } });

    const synchronized = synchronizeVideoCompositionInputs(
        [composition, video1, video2, video3],
        [
            { id: "connection-1", source: { nodeId: "video-1" }, target: { nodeId: "composition-1" } },
            { id: "connection-2", source: { nodeId: "video-2" }, target: { nodeId: "composition-1" } },
            { id: "connection-3", source: { nodeId: "video-3" }, target: { nodeId: "composition-1" } },
        ],
    );
    const nextComposition = synchronized.find((node) => node.id === "composition-1");

    assert.equal(nextComposition?.kind, "videoComposition");
    if (nextComposition?.kind !== "videoComposition") throw new Error("应存在合成视频节点");
    assert.deepEqual(nextComposition.composition.inputVideoNodeIds, ["video-2", "video-1", "video-3"]);
    assert.deepEqual(reorderVideoCompositionInputIds(nextComposition.composition.inputVideoNodeIds, "video-3", "video-2"), ["video-3", "video-2", "video-1"]);
});

test("合成按钮仅在全部输入视频成功且已持久化时可用", () => {
    const composition = createVideoCompositionNode({ id: "composition-1", position: { x: 0, y: 0 } });
    composition.composition.inputVideoNodeIds = ["video-1", "video-2"];
    const video1 = createVideoNode({ id: "video-1", position: { x: 0, y: 0 } });
    const video2 = createVideoNode({ id: "video-2", position: { x: 0, y: 0 } });
    video1.execution = { phase: "succeeded" };
    video1.content.storageKey = "video:first";
    video2.execution = { phase: "running" };
    video2.content.storageKey = "video:second";
    const videoById = new Map([[video1.id, video1], [video2.id, video2]]);

    assert.equal(canComposeVideo(composition, videoById), false);
    video2.execution = { phase: "succeeded" };
    assert.equal(canComposeVideo(composition, videoById), true);
});
