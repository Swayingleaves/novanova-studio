"use client";

import { translateMessage } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";

import { useEffect, useState } from "react";
import { App, Button, Card, Form, Input, InputNumber, Radio, Select, Tag } from "antd";
import { Check, RotateCcw, Save } from "lucide-react";

import { useComicDramaStore } from "../stores/use-comic-drama-store";
import type { ComicDramaProjectType, ComicDramaSettings } from "../types";

const getProjectTypes = (translate = translateMessage): Array<{ value: ComicDramaProjectType; label: string }> => ([
    { value: "comicDrama", label: translate("comicDrama.comicDrama") },
    { value: "liveActionShort", label: translate("comicDrama.liveActionShortDrama") },
    { value: "animation", label: translate("comicDrama.animation") },
    { value: "advertisement", label: translate("comicDrama.advertisingStory") },
    { value: "musicVideo", label: translate("comicDrama.musicVideo") },
    { value: "storyShort", label: translate("comicDrama.shortFilm") },
]);

const getOrientations = (translate = translateMessage) => ([
    { value: "portrait", label: translate("comicDrama.portrait916MobileFirst") },
    { value: "landscape", label: translate("comicDrama.landscape169WidescreenFirst") },
    { value: "square", label: translate("comicDrama.square11SocialMedia") },
]);

const getAspectRatios = (translate = translateMessage) => ([
    { value: "9:16", label: translate("comicDrama.message916ShortVideoDrama") },
    { value: "16:9", label: translate("comicDrama.message169LongVideoFilm") },
    { value: "1:1", label: translate("comicDrama.message11Square_f475e5") },
    { value: "4:3", label: translate("comicDrama.message43Classic") },
    { value: "2.35:1", label: translate("comicDrama.message2351CinematicWidescreen") },
]);

const getStylePresets = (translate = translateMessage) => ([
    translate("comicDrama.realisticChinese3dAnimationDetailedModelingCinematicVolumetricLightAnd"),
    translate("comicDrama.chineseInkAndFineLinePaintingSoftColorWashesNegative"),
    translate("comicDrama.retroJapaneseAnimationHandDrawnCelShadingFilmGrainAnd"),
    translate("comicDrama.cinematicCyberpunkNeonReflectionsOnRainyStreetsMechanicalStructuresAnd"),
    translate("comicDrama.cinematicLiveActionShortDramaDetailed8kLookShallowDepth"),
    translate("comicDrama.warm3dAnimationHandmadeClayStyleSoftWarmColorsAnd"),
    translate("comicDrama.americanSuperheroComicStylePainterlyRenderingBoldShadowsAndDynamic"),
]);

const getPlatformPresets = (translate = translateMessage) => ([
    { value: "抖音", label: translate("comicDrama.douyin") },
    { value: "快手", label: translate("comicDrama.kuaishou") },
    { value: "微信视频号", label: translate("comicDrama.wechatChannels") },
    { value: "B站 (Bilibili)", label: translate("comicDrama.bilibili") },
    { value: "小红书", label: translate("comicDrama.xiaohongshu") },
    { value: "YouTube", label: "YouTube" },
    { value: "TikTok", label: "TikTok" },
]);

