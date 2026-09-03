import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const canvasPageSource = readFileSync(new URL("./canvas-client-page.tsx", import.meta.url), "utf8");
const canvasAgentOpsSource = readFileSync(new URL("../utils/canvas-agent-ops.ts", import.meta.url), "utf8");
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

test("连线参考内容不会自动写入节点提示词", () => {
    assert.ok(!promptPanelSource.includes("buildInitialPrompt"), "节点提示面板仍会根据连线自动构建提示词");
    assert.ok(!promptPanelSource.includes("prevLabelsRef"), "节点提示面板仍保留连线标签自动同步状态");
    assert.ok(promptPanelSource.includes("onInsert={() => promptEditorRef.current?.insertAtCursor(reference.label)}"), "参考缩略图未保留点击后插入提示词功能");
});

test("节点提示词回显时隐藏引用标签反引号", () => {
    assert.ok(promptPanelSource.includes("stripPromptReferenceDelimiters(text, requiredLabels)"), "提示词编辑器仍会回显引用标签两侧的反引号");
    assert.ok(promptPanelSource.includes('new RegExp("`+("'), "引用标签反引号清理规则不完整");
});

test("节点提示词输入@时打开画布资产引用面板", () => {
    assert.ok(promptPanelSource.includes("onMentionInput"), "提示编辑器未监听@引用输入");
    assert.ok(promptPanelSource.includes("beforeCursor.match(/(^|\\s)@([^\\s@]*)$/)"), "@引用输入未解析搜索关键词");
    assert.ok(promptPanelSource.includes("<MentionAssetMenu"), "@引用面板未渲染");
    assert.ok(promptPanelSource.includes("replaceTextRange(range.start, range.end, label)"), "资产选择未替换@查询并插入引用标签");
});

test("@引用面板定位在光标右上侧", () => {
    assert.ok(promptPanelSource.includes("caretRect"), "提示编辑器未暴露@光标位置");
    assert.ok(promptPanelSource.includes("transform: \"translateY(calc(-100% - 0.5rem))\""), "@引用面板未定位到光标上方");
    assert.ok(!promptPanelSource.includes("top-[8.75rem]"), "@引用面板仍使用固定的节点位置");
    assert.ok(promptPanelSource.includes('aria-label="搜索画布资产"'), "@引用面板缺少可输入的搜索框");
    assert.ok(promptPanelSource.includes("onQueryChange={(value) =>"), "@引用面板搜索关键词未同步");
});

test("节点@引用选择建立画布连线且避免重复连接", () => {
    assert.ok(canvasPageSource.includes("connectMentionReference"), "画布未提供@引用连线处理");
    assert.ok(canvasPageSource.includes("normalizeCanvasConnection(sourceNodeId, targetNodeId"), "@引用未复用画布连线规范化逻辑");
    assert.ok(canvasPageSource.includes("connectionsRef.current.some((item) => item.source.nodeId === connection.source.nodeId && item.target.nodeId === connection.target.nodeId)"), "@引用未检查重复连线");
    assert.ok(canvasPageSource.includes('source: { ...normalizedConnection.source, portId: "right" }') && canvasPageSource.includes('target: { ...normalizedConnection.target, portId: "left" }'), "@引用连线未固定使用右侧输出点和左侧输入点");
    assert.ok(promptPanelSource.includes("onMentionSelect(reference)"), "资产选择未调用连线回调");
});

test("节点提示面板展示已持久化的生成参考图", () => {
    assert.ok(promptPanelSource.includes("buildNodeGenerationReferences(node)"), "提示面板未读取节点已保存的生成参考图");
    assert.ok(promptPanelSource.includes("canInsert: false"), "已保存的生成参考图不应作为连线标签写回提示词");
});

test("节点提示面板将参考内容显示在文本输入框上方", () => {
    const referenceContentIndex = promptPanelSource.indexOf("参考内容");
    const promptEditorIndex = promptPanelSource.search(/<PromptEditor\s+ref=/);

    assert.ok(referenceContentIndex >= 0, "提示面板缺少参考内容区域");
    assert.ok(promptEditorIndex >= 0, "提示面板缺少文本输入框");
    assert.ok(referenceContentIndex < promptEditorIndex, "参考内容区域未移动到文本输入框上方");
    assert.ok(promptPanelSource.includes('className="mb-3 min-w-0 border-b pb-3"'), "参考内容区域未使用底部分隔布局");
});

