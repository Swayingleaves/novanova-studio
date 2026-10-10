import { Video } from "@remotion/media";
import { interpolate, staticFile, useCurrentFrame } from "remotion";
import { Caption, Reveal, Scene } from "../Visuals";

/** 将已有视频作品与首尾帧技能的阶段示意结合展示。 */
export const VideoWorkflow = () => {
  const frame = useCurrentFrame();
  return <Scene label="视频创作">
    <div style={{ position: "absolute", top: 235, left: 80, right: 80 }}>
      <Reveal><div className="eyebrow">技能驱动的创作工作流</div><div className="headline">让画面<br /><span style={{ color: "var(--studio-action)" }}>动起来。</span></div><div className="support">澄清需求，确认提示词<br />再逐步推进生成。</div></Reveal>
      <Reveal delay={20}><div style={{ display: "flex", gap: 32, marginTop: 70, height: 750 }}>
        <div className="panel" style={{ width: 450, height: "100%" }}><Video src={staticFile("assets/editorial.mp4")} muted loop style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          {["生成首帧", "生成尾帧", "合成视频"].map((text, index) => <Reveal key={text} delay={45 + index * 45}><div style={{ borderLeft: "2px solid var(--studio-action)", padding: "26px 0 26px 28px", marginBottom: 32, background: "var(--studio-surface)", opacity: interpolate(frame, [45 + index * 45, 65 + index * 45], [0.3, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}><div style={{ fontSize: 25, color: "var(--studio-action)", marginBottom: 18 }}>阶段 {index + 1}</div><div style={{ fontSize: 37 }}>{text}</div></div></Reveal>)}
          <div style={{ fontSize: 23, color: "var(--studio-muted)", lineHeight: 1.6 }}>首尾帧技能流程示意<br />左侧为项目已有作品</div>
        </div>
      </div></Reveal>
    </div>
    <Caption>把复杂生成拆成清晰步骤<br />任务进度，实时可见。</Caption>
  </Scene>;
};
