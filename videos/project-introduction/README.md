# Novanova Studio 项目介绍视频

中文竖屏产品短片，使用 Remotion 制作。视频工程独立于 `web/` 与 `server/`，不修改业务逻辑。

| 参数 | 内容 |
| --- | --- |
| 主合成 | `NovanovaIntroduction` |
| 画幅 | 1080 × 1920，9:16 |
| 时长 | 55 秒，共 1650 帧 |
| 帧率 | 30 帧每秒 |
| 成片 | `out/novanova-studio-introduction.mp4` |
| 声音 | 原创轻电子背景音乐，屏幕中文文案，无配音 |
| 视觉 | 项目近黑主题、黄绿色操作色、紫粉品牌标识 |

## 分镜

场景之间使用 15 帧交叉淡化，相邻场景的时间因此有重叠。

| 时间 | 场景 | 主要内容 |
| --- | --- | --- |
| 0～7 秒 | 品牌开场 | 从一句想法到完整视觉创作 |
| 6.5～16 秒 | 对话驱动创作 | 意图理解、工具选择、连续上下文 |
| 15.5～24.5 秒 | 图片创作 | 文字生成、参考图编辑、风格库 |
| 24～34 秒 | 视频工作流 | 需求澄清、提示词确认、首尾帧技能阶段 |
| 33.5～43.5 秒 | 无限画布 | 节点编排、生成结果与项目上下文 |
| 43～55 秒 | 资产沉淀与入口 | 素材、记录、提示词复用与在线体验 |

## 使用

1. 在本目录安装依赖。

   ```powershell
   npm install
   ```

2. 开启可编辑的 Remotion Studio。

   ```powershell
   npm run dev
   ```

   主合成地址：http://localhost:3300/NovanovaIntroduction 。每个分镜也独立注册，可单独调整。

3. 导出 MP4。

   ```powershell
   npm run render
   ```

4. 需要重制背景音乐时，先安装 FFmpeg，再执行以下命令。

   ```powershell
   npm run soundtrack
   ```

## 内容与素材来源

- 文案根据项目 `README.md` 的定位与功能编写；颜色来自 `UI-DESIGN.md`。
- 首页：`github_images/nova-s1.png`。
- 画布：`github_images/nova-s2.png`；`canvas-detail.png` 为原图局部裁切。
- 风格库：`github_images/fgk.png`；`styles.png` 为原图局部裁切。
- 品牌标识：`logo/novanovastudio-108x108.png`。
- 视频作品：`web/public/homepage/novanova-black-editorial.mp4`，使用时静音。
- `Agent` 场景是创作交互示意；视频技能阶段是流程示意，未宣称左侧作品由该流程生成。
- 配乐由 `scripts/create-soundtrack.mjs` 合成，无外部音乐下载。
- 当前渲染使用 Windows 已安装的微软雅黑；跨平台重渲染需安装同款字体以保持文字布局。

## 编辑入口

- `src/scenes/`：六个场景的文案与布局。
- `src/Composition.tsx`：场景顺序、交叉淡化和音量包络。
- `src/Root.tsx`：尺寸、帧率、合成时长与分镜注册。
- `src/style.css`：独立视频的品牌颜色与文字样式。
- `public/assets/`：图片、作品视频、配乐。

渲染配置固定使用 `swangle` 软件图形渲染，避免当前 Windows 浏览器运行时出现文字图层裁切。

输出和依赖目录已忽略，不会提交成片或依赖；视频源代码与所用素材可以独立提交。
