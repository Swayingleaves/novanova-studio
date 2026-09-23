"use client";

import { useEffect, useState } from "react";
import { App, Button, Card, Form, Input, InputNumber, Radio, Select, Tag } from "antd";
import { Check, RotateCcw, Save } from "lucide-react";

import { useComicDramaStore } from "../stores/use-comic-drama-store";
import type { ComicDramaProjectType, ComicDramaSettings } from "../types";

const PROJECT_TYPES: Array<{ value: ComicDramaProjectType; label: string }> = [
    { value: "comicDrama", label: "漫剧" },
    { value: "liveActionShort", label: "真人短剧" },
    { value: "animation", label: "动画" },
    { value: "advertisement", label: "广告故事" },
    { value: "musicVideo", label: "音乐视频" },
    { value: "storyShort", label: "故事短片" },
];

const ORIENTATIONS = [
    { value: "portrait", label: "竖屏 (9:16 移动端优先)" },
    { value: "landscape", label: "横屏 (16:9 宽画幅优先)" },
    { value: "square", label: "方形 (1:1 社交媒体)" },
];

const ASPECT_RATIOS = [
    { value: "9:16", label: "9:16 (短视频/短剧标准)" },
    { value: "16:9", label: "16:9 (长视频/影视标准)" },
    { value: "1:1", label: "1:1 (正方形)" },
    { value: "4:3", label: "4:3 (经典画幅)" },
    { value: "2.35:1", label: "2.35:1 (电影宽银幕)" },
];

const STYLE_PRESETS = [
    "国漫写实 3D，高精度建模，电影级体积光与次表面散射",
    "新中式水墨工笔，淡彩晕染，留白意境，唯美古风",
    "日漫胶片复古，手绘赛璐珞质感，颗粒噪点，光影柔和",
    "赛博朋克电影质感，霓虹雨夜反光，机械结构与高对比冷暖光",
    "真人短剧电影级写实，8k超清影视质感，浅景深自然肤色",
    "治愈系 3D 动画，黏土手作风格，柔和暖色调，微距摄影",
    "美漫厚涂超级英雄风，硬朗阴影，强张力动态线条",
];

const PLATFORM_PRESETS = ["抖音", "快手", "微信视频号", "B站 (Bilibili)", "小红书", "YouTube", "TikTok"];

