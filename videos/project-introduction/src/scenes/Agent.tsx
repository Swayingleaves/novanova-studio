import { Interactive, interpolate, useCurrentFrame } from "remotion";
import { Caption, Reveal, Scene } from "../Visuals";

/** 用逐字输入和任务状态展示 Agent 的意图理解与工具调用。 */
export const Agent = () => {
  const frame = useCurrentFrame();
  const prompt = "为我的新品牌，创作一组电影感视觉。";
  return <Scene label="对话式创作">
    <div style={{ position: "absolute", top: 250, left: 80, right: 80 }}>
      <Reveal><div className="eyebrow">AI AGENT · 智能创作助手</div><div className="headline">你说想法。<br /><span style={{ color: "var(--studio-action)" }}>它来推进。</span></div><div className="support">理解目标，选择工具<br />把每一步创作连接起来。</div></Reveal>
      <Reveal delay={18}><div className="panel" style={{ padding: 38, marginTop: 85 }}>
        <div style={{ fontSize: 27, color: "var(--studio-action)", marginBottom: 32 }}>✦ Novanova Agent</div>
        <Interactive.Div name="示例创作目标" style={{ fontSize: 44, lineHeight: 1.65, minHeight: 180 }}>{prompt.slice(0, Math.floor(interpolate(frame, [30, 95], [0, prompt.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })))}<span style={{ color: "var(--studio-action)", opacity: Math.floor(frame / 15) % 2 ? 0 : 1 }}>│</span></Interactive.Div>
        <div style={{ borderTop: "1px solid var(--studio-line)", paddingTop: 25, marginTop: 25, color: "var(--studio-muted)", fontSize: 25 }}>参考素材　 /　资产库　 /　提示词库</div>
      </div></Reveal>
      <div style={{ marginTop: 48 }}>
        {["理解创作目标", "选择生成与编辑工具", "保留结果，继续下一轮"].map((text, index) => <Reveal key={text} delay={102 + index * 26}><div style={{ display: "flex", gap: 22, alignItems: "center", padding: "22px 0", fontSize: 35 }}><span style={{ color: "var(--studio-action)", fontSize: 32 }}>✓</span>{text}</div></Reveal>)}
      </div>
    </div>
    <Caption>保留创作上下文<br />让每一次修改，都接得上。</Caption>
  </Scene>;
};
