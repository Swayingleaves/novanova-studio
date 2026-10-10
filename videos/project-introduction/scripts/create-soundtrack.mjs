import { writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const sampleRate = 44100;
const duration = 55;
const beatDuration = 60 / 104;
const chords = [[130.813, 164.814, 195.998, 246.942], [110, 130.813, 164.814, 195.998], [87.307, 110, 130.813, 164.814], [97.999, 123.471, 146.832, 195.998]];
const samples = new Float32Array(sampleRate * duration * 2);

/** 通过固定种子的噪声序列，让每次导出的打击乐保持一致。 */
let noiseState = 7;
const noise = () => {
  noiseState = (Math.imul(noiseState, 1664525) + 1013904223) >>> 0;
  return (noiseState / 4294967296) * 2 - 1;
};

/** 将柔和和弦、低音、琶音与轻打击合成为原创配乐。 */
for (let index = 0; index < sampleRate * duration; index++) {
  const time = index / sampleRate;
  const beat = time / beatDuration;
  const chord = chords[Math.floor(beat / 8) % chords.length];
  const phase = time % beatDuration;
  const halfPhase = time % (beatDuration / 2);
  const fade = Math.min(time / 1.5, 1, (duration - time) / 3);
  let pad = 0;
  for (let note = 0; note < chord.length; note++) {
    pad += Math.sin(2 * Math.PI * chord[note] * time + 0.008 * Math.sin(time * 1.4)) * 0.025;
    pad += Math.sin(2 * Math.PI * chord[note] * 2.002 * time) * 0.007;
  }
  const kick = Math.sin(2 * Math.PI * (47 * phase + 10 * (1 - Math.exp(-phase * 32)))) * Math.exp(-phase * 18) * 0.14;
  const bass = Math.sin(2 * Math.PI * chord[0] * 0.5 * time) * Math.exp(-phase * 3) * 0.075;
  const arpeggioNote = chord[Math.floor(beat * 2) % 4] * 4;
  const arpeggio = (Math.sin(2 * Math.PI * arpeggioNote * time) + Math.sin(2 * Math.PI * arpeggioNote * 2 * time) * 0.2) * Math.exp(-halfPhase * 11) * 0.04;
  const percussion = noise() * Math.exp(-halfPhase * 120) * 0.026;
  const stereoMotion = Math.sin(time * 0.75) * 0.15;
  samples[index * 2] = (pad + kick + bass + arpeggio * (1 + stereoMotion) + percussion) * fade;
  samples[index * 2 + 1] = (pad + kick + bass + arpeggio * (1 - stereoMotion) + percussion) * fade;
}

// 标准音频封装与响度处理交给 FFmpeg，避免手写格式编码。
const rawPath = fileURLToPath(new URL("../out/soundtrack.f32", import.meta.url));
const outputPath = fileURLToPath(new URL("../public/assets/soundtrack.wav", import.meta.url));
writeFileSync(rawPath, Buffer.from(samples.buffer));
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "f32le", "-ar", String(sampleRate), "-ac", "2", "-i", rawPath, "-af", "loudnorm=I=-19:TP=-2:LRA=7", "-ar", String(sampleRate), "-c:a", "pcm_s16le", outputPath]);
unlinkSync(rawPath);
console.info("原创背景音乐已生成：55 秒，104 拍每分钟。");
