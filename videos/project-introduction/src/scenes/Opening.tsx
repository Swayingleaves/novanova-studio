import { CanvasImage, Interactive, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Scene, Reveal } from "../Visuals";

/** 用大字品牌和真实产品首页建立项目识别。 */
export const Opening = () => {
  const frame = useCurrentFrame();
  return <Scene label="AI 视觉创作工作台">
    <div style={{ position: "absolute", top: 245, left: 80, right: 80 }}>
      <Reveal><div className="eyebrow">让创意，持续向前</div></Reveal>
      <Interactive.Div name="品牌字标" style={{ fontFamily: "Arial, sans-serif", fontWeight: 900, fontSize: 192, lineHeight: 0.97, letterSpacing: -12, marginTop: 54, opacity: interpolate(frame, [8, 32], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>NOVA<br /><span style={{ color: "transparent", WebkitTextStroke: "2px var(--studio-ink)" }}>NOVA</span></Interactive.Div>
      <Reveal delay={22}><div style={{ fontSize: 70, marginTop: 20, letterSpacing: 7 }}>Studio<span style={{ color: "var(--studio-action)" }}> ✦</span></div></Reveal>
      <Reveal delay={36}><div className="support" style={{ marginTop: 48 }}>从一句想法<br />到完整视觉创作。</div></Reveal>
    </div>
    <Reveal delay={48} style={{ position: "absolute", top: 1180, left: 80, right: 80 }}>
      <div className="panel" style={{ height: 500 }}><CanvasImage src={staticFile("assets/home.png")} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "left center", scale: interpolate(frame, [48, 209], [1, 1.06], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }} /></div>
      <div style={{ fontSize: 26, color: "var(--studio-muted)", marginTop: 22 }}>构思 · 生成 · 编辑 · 编排</div>
    </Reveal>
  </Scene>;
};
