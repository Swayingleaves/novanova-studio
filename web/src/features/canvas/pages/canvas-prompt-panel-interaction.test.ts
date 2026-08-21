import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const canvasPageSource = readFileSync(new URL("./canvas-client-page.tsx", import.meta.url), "utf8");
const promptPanelSource = readFileSync(new URL("../components/canvas-node-prompt-panel.tsx", import.meta.url), "utf8");
const imageSettingsPopoverSource = readFileSync(new URL("../components/canvas-image-settings-popover.tsx", import.meta.url), "utf8");
const videoSettingsPopoverSource = readFileSync(new URL("../components/canvas-video-settings-popover.tsx", import.meta.url), "utf8");
const imageSettingsPanelSource = readFileSync(new URL("../../generation/components/image-settings-panel.tsx", import.meta.url), "utf8");
const videoSettingsPanelSource = readFileSync(new URL("../../generation/components/video-settings-panel.tsx", import.meta.url), "utf8");
const imageTaskProviderSource = readFileSync(new URL("../../generation/api/image-task-provider.ts", import.meta.url), "utf8");
const interactionSelectorLine = canvasPageSource.split("\n").find((line) => line.includes("PROMPT_PANEL_INTERACTION_IGNORE_SELECTOR")) || "";

test("画布提示面板将模型选择器 Portal 识别为内部交互", () => {
    assert.ok(interactionSelectorLine.includes('[data-slot="select-content"]'), "提示面板交互白名单缺少 Radix Select Portal 标识");
});

test("节点内部按下鼠标时不提前关闭提示面板", () => {
    assert.ok(interactionSelectorLine.includes(".react-flow__node"), "提示面板交互白名单缺少 React Flow 节点标识");
});

