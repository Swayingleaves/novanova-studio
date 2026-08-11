import { ImageNode } from "./image-node";
import { VideoNode } from "./video-node";
import { TextNode } from "./text-node";
import { StoryboardNode } from "./storyboard-node";
import { VideoCompositionNode } from "./video-composition-node";

export const nodeTypes = {
  image: ImageNode,
  video: VideoNode,
  text: TextNode,
  storyboard: StoryboardNode,
  videoComposition: VideoCompositionNode,
};
