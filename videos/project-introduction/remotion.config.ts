/** 命令行渲染配置；使用 Node.js 接口时需要显式传入同样参数。 */

import { Config } from "@remotion/cli/config";

Config.setRspack(true);
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
// 固定软件图形渲染，避免当前 Windows 环境的文字图层裁切。
Config.setChromiumOpenGlRenderer("swangle");