test("首次从连线构建引用提示词时记录已有标签", () => {
    const emptyPromptBranch = promptPanelSource.match(/if \(nodePrompt === ""\) \{([\s\S]*?)return;/)?.[1] || "";

    assert.ok(emptyPromptBranch.includes("prevLabelsRef.current = requiredLabels"), "空提示词初始化时未记录已有引用标签，会重复追加图片引用");
});

test("节点提示面板展示已持久化的生成参考图", () => {
    assert.ok(promptPanelSource.includes("buildNodeGenerationReferences(node)"), "提示面板未读取节点已保存的生成参考图");
    assert.ok(promptPanelSource.includes("canInsert: false"), "已保存的生成参考图不应作为连线标签写回提示词");
});

test("视频节点参考图支持放大预览", () => {
    assert.ok(promptPanelSource.includes('mode === "video" && reference.kind === "image"'), "视频节点未识别可预览的参考图");
    assert.ok(promptPanelSource.includes('title="放大查看参考图"'), "参考图缺少放大查看入口");
    assert.ok(promptPanelSource.includes("setReferencePreview(reference)"), "参考图点击后未打开预览");
});

test("图片和视频节点提供AI提示词优化入口", () => {
    assert.ok(promptPanelSource.includes('title="AI优化提示词"'), "提示面板缺少AI提示词优化说明");
    assert.ok(promptPanelSource.includes("<Sparkles"), "提示面板缺少Sparkles图标");
    assert.ok(promptPanelSource.includes("onGeneratePrompt(\n                                        node.id") && promptPanelSource.includes("updatePrompt,"), "优化结果未回填当前节点输入框");
});

test("文本图片和视频节点的发送按钮显示积分消耗", () => {
    assert.ok(promptPanelSource.includes("const creditCost =") && promptPanelSource.includes("requestCreditCost({"), "提示面板未根据当前节点配置计算积分消耗");
    assert.ok(promptPanelSource.includes("taskCount: normalizeVideoGenerationCount(config.count)"), "视频节点积分未按实际创建的视频任务数量累计");
    assert.ok(promptPanelSource.includes("normalizeModelOptionValue(generation?.model"), "画布节点模型未规范化为积分配置使用的渠道模型标识");
    assert.ok(canvasPageSource.includes("const model = normalizeModelOptionValue(generation?.model"), "画布实际生成任务未使用与积分计算一致的渠道模型标识");
    assert.ok(promptPanelSource.includes("<CreditCostDisplay creditCost={creditCost}"), "发送按钮未显示积分图标与数值");
    assert.ok(promptPanelSource.includes("!min-w-[88px]"), "发送按钮宽度不足，积分内容可能被压缩隐藏");
});

test("节点生成工具和提交操作保持在同一行", () => {
    assert.ok(promptPanelSource.includes('className="mt-2 flex min-w-0 items-center gap-2"'), "节点生成工具栏仍允许提交操作换行");
    assert.ok(promptPanelSource.includes('className="flex min-w-0 flex-1 items-center gap-2"'), "节点生成配置区未预留提交操作空间");
    assert.ok(promptPanelSource.includes('className="!h-10 !min-w-0 flex-1"'), "模型选择器无法收缩，长模型名称会挤压提交操作");
    assert.ok(promptPanelSource.includes('buttonClassName="!h-10 !w-[140px]'), "节点生成设置按钮未限制稳定宽度");
});

test("画布图片设置按画质清晰度比例和限定数量排列", () => {
    assert.ok(imageSettingsPanelSource.includes('<Field label="画质"'), "图片设置缺少独立画质配置");
    assert.ok(imageSettingsPanelSource.includes('<Field label="清晰度"'), "图片设置缺少1K、2K、4K清晰度配置");
    assert.ok(imageSettingsPanelSource.includes('<Field label="比例"'), "图片设置缺少独立比例配置");
    assert.ok(!imageSettingsPanelSource.includes('<Field label="尺寸"'), "图片设置仍保留像素尺寸配置");
    assert.ok(!imageSettingsPanelSource.includes("explicitSize"), "比例选项仍混合分辨率和宽高比");
    assert.ok(imageSettingsPanelSource.includes("const IMAGE_COUNT_PRESETS = [1, 2, 4]"), "生成数量未严格限制为1、2、4");
    assert.ok(imageSettingsPopoverSource.includes("width={420}"), "图片设置浮层宽度不足以容纳五列比例布局");
    assert.ok(imageTaskProviderSource.includes("resolution: config.imageResolution"), "图片清晰度未传入后端任务参数");
});

test("画布视频设置按比例清晰度时长和限定数量排列", () => {
    assert.ok(videoSettingsPanelSource.includes('<Field label="比例"'), "视频设置缺少独立比例配置");
    assert.ok(videoSettingsPanelSource.includes('<Field label="清晰度"'), "视频设置缺少清晰度配置");
    assert.ok(videoSettingsPanelSource.includes('<Field label="视频时长"'), "视频设置缺少滑块时长配置");
    assert.ok(videoSettingsPanelSource.includes("<Slider"), "视频时长未使用滑块控件");
    assert.ok(videoSettingsPanelSource.includes("max={durationRange.max}"), "视频生成最长时长未使用当前模型支持的最大值");
    assert.ok(videoSettingsPanelSource.includes("onChange={setDurationDraft}"), "拖动视频时长仍会直接更新画布节点");
    assert.ok(videoSettingsPanelSource.includes("onChangeComplete={commitDuration}"), "视频时长拖动结束后未提交节点配置");
    assert.ok(videoSettingsPanelSource.includes("const VIDEO_COUNT_PRESETS = [1, 2, 4]"), "视频生成数量未严格限制为1、2、4");
    assert.ok(!videoSettingsPanelSource.includes("生成音频"), "视频节点设置仍包含生成音频配置");
    assert.ok(videoSettingsPopoverSource.includes("width={420}"), "视频设置浮层宽度不足以容纳五列比例布局");
    assert.ok(canvasPageSource.includes("Array.from({ length: count }"), "视频生成数量未用于创建对应数量的节点任务");
});

test("画布点击浮层使用不透明背景", () => {
    assert.ok(videoSettingsPopoverSource.includes("<SettingsPopoverShell"), "视频设置未复用统一浮层容器");
    assert.ok(promptPanelSource.includes("background: theme.node.panel"), "节点提示面板仍使用透明工具栏背景");
});
