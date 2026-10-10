import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Easing, CanvasImage, interpolate, staticFile, useCurrentFrame } from "remotion";

/** 为分镜提供统一的品牌角标、安全边距和低对比网格。 */
export const Scene = ({ children, label }: { children: ReactNode; label: string }) => (
  <AbsoluteFill className="scene">
    <AbsoluteFill style={{ backgroundImage: "radial-gradient(var(--studio-line) 1px, transparent 1px)", backgroundSize: "36px 36px", opacity: 0.33 }} />
    <div style={{ position: "absolute", left: 80, right: 80, top: 80, display: "flex", alignItems: "center", gap: 16 }}>
      <CanvasImage src={staticFile("assets/logo.png")} style={{ width: 44, height: 44 }} />
      <span style={{ fontSize: 23, letterSpacing: 1 }}>Novanova Studio</span>
      <span style={{ marginLeft: "auto", fontSize: 23, color: "var(--studio-muted)" }}>{label}</span>
    </div>
    {children}
  </AbsoluteFill>
);

/** 根据当前分镜帧执行文字与面板的延迟入场。 */
export const Reveal = ({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: CSSProperties }) => {
  const frame = useCurrentFrame();
  return <div style={{ ...style, opacity: interpolate(frame, [delay, delay + 24], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), translate: interpolate(frame, [delay, delay + 30], ["0px 40px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) }) }}>{children}</div>;
};

/** 在手机画面底部展示可读的单句功能说明。 */
export const Caption = ({ children }: { children: ReactNode }) => (
  <div style={{ position: "absolute", left: 80, right: 80, bottom: 144, borderTop: "1px solid var(--studio-line)", paddingTop: 28, fontSize: 37, lineHeight: 1.65, color: "var(--studio-text)" }}>{children}</div>
);