/** 项目生产设置阶段视图。 */
export function StageSettings() {
    const { message } = App.useApp();
    const workspace = useComicDramaStore((state) => state.workspace);
    const updateSettings = useComicDramaStore((state) => state.updateSettings);

    const [form] = Form.useForm<ComicDramaSettings>();
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (workspace?.settings) {
            form.setFieldsValue(workspace.settings);
        }
    }, [form, workspace?.settings]);

    if (!workspace) return null;

    const handleSave = async () => {
        try {
            const values = await form.validateFields();
            setSaving(true);
            await updateSettings(values);
            message.success("生产设置已保存");
        } catch (error) {
            if (error instanceof Error) {
                message.error(error.message);
            }
        } finally {
            setSaving(false);
        }
    };

    const handleReset = () => {
        if (workspace.settings) {
            form.setFieldsValue(workspace.settings);
            message.info("已重置为当前保存的设置");
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <header className="flex flex-col gap-2 border-b border-[var(--studio-line)] pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-[var(--studio-ink)]">项目生产设置</h2>
                    <p className="mt-1 text-sm text-[var(--studio-muted)]">
                        设定全局画面比例、视觉风格、时长与目标平台。这里的视觉风格将作为自动拆镜头、提示词合成及生成的默认标准。
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button icon={<RotateCcw className="size-4" />} onClick={handleReset}>
                        重置
                    </Button>
                    <Button type="primary" loading={saving} icon={<Save className="size-4" />} onClick={handleSave}>
                        保存设置
                    </Button>
                </div>
            </header>

            <Form form={form} layout="vertical" initialValues={workspace.settings} className="max-w-4xl">
                <div className="grid gap-6 md:grid-cols-2">
                    <Form.Item
                        name="projectType"
                        label="项目类型"
                        rules={[{ required: true, message: "请选择项目类型" }]}
                    >
                        <Select options={PROJECT_TYPES} />
                    </Form.Item>

                    <Form.Item
                        name="orientation"
                        label="画面方向"
                        rules={[{ required: true, message: "请选择画面方向" }]}
                    >
                        <Select
                            options={ORIENTATIONS}
                            onChange={(value) => {
                                if (value === "portrait") form.setFieldValue("aspectRatio", "9:16");
                                else if (value === "landscape") form.setFieldValue("aspectRatio", "16:9");
                                else if (value === "square") form.setFieldValue("aspectRatio", "1:1");
                            }}
                        />
                    </Form.Item>

                    <Form.Item
                        name="aspectRatio"
                        label="画面宽高比"
                        rules={[{ required: true, message: "请选择画面宽高比" }]}
                    >
                        <Select options={ASPECT_RATIOS} />
                    </Form.Item>

                    <Form.Item
                        name="targetEpisodeCount"
                        label="目标总集数"
                        rules={[{ required: true, message: "请输入目标集数" }]}
                    >
                        <InputNumber min={1} max={1000} className="w-full" />
                    </Form.Item>

                    <Form.Item
                        name="episodeTargetDuration"
                        label="单集目标时长（秒）"
                        tooltip="0 表示不限制，短剧通常为 60~120 秒"
                    >
                        <InputNumber min={0} className="w-full" placeholder="例如：90" />
                    </Form.Item>

                    <Form.Item
                        name="overallDuration"
                        label="预计全片总时长（秒）"
                        tooltip="0 表示根据集数自动折算"
                    >
                        <InputNumber min={0} className="w-full" placeholder="例如：900" />
                    </Form.Item>
                </div>

                <div className="mt-4 flex flex-col gap-2">
                    <Form.Item
                        name="visualStyle"
                        label="默认视觉风格与画风标准"
                        rules={[{ required: true, message: "请填写视觉风格" }]}
                        tooltip="将注入至镜头提示词与资产图生成的提示词合成引擎中"
                    >
                        <Input.TextArea rows={3} placeholder="描述画风、光影、渲染器、笔触与镜头质感..." />
                    </Form.Item>

                    <div className="mb-4 flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-[var(--studio-muted)]">快捷风格预设：</span>
                        {STYLE_PRESETS.map((preset) => (
                            <Tag
                                key={preset}
                                className="cursor-pointer transition-opacity hover:opacity-80"
                                onClick={() => form.setFieldValue("visualStyle", preset)}
                            >
                                {preset.slice(0, 8)}...
                            </Tag>
                        ))}
                    </div>
                </div>

                <Form.Item
                    name="periodAtmosphere"
                    label="时代背景与整体氛围"
                    tooltip="例如：赛博未来、近未来废土、大唐盛世盛宴、民国初年雨夜"
                >
                    <Input placeholder="例如：赛博未来 2088 年雨夜街区，科技感与市井烟火并存" />
                </Form.Item>

                <div className="grid gap-6 md:grid-cols-2">
                    <div>
                        <Form.Item name="targetPlatform" label="目标发布平台">
                            <Input placeholder="例如：抖音、快手、微信视频号" />
                        </Form.Item>
                        <div className="flex flex-wrap gap-1">
                            {PLATFORM_PRESETS.map((platform) => (
                                <Tag
                                    key={platform}
                                    className="cursor-pointer"
                                    onClick={() => {
                                        const current = form.getFieldValue("targetPlatform") || "";
                                        if (!current.includes(platform)) {
                                            form.setFieldValue("targetPlatform", current ? `${current}, ${platform}` : platform);
                                        }
                                    }}
                                >
                                    + {platform}
                                </Tag>
                            ))}
                        </div>
                    </div>

                    <Form.Item name="useCase" label="具体使用场景">
                        <Input placeholder="例如：商业短剧宣发、IP 故事孵化、竖屏番剧更新" />
                    </Form.Item>
                </div>
            </Form>
        </div>
    );
}
