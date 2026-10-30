"use client";

import { Checkbox, Form, InputNumber } from "antd";
import { useTranslation } from "@/features/locale/use-translation";
import { VIDEO_ASPECT_RATIOS, videoConstraintConfigurationIssues, videoConstraintFieldLabel, type VideoConstraintField } from "@/features/generation/lib/video-generation-constraints";
import type { VideoGenerationConstraints, VideoGenerationMode } from "@/features/settings/stores/use-config-store";

/** 在模式调用配置中编辑可直接传给生成入口的限制。 */
export function VideoGenerationConstraintsEditor({ mode, constraints, audioEnabled, billingMinimum, onChange }: {
    mode: VideoGenerationMode;
    constraints: VideoGenerationConstraints | null | undefined;
    audioEnabled: boolean;
    billingMinimum: number;
    onChange: (constraints: VideoGenerationConstraints) => void;
}) {
    const translate = useTranslation();
    const fixedImages = mode === "text-to-video" ? 0 : mode === "first-last-frame-to-video" ? 2 : undefined;
    const current = {
        ...constraints,
        ...(fixedImages === undefined ? {} : { minimumImageCount: fixedImages, maximumImageCount: fixedImages }),
        ...(mode === "reference-to-video" && !audioEnabled ? { maximumAudioCount: 0 } : {}),
    };
    const issues = videoConstraintConfigurationIssues(mode, constraints, audioEnabled, billingMinimum);
    const ratioIssue = issues.find((item) => item.field === "supportedAspectRatios");
    const fields: Array<{ field: VideoConstraintField; minimum: number; maximum?: number }> = [
        { field: "minimumDurationSeconds", minimum: 1 }, { field: "maximumDurationSeconds", minimum: 1 },
        { field: "minimumImageCount", minimum: fixedImages ?? (mode === "image-to-video" ? 1 : 0), maximum: fixedImages },
        { field: "maximumImageCount", minimum: fixedImages ?? 0, maximum: fixedImages },
        ...(mode === "reference-to-video" ? [{ field: "maximumVideoCount" as const, minimum: 0 }, { field: "maximumAudioCount" as const, minimum: audioEnabled ? 1 : 0, maximum: audioEnabled ? undefined : 0 }] : []),
    ];
    const updateConstraints = (patch: Partial<VideoGenerationConstraints>) => onChange({ ...current, ...patch });
    return (
        <section className="mt-3 border-t border-[var(--studio-line)] pt-3" data-video-constraints={mode}>
            <div className="grid gap-x-4 sm:grid-cols-2">
                {fields.map(({ field, minimum, maximum }) => {
                    const issue = issues.find((item) => item.field === field);
                    return <Form.Item key={field} label={videoConstraintFieldLabel(field)} htmlFor={`${mode}-${field}`} layout="vertical" required validateStatus={issue ? "error" : undefined} help={issue?.message}>
                        <InputNumber id={`${mode}-${field}`} className="w-full!" min={minimum} max={maximum ?? 2147483647} precision={0} value={current[field] as number | null | undefined} onChange={(value) => updateConstraints({ [field]: value })} />
                    </Form.Item>;
                })}
            </div>
            <Form.Item className="mb-0" label={videoConstraintFieldLabel("supportedAspectRatios")} htmlFor={`${mode}-supportedAspectRatios`} layout="vertical" required validateStatus={ratioIssue ? "error" : undefined} help={ratioIssue?.message}>
                <div id={`${mode}-supportedAspectRatios`} tabIndex={-1}>
                    <Checkbox.Group aria-label={videoConstraintFieldLabel("supportedAspectRatios")} className="flex flex-wrap gap-2" value={current.supportedAspectRatios} options={VIDEO_ASPECT_RATIOS.map((ratio) => ({ value: ratio, label: ratio === "auto" ? translate("generation.videoConstraintAutomatic") : ratio }))} onChange={(values) => updateConstraints({ supportedAspectRatios: values.map(String) })} />
                </div>
            </Form.Item>
        </section>
    );
}
