import assert from "node:assert/strict";
import test from "node:test";

import { availableTextTrackPlacement, buildShotIntervals, clampPreviewPosition, clampTimelineStart, reorderTimelineTexts, timelineTextOverlaps, visibleTimelineTexts, voiceTrackEndMs, voiceTrackSourceTimeMs } from "./storyboard-timeline";
import type { ComicDramaShot, ComicDramaTimelineText, ComicDramaVoiceTrack } from "../types";

test("镜头区间按完整项目排序并使用真实时长，不受分集筛选影响", () => {
    const shots = [{ id: "second", sortOrder: 2 }, { id: "first", sortOrder: 1 }] as ComicDramaShot[];
    assert.deepEqual(buildShotIntervals(shots, (shot) => shot.id === "first" ? 0.8 : 2.1).map(({ shot, startMs, endMs }) => [shot.id, startMs, endMs]), [
        ["first", 0, 800], ["second", 800, 2900],
    ]);
});

test("文字在起点显示，在终点消失，能跨镜头", () => {
    const text = { id: "title", startMs: 700, endMs: 1300 } as ComicDramaTimelineText;
    assert.deepEqual(visibleTimelineTexts([text], 700), [text]);
    assert.deepEqual(visibleTimelineTexts([text], 1299), [text]);
    assert.deepEqual(visibleTimelineTexts([text], 1300), []);
});

test("同轨时间冲突时选择下一轨，最多三轨，边界相接不冲突", () => {
    const texts = [0, 1, 2].map((trackNumber) => ({ id: String(trackNumber), trackNumber, startMs: 1000, endMs: 4000 })) as ComicDramaTimelineText[];
    assert.deepEqual(availableTextTrackPlacement(texts.slice(0, 1), 2000, 6000), { trackNumber: 1, endMs: 5000 });
    assert.deepEqual(availableTextTrackPlacement(texts.slice(0, 2), 2000, 6000), { trackNumber: 2, endMs: 5000 });
    assert.equal(availableTextTrackPlacement(texts, 2000, 6000), null);
    assert.deepEqual(availableTextTrackPlacement(texts, 4000, 6000), { trackNumber: 0, endMs: 6000 });
    assert.deepEqual(availableTextTrackPlacement(texts, 500, 6000), { trackNumber: 0, endMs: 1000 });
    assert.equal(timelineTextOverlaps(texts[0], { startMs: 4000, endMs: 5000 }), false);
});

test("文字片段拖动方向的边缘越过相邻片段中心后换位，保留时长与轨道空隙", () => {
    const texts = [
        { id: "A", startMs: 0, endMs: 1000, trackNumber: 0 },
        { id: "B", startMs: 1500, endMs: 3500, trackNumber: 0 },
        { id: "C", startMs: 4000, endMs: 5000, trackNumber: 0 },
        { id: "other", startMs: 0, endMs: 5000, trackNumber: 1 },
    ] as ComicDramaTimelineText[];
    assert.deepEqual(reorderTimelineTexts(texts, "B", 499).map(({ id, startMs, endMs }) => [id, startMs, endMs]), [
        ["B", 0, 2000], ["A", 2500, 3500],
    ]);
    assert.deepEqual(reorderTimelineTexts(texts, "B", 2501).map(({ id, startMs, endMs }) => [id, startMs, endMs]), [
        ["C", 1500, 2500], ["B", 3000, 5000],
    ]);
    assert.deepEqual(reorderTimelineTexts(texts, "B", 2400), []);
    assert.deepEqual(reorderTimelineTexts(texts, "B", 500), []);
    assert.deepEqual(reorderTimelineTexts(texts, "B", 2500), []);
    assert.deepEqual(reorderTimelineTexts(texts, "C", 499).map(({ id, startMs, endMs }) => [id, startMs, endMs]), [
        ["C", 0, 1000], ["A", 1500, 2500], ["B", 3000, 5000],
    ]);
});

test("音频裁剪区间准确映射到源文件，移出轨道后不播放", () => {
    const track = { timelineStartMs: 2000, trimStartMs: 500, trimEndMs: 2500 } as ComicDramaVoiceTrack;
    assert.equal(voiceTrackEndMs(track), 4000);
    assert.equal(voiceTrackSourceTimeMs(track, 1999), null);
    assert.equal(voiceTrackSourceTimeMs(track, 3000), 1500);
    assert.equal(voiceTrackSourceTimeMs(track, 4000), null);
    assert.equal(voiceTrackEndMs({ ...track, timelineStartMs: null }), null);
});

test("拖动片段起点时保持长度并限制在项目范围", () => {
    assert.equal(clampTimelineStart(-100, 500, 2000), 0);
    assert.equal(clampTimelineStart(1800, 500, 2000), 1500);
});

test("预览叠字中心不越过实际画面，文字宽于画面时固定居中", () => {
    assert.equal(clampPreviewPosition(-0.3, 200, 1000), 0.1);
    assert.equal(clampPreviewPosition(0.9, 200, 1000), 0.9);
    assert.equal(clampPreviewPosition(0.9, 1200, 1000), 0.5);
});
