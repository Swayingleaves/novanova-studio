import { AbsoluteFill, interpolate, staticFile } from "remotion";
import { Audio } from "@remotion/media";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Opening } from "./scenes/Opening";
import { Agent } from "./scenes/Agent";
import { ImageCreation } from "./scenes/ImageCreation";
import { VideoWorkflow } from "./scenes/VideoWorkflow";
import { InfiniteCanvas } from "./scenes/InfiniteCanvas";
import { Closing } from "./scenes/Closing";
import "./style.css";

/** 通过五次半秒交叉淡化，串联六段分镜与配乐。 */
export const ProjectIntroduction = () => (
  <AbsoluteFill style={{ backgroundColor: "var(--studio-page)" }}>
    <Audio src={staticFile("assets/soundtrack.wav")} volume={(frame) => interpolate(frame, [0, 45, 1560, 1649], [0, 0.8, 0.8, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={210} name="品牌开场"><Opening /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />
      <TransitionSeries.Sequence durationInFrames={285} name="对话驱动创作"><Agent /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />
      <TransitionSeries.Sequence durationInFrames={270} name="图片与风格"><ImageCreation /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />
      <TransitionSeries.Sequence durationInFrames={300} name="视频技能工作流"><VideoWorkflow /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />
      <TransitionSeries.Sequence durationInFrames={300} name="无限画布"><InfiniteCanvas /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />
      <TransitionSeries.Sequence durationInFrames={360} name="资产沉淀与体验入口"><Closing /></TransitionSeries.Sequence>
    </TransitionSeries>
  </AbsoluteFill>
);
