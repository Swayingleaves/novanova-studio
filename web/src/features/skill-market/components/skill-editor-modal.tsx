"use client";

import { useState } from "react";
import { App, Form, Input, Modal, Select } from "antd";
import { Upload } from "lucide-react";

import { useTranslation } from "@/features/locale/use-translation";
import { uploadImage } from "@/features/storage/services/image-storage";
import { createUserSkill, updateUserSkill, type SaveUserSkillInput, type SkillMarketCategory, type SkillMineCard, type SkillUsageStep } from "@/services/api/server";

type SkillEditorValues = {
    name: string;
    subtitle?: string;
    description?: string;
    category: SkillMarketCategory;
    targetType: "image" | "video";
    coverUrl?: string;
    audience?: string;
    systemPrompt: string;
    aspectRatio?: string;
    usageSteps?: SkillUsageStep[];
};

const categories: SkillMarketCategory[] = ["image", "video", "ecommerce", "portrait", "viralReplica"];

function emptySteps(): SkillUsageStep[] {
    return [
        { title: "", detail: "" },
        { title: "", detail: "" },
        { title: "", detail: "" },
    ];
}

function toFormValues(skill?: SkillMineCard & { systemPrompt?: string | null; audience?: string; usageSteps?: SkillUsageStep[] }): SkillEditorValues {
    const steps = [...(skill?.usageSteps || [])];
    while (steps.length < 3) steps.push({ title: "", detail: "" });
    return {
        name: skill?.name || "",
        subtitle: skill?.subtitle || "",
        description: skill?.description || "",
        category: skill?.category || "image",
        targetType: skill?.category === "video" ? "video" : skill?.targetType === "video" ? "video" : "image",
        coverUrl: skill?.coverUrl || "",
        audience: skill?.audience || "",
        systemPrompt: skill?.systemPrompt || "",
        aspectRatio: skill?.aspectRatio || "16:9",
        usageSteps: steps.slice(0, 3),
    };
}

type SkillEditorModalProps = {
    open: boolean;
    skill?: (SkillMineCard & { systemPrompt?: string | null; audience?: string; usageSteps?: SkillUsageStep[] }) | null;
    onClose: () => void;
    onSaved: () => void;
};