test("节点参考内容按顺序显示序号并支持移除连线引用", () => {
    assert.ok(promptPanelSource.includes("index={index + 1}"), "参考内容未按展示顺序生成序号");
    assert.ok(promptPanelSource.includes('className="absolute right-1 top-1 grid size-4 place-items-center rounded-sm opacity-0'), "参考内容删除按钮未定位在卡片内侧右上角");
    assert.ok(promptPanelSource.includes("onRemoveReference(reference)"), "参考内容删除操作未回调连线移除逻辑");
    assert.ok(canvasPageSource.includes("removeNodeReferenceConnection(promptPanelNode.id, reference.nodeId)"), "节点参考删除未删除对应连线");
});

test("视频节点参考图支持放大预览", () => {
    assert.ok(promptPanelSource.includes('const canPreview = !canInsert && reference.kind === "image"'), "视频节点未识别可预览的参考图");
    assert.ok(promptPanelSource.includes("const actionLabel = canPreview ? `放大查看${reference.label}`"), "参考图缺少放大查看入口");
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
    assert.ok(promptPanelSource.includes('className="!h-10 !min-w-0 !max-w-[180px] flex-1"'), "模型选择器未限制宽度，长模型名称会挤压提交操作");
    assert.ok(promptPanelSource.includes('buttonClassName="!h-10 !w-[140px]'), "节点生成设置按钮未限制稳定宽度");
    assert.ok(promptPanelSource.includes("iconOnly"), "节点风格入口未切换为仅图标模式");
});

test("设定图节点存在上游资源时允许空输入生成", () => {
    assert.ok(promptPanelSource.includes("canGenerateWithoutPrompt"), "提示面板缺少设定图上游内容生成开关");
    assert.ok(promptPanelSource.includes("const canSubmit = Boolean(prompt.trim()) || canGenerateWithoutPrompt"), "提示面板未允许使用上游内容提交空输入");
    assert.ok(canvasPageSource.includes("hasNodeGenerationInputs(promptPanelNode.id, nodes, connections)"), "画布未根据通用上游资源解析结果启用设定图空输入生成");
    assert.ok(canvasPageSource.includes("canGenerateWithoutPrompt={promptPanelCanGenerateWithoutPrompt}"), "设定图空输入能力未传入提示面板");
    assert.ok(canvasPageSource.includes("!promptPanelNode.generation.settingGraph"), "普通图片节点未与设定图节点区分空输入规则");
});

test("设定图请求提交前合并上游内容并拒绝完全空提示词", () => {
    assert.ok(canvasPageSource.includes("resolveNodeGenerationPrompt(nodeId, nodesRef.current, connectionsRef.current, prompt, true)"), "设定图请求未解析节点自身输入和上游内容");
    assert.ok(canvasPageSource.includes("resolveNodeGenerationPrompt(nodeId, nodesRef.current, connectionsRef.current, prompt, true)"), "设定图请求未使用图片引用提示词解析能力");
    assert.ok(canvasPageSource.includes('message.warning("请输入生成描述或连接有内容的上游节点")'), "完全空的设定图请求缺少明确提示");
    assert.ok(canvasPageSource.includes("sendAgentMessage(\n                    effectivePrompt"), "设定图请求未使用合并后的最终提示词");
});

test("切换节点时提示面板按节点隔离编辑器状态", () => {
    assert.ok(canvasPageSource.includes("key={promptPanelNode.id}"), "提示面板未按节点ID重新挂载，可能残留上一个节点的编辑器状态");
});

test("画布新增和生成节点统一使用避让重叠布局", () => {
    assert.ok(canvasPageSource.includes("findNonOverlappingCanvasNodePosition"), "画布新增节点未接入统一避让重叠布局");
    assert.ok(canvasAgentOpsSource.includes("findNonOverlappingCanvasNodePosition"), "Agent 新增节点未接入统一避让重叠布局");
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