/** 项目生产设置阶段视图。 */
export function StageSettings() {
    const translate = useTranslation();
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
            message.success(translate("comicDrama.productionSettingsSaved"));
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
            message.info(translate("comicDrama.resetToSavedSettings"));
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <header className="flex flex-col gap-2 border-b border-[var(--studio-line)] pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-[var(--studio-ink)]">{translate("comicDrama.projectProductionSettings")}</h2>
                    <p className="mt-1 text-sm text-[var(--studio-muted)]">
                        {translate("comicDrama.setTheGlobalAspectRatioVisualStyleDurationAndTarget")}</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button icon={<RotateCcw className="size-4" />} onClick={handleReset}>
                        {translate("comicDrama.reset")}</Button>
                    <Button type="primary" loading={saving} icon={<Save className="size-4" />} onClick={handleSave}>
                        {translate("comicDrama.saveSettings")}</Button>
                </div>
            </header>

            <Form form={form} layout="vertical" initialValues={workspace.settings} className="max-w-4xl">
                <div className="grid gap-6 md:grid-cols-2">
                    <Form.Item
                        name="projectType"
                        label={translate("comicDrama.projectType")}
                        rules={[{ required: true, message: translate("comicDrama.selectAProjectType") }]}
                    >
                        <Select options={getProjectTypes(translate)} />
                    </Form.Item>

                    <Form.Item
                        name="orientation"
                        label={translate("comicDrama.orientation")}
                        rules={[{ required: true, message: translate("comicDrama.selectAnOrientation") }]}
                    >
                        <Select
                            options={getOrientations(translate)}
                            onChange={(value) => {
                                if (value === "portrait") form.setFieldValue("aspectRatio", "9:16");
                                else if (value === "landscape") form.setFieldValue("aspectRatio", "16:9");
                                else if (value === "square") form.setFieldValue("aspectRatio", "1:1");
                            }}
                        />
                    </Form.Item>

                    <Form.Item
                        name="aspectRatio"
                        label={translate("comicDrama.aspectRatio_f4a23e")}
                        rules={[{ required: true, message: translate("comicDrama.selectAnAspectRatio") }]}
                    >
                        <Select options={getAspectRatios(translate)} />
                    </Form.Item>

                    <Form.Item
                        name="targetEpisodeCount"
                        label={translate("comicDrama.targetEpisodeCount")}
                        rules={[{ required: true, message: translate("comicDrama.enterTheTargetEpisodeCount") }]}
                    >
                        <InputNumber min={1} max={1000} className="w-full" />
                    </Form.Item>

                    <Form.Item
                        name="episodeTargetDuration"
                        label={translate("comicDrama.targetEpisodeDurationSeconds")}
                        tooltip={translate("comicDrama.message0MeansUnlimitedShortDramasTypicallyUse60120Seconds")}
                    >
                        <InputNumber min={0} className="w-full" placeholder={translate("comicDrama.forExample90")} />
                    </Form.Item>

                    <Form.Item
                        name="overallDuration"
                        label={translate("comicDrama.estimatedTotalDurationSeconds")}
                        tooltip={translate("comicDrama.message0CalculatesAutomaticallyFromTheEpisodeCount")}
                    >
                        <InputNumber min={0} className="w-full" placeholder={translate("comicDrama.forExample900")} />
                    </Form.Item>
                </div>

                <div className="mt-4 flex flex-col gap-2">
                    <Form.Item
                        name="visualStyle"
                        label={translate("comicDrama.defaultVisualStyle")}
                        rules={[{ required: true, message: translate("comicDrama.enterAVisualStyle") }]}
                        tooltip={translate("comicDrama.includedInShotPromptsAndAssetImagePrompts")}
                    >
                        <Input.TextArea rows={3} placeholder={translate("comicDrama.describeTheArtStyleLightingRendererBrushworkAndCameraTexture")} />
                    </Form.Item>

                    <div className="mb-4 flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-[var(--studio-muted)]">{translate("comicDrama.stylePresets")}</span>
                        {getStylePresets(translate).map((preset) => (
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
                    label={translate("comicDrama.eraAndAtmosphere")}
                    tooltip={translate("comicDrama.forExampleCyberpunkFuturePostApocalypticNearFutureTangDynasty")}
                >
                    <Input placeholder={translate("comicDrama.forExampleARainyStreetIn2088MixingFuturisticTechnology")} />
                </Form.Item>

                <div className="grid gap-6 md:grid-cols-2">
                    <div>
                        <Form.Item name="targetPlatform" label={translate("comicDrama.targetPlatform")}>
                            <Input placeholder={translate("comicDrama.forExampleDouyinKuaishouWechatChannels")} />
                        </Form.Item>
                        <div className="flex flex-wrap gap-1">
                            {getPlatformPresets(translate).map(({ value: platform, label }) => (
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
                                    + {label}
                                </Tag>
                            ))}
                        </div>
                    </div>

                    <Form.Item name="useCase" label={translate("comicDrama.useCase")}>
                        <Input placeholder={translate("comicDrama.forExampleShortDramaPromotionStoryDevelopmentPortraitFormatEpisodic")} />
                    </Form.Item>
                </div>
            </Form>
        </div>
    );
}