export function SkillEditorModal({ open, skill, onClose, onSaved }: SkillEditorModalProps) {
    const translate = useTranslation();
    const { message } = App.useApp();
    const [form] = Form.useForm<SkillEditorValues>();
    const [uploading, setUploading] = useState(false);
    const category = Form.useWatch("category", form);
    const coverUrl = Form.useWatch("coverUrl", form) || "";
    const targetLocked = category === "image" || category === "video";

    const save = async () => {
        try {
            const values = await form.validateFields();
            const targetType = values.category === "image" ? "image" : values.category === "video" ? "video" : values.targetType;
            const input: SaveUserSkillInput = {
                name: values.name.trim(),
                subtitle: values.subtitle?.trim() || "",
                description: values.description?.trim() || "",
                category: values.category,
                targetType,
                coverUrl: values.coverUrl?.trim() || "",
                audience: values.audience?.trim() || "",
                systemPrompt: values.systemPrompt.trim(),
                aspectRatio: values.aspectRatio || "16:9",
                usageSteps: (values.usageSteps || []).map((step) => ({ title: step?.title?.trim() || "", detail: step?.detail?.trim() || "" })),
            };
            if (skill) {
                await updateUserSkill({ ...input, id: skill.id });
                message.success(translate("skillMarket.updatedSuccess"));
            } else {
                await createUserSkill(input);
                message.success(translate("skillMarket.createdSuccess"));
            }
            onSaved();
            onClose();
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        }
    };

    const uploadCover = async (file: File | undefined) => {
        if (!file) return;
        setUploading(true);
        try {
            const uploaded = await uploadImage(file, { compress: true });
            form.setFieldValue("coverUrl", uploaded.url);
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("skillMarket.loadFailed"));
        } finally {
            setUploading(false);
        }
    };

    return (
        <Modal
            title={skill ? translate("skillMarket.editSkill") : translate("skillMarket.createSkill")}
            open={open}
            onOk={save}
            onCancel={onClose}
            okText={translate("skillMarket.save")}
            cancelText={translate("skillMarket.cancel")}
            confirmLoading={uploading}
            width={720}
            afterOpenChange={(visible) => {
                if (visible) form.setFieldsValue(toFormValues(skill || undefined));
            }}
        >
            <Form form={form} layout="vertical" initialValues={toFormValues(skill || undefined)}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Form.Item name="name" label={translate("skillMarket.name")} rules={[{ required: true, message: translate("skillMarket.nameRequired") }]}>
                        <Input maxLength={100} />
                    </Form.Item>
                    <Form.Item name="category" label={translate("skillMarket.category")} rules={[{ required: true, message: translate("skillMarket.categoryRequired") }]}>
                        <Select
                            options={categories.map((item) => ({ value: item, label: translate(`skillMarket.${item}`) }))}
                            onChange={(value: SkillMarketCategory) => {
                                if (value === "image" || value === "video") form.setFieldValue("targetType", value);
                            }}
                        />
                    </Form.Item>
                </div>
                <Form.Item name="subtitle" label={translate("skillMarket.subtitle")}>
                    <Input maxLength={200} placeholder={translate("skillMarket.subtitlePlaceholder")} />
                </Form.Item>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Form.Item name="targetType" label={translate("skillMarket.targetType")}>
                        <Select
                            disabled={targetLocked}
                            options={[
                                { value: "image", label: translate("skillMarket.image") },
                                { value: "video", label: translate("skillMarket.video") },
                            ]}
                        />
                    </Form.Item>
                    <Form.Item name="aspectRatio" label={translate("skillMarket.aspectRatio")}>
                        <Select
                            options={[
                                { value: "16:9", label: "16:9" },
                                { value: "9:16", label: "9:16" },
                                { value: "1:1", label: "1:1" },
                                { value: "4:3", label: "4:3" },
                                { value: "3:4", label: "3:4" },
                            ]}
                        />
                    </Form.Item>
                </div>
                <Form.Item name="coverUrl" label={translate("skillMarket.cover")}>
                    <Input />
                </Form.Item>
                <div className="mb-4 flex items-center gap-3">
                    <div className="h-20 w-28 overflow-hidden rounded-md border border-[var(--studio-line)] bg-[var(--studio-media)]">
                        {coverUrl ? <img src={coverUrl} alt="" className="size-full object-cover" /> : null}
                    </div>
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-[var(--studio-line)] px-3 py-1.5 text-sm text-[var(--studio-ink)]">
                        <Upload className="size-3.5" />
                        {translate("skillMarket.uploadCover")}
                        <input
                            hidden
                            type="file"
                            accept="image/*"
                            onChange={(event) => {
                                void uploadCover(event.target.files?.[0]);
                                event.target.value = "";
                            }}
                        />
                    </label>
                </div>
                <Form.Item name="description" label={translate("skillMarket.description")}>
                    <Input.TextArea rows={4} maxLength={4000} placeholder={translate("skillMarket.descriptionPlaceholder")} />
                </Form.Item>
                <Form.Item name="audience" label={translate("skillMarket.audience")}>
                    <Input.TextArea rows={2} maxLength={1000} placeholder={translate("skillMarket.audiencePlaceholder")} />
                </Form.Item>
                <div className="mb-2 text-sm text-[var(--studio-ink)]">{translate("skillMarket.usageSteps")}</div>
                {[0, 1, 2].map((index) => (
                    <div key={index} className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
                        <Form.Item name={["usageSteps", index, "title"]} label={`${index + 1}. ${translate("skillMarket.stepTitle")}`}>
                            <Input maxLength={40} />
                        </Form.Item>
                        <Form.Item name={["usageSteps", index, "detail"]} label={translate("skillMarket.stepDetail")}>
                            <Input maxLength={300} />
                        </Form.Item>
                    </div>
                ))}
                <Form.Item name="systemPrompt" label={translate("skillMarket.systemPrompt")} rules={[{ required: true, message: translate("skillMarket.promptRequired") }]}>
                    <Input.TextArea rows={8} placeholder={translate("skillMarket.promptPlaceholder")} />
                </Form.Item>
            </Form>
        </Modal>
    );
}
