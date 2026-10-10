import { Composition, Folder } from "remotion";
import { ProjectIntroduction } from "./Composition";
import { Opening } from "./scenes/Opening";
import { Agent } from "./scenes/Agent";
import { ImageCreation } from "./scenes/ImageCreation";
import { VideoWorkflow } from "./scenes/VideoWorkflow";
import { InfiniteCanvas } from "./scenes/InfiniteCanvas";
import { Closing } from "./scenes/Closing";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="NovanovaIntroduction" component={ProjectIntroduction} durationInFrames={1650} fps={30} width={1080} height={1920} />
      <Folder name="分镜">
        <Composition id="Opening" component={Opening} durationInFrames={210} fps={30} width={1080} height={1920} />
        <Composition id="Agent" component={Agent} durationInFrames={285} fps={30} width={1080} height={1920} />
        <Composition id="ImageCreation" component={ImageCreation} durationInFrames={270} fps={30} width={1080} height={1920} />
        <Composition id="VideoWorkflow" component={VideoWorkflow} durationInFrames={300} fps={30} width={1080} height={1920} />
        <Composition id="InfiniteCanvas" component={InfiniteCanvas} durationInFrames={300} fps={30} width={1080} height={1920} />
        <Composition id="Closing" component={Closing} durationInFrames={360} fps={30} width={1080} height={1920} />
      </Folder>
    </>
  );
};
