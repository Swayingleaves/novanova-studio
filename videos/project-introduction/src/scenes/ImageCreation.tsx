import { CanvasImage, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Caption, Reveal, Scene } from "../Visuals";

/** 以真实风格库局部展示图片创作能力。 */
export const ImageCreation = () => {
  const frame = useCurrentFrame();
  return <Scene label="图片创作">
    <div style={{ position: "absolute", top: 250, left: 80, right: 80 }}>
      <Reveal><div className="eyebrow">把想象，变成画面</div><div className="headline">一种想法。<br /><span style={{ color: "var(--studio-action)" }}>多种表达。</span></div><div className="support">文字生成 · 参考图编辑<br />风格选择 · 持续迭代</div></Reveal>
      <Reveal delay={20}><div className="panel" style={{ height: 760, marginTop: 66 }}><CanvasImage src={staticFile("assets/styles.png")} style={{ width: "100%", height: "100%", objectFit: "cover", scale: interpolate(frame, [20, 269], [1, 1.05], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }} /></div></Reveal>
      <Reveal delay={65}><div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 30, color: "var(--studio-text)", marginTop: 34 }}><span style={{ width: 8, height: 8, background: "var(--studio-action)", borderRadius: 4 }} />项目真实风格库画面</div></Reveal>
    </div>
    <Caption>从参考素材开始<br />生成、比较，再继续完善。</Caption>
  </Scene>;
};
