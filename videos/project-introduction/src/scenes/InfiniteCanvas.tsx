import { CanvasImage, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Caption, Reveal, Scene } from "../Visuals";

/** 先呈现画布全景，再放大关键节点编排区域。 */
export const InfiniteCanvas = () => {
  const frame = useCurrentFrame();
  return <Scene label="无限画布">
    <div style={{ position: "absolute", top: 235, left: 80, right: 80 }}>
      <Reveal><div className="eyebrow">一个空间，连接整个过程</div><div className="headline">不止生成。<br /><span style={{ color: "var(--studio-action)" }}>更能编排。</span></div><div className="support">文字、图片、视频与任务<br />在同一张画布上继续创作。</div></Reveal>
      <Reveal delay={18}><div className="panel" style={{ height: 430, marginTop: 60 }}><CanvasImage src={staticFile("assets/canvas.png")} style={{ width: "100%", height: "100%", objectFit: "cover", scale: interpolate(frame, [20, 299], [1, 1.08], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }} /></div></Reveal>
      <Reveal delay={55}><div className="panel" style={{ height: 410, marginTop: 26 }}><CanvasImage src={staticFile("assets/canvas-detail.png")} style={{ width: "100%", height: "100%", objectFit: "cover", scale: interpolate(frame, [55, 299], [1.05, 1.2], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), translate: interpolate(frame, [55, 299], ["10px 0px", "-30px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }} /></div></Reveal>
    </div>
    <Caption>连接节点，组织结果<br />让创作成为可继续编辑的项目。</Caption>
  </Scene>;
};
