import { CanvasImage, Interactive, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Reveal, Scene } from "../Visuals";

/** 收束为资产复用价值，并给出项目已有的在线体验入口。 */
export const Closing = () => {
  const frame = useCurrentFrame();
  return <Scene label="开始你的下一次创作">
    <div style={{ position: "absolute", top: 245, left: 80, right: 80 }}>
      <Reveal><div className="eyebrow">让每次创作，都留下价值</div><div className="headline">灵感成形。<br /><span style={{ color: "var(--studio-action)" }}>资产沉淀。</span></div></Reveal>
      <Reveal delay={20}><div style={{ borderTop: "1px solid var(--studio-line)", borderBottom: "1px solid var(--studio-line)", padding: "32px 0", marginTop: 45 }}><div style={{ fontSize: 40, lineHeight: 1.9 }}>素材与生成记录，随时复用<br />提示词与上下文，继续积累</div></div></Reveal>
      <Reveal delay={40}><div style={{ display: "flex", gap: 28, marginTop: 50, fontSize: 29, color: "var(--studio-text)" }}><span>多渠道模型</span><span style={{ color: "var(--studio-action)" }}> / </span><span>私有化部署</span></div></Reveal>
      <Reveal delay={65}><div style={{ display: "flex", gap: 22, alignItems: "center", marginTop: 145 }}><CanvasImage src={staticFile("assets/logo.png")} style={{ width: 80, height: 80 }} /><div style={{ fontFamily: "Arial, sans-serif", fontSize: 56, fontWeight: 700 }}>Novanova Studio</div></div></Reveal>
      <Interactive.Div name="收尾主张" style={{ fontSize: 77, lineHeight: 1.35, fontWeight: 700, letterSpacing: -3, marginTop: 55, opacity: interpolate(frame, [85, 115], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>下一次创作，<br />从这里开始。</Interactive.Div>
      <Reveal delay={115}><div style={{ marginTop: 65, display: "inline-block", background: "var(--studio-action)", color: "var(--studio-action-foreground)", padding: "20px 34px", borderRadius: 8, fontSize: 34, fontWeight: 700 }}>在线体验 ↗</div><div style={{ marginTop: 30, fontSize: 38, letterSpacing: 0.5 }}>www.novanovastudio.cn</div></Reveal>
      <Reveal delay={145}><div style={{ marginTop: 85, fontSize: 29, color: "var(--studio-muted)" }}>面向独立创作者与视觉团队</div></Reveal>
    </div>
  </Scene>;
};
