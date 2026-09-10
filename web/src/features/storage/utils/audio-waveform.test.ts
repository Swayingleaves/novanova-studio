import assert from "node:assert/strict";
import test from "node:test";
import { extractWaveformPeaks, formatAudioTime } from "./audio-waveform.ts";

test("波形反映全部声道的真实峰值，静音保持为零", () => {
    const left = new Float32Array(256);
    const right = new Float32Array(256);
    left[10] = -0.8;
    right[11] = 0.9;
    const peaks = extractWaveformPeaks([left, right]);
    assert.equal(peaks.length, 128);
    assert.equal(peaks[5], 0.9);
    assert.equal(peaks[6], 0);
    assert.deepEqual(extractWaveformPeaks([new Float32Array(128)]), Array(128).fill(0));
});

test("时长支持分钟跨界及长音频", () => {
    assert.equal(formatAudioTime(4.9), "00:04");
    assert.equal(formatAudioTime(60), "01:00");
    assert.equal(formatAudioTime(3601), "60:01");
});
