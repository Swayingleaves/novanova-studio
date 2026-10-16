"use client";
import { useTranslation } from "@/features/locale/use-translation";


import { useEffect, useRef, useState } from "react";
import { App, Button, Form, Input, Modal, Select, Space, Tag } from "antd";
import { Upload } from "lucide-react";

import { formatBytes } from "@/features/generation/lib/image-utils";
import { uploadImage } from "@/features/storage/services/image-storage";
import { useAssetStore, type Asset, type ImageAsset } from "../stores/use-asset-store";

type AssetFormValues = { kind: "text" | "image"; title: string; coverUrl: string; tags: string[]; source?: string; note?: string; content?: string };
type ImageDraft = ImageAsset["data"] | null;

export function AssetEditorDialog({ open, asset, onClose }: { open: boolean; asset: Asset | null; onClose: () => void }) {
    const translate = useTranslation();
    const { message } = App.useApp();
    const [form] = Form.useForm<AssetFormValues>();
    const addAsset = useAssetStore((state) => state.addAsset);
    const updateAsset = useAssetStore((state) => state.updateAsset);
    const coverInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const [kind, setKind] = useState<"text" | "image">("text");
    const [imageDraft, setImageDraft] = useState<ImageDraft>(null);
    const coverUrl = Form.useWatch("coverUrl", form) || "";
    const title = Form.useWatch("title", form) || "";
    const tags = Form.useWatch("tags", form) || [];
    const content = Form.useWatch("content", form) || "";

    useEffect(() => {
        if (!open) return;
        const editableKind = asset?.kind === "image" ? "image" : "text";
        setKind(editableKind);
        setImageDraft(asset?.kind === "image" ? asset.data : null);
        form.setFieldsValue({
            kind: editableKind,
            title: asset?.title || "",
            coverUrl: asset?.coverUrl || "",
            tags: asset?.tags || [],
            source: asset?.source || translate("assets.addManually"),
            note: asset?.note || "",
            content: asset?.kind === "text" ? asset.data.content : "",
        });
    }, [asset, form, open]);

    const save = async () => {
        const values = await form.validateFields();
        const common = { title: values.title.trim(), coverUrl: values.coverUrl.trim() || (imageDraft?.dataUrl ?? ""), tags: values.tags || [], source: values.source?.trim(), note: values.note?.trim(), metadata: asset?.metadata || { source: "manual" } };
        if (values.kind === "text") {
            persist({ ...common, kind: "text", data: { content: (values.content || "").trim() } });
        } else {
            if (!imageDraft) return void message.error(translate("assets.selectAnImageFile"));
            persist({ ...common, kind: "image", data: imageDraft });
        }
        message.success(asset ? translate("assets.assetUpdated") : translate("assets.assetSaved"));
        onClose();
    };
    const persist = (value: Parameters<typeof addAsset>[0]) => asset ? updateAsset(asset.id, value) : addAsset(value);
    const uploadCover = async (file?: File) => {
        if (!file) return;
        try { form.setFieldValue("coverUrl", (await uploadImage(file)).url); } catch (error) { message.error(error instanceof Error ? error.message : translate("assets.failedToUploadCover")); }
    };
    const uploadContent = async (file?: File) => {
        if (!file?.type.startsWith("image/")) return;
        try {
            const image = await uploadImage(file);
            const draft = { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType, objectStorage: image.objectStorage };
            setImageDraft(draft);
            if (!form.getFieldValue("coverUrl")) form.setFieldValue("coverUrl", image.url);
            if (!form.getFieldValue("title")) form.setFieldValue("title", file.name);
        } catch (error) { message.error(error instanceof Error ? error.message : translate("assets.failedToUploadAssetImage")); }
    };

    return (
        <Modal title={asset ? translate("assets.editAsset") : translate("assets.addAsset")} open={open} width={900} okText={translate("assets.save")} cancelText={translate("assets.cancel")} onOk={() => void save()} onCancel={onClose} destroyOnHidden>
            <div className="grid gap-6 pt-2 lg:grid-cols-[minmax(0,1fr)_280px]">
                <Form form={form} layout="vertical" requiredMark={false}>
                    <Form.Item name="kind" label={translate("assets.type")}><Select options={[{ label: translate("assets.text"), value: "text" }, { label: translate("assets.image"), value: "image" }]} onChange={setKind} /></Form.Item>
                    <Form.Item name="title" label={translate("assets.title")} rules={[{ required: true, message: translate("assets.enterATitle") }]}><Input placeholder={translate("assets.aSearchableAssetName")} /></Form.Item>
                    <Form.Item name="coverUrl" label={translate("assets.cover")}><Space.Compact className="w-full"><Input placeholder={translate("assets.imageURLOrLocalUpload")} /><Button icon={<Upload className="size-4" />} onClick={() => coverInputRef.current?.click()}>{translate("assets.upload")}</Button></Space.Compact></Form.Item>
                    <Form.Item name="tags" label={translate("assets.tags")}><Select mode="tags" tokenSeparators={[",", "，"]} placeholder={translate("assets.pressEnterToAdd")} /></Form.Item>
                    <div className="grid gap-4 sm:grid-cols-2"><Form.Item name="source" label={translate("assets.source")}><Input /></Form.Item><Form.Item name="note" label={translate("assets.notes")}><Input /></Form.Item></div>
                    {kind === "text" ? <Form.Item name="content" label={translate("assets.textContent")} rules={[{ required: true, message: translate("assets.enterTextContent") }]}><Input.TextArea rows={7} /></Form.Item> : <div className="studio-empty flex items-center gap-3 p-4"><Button icon={<Upload className="size-4" />} onClick={() => imageInputRef.current?.click()}>{translate("assets.selectImage")}</Button><span className="studio-caption text-xs">{imageDraft ? `${imageDraft.width} × ${imageDraft.height} · ${formatBytes(imageDraft.bytes)}` : translate("assets.noImageSelected")}</span></div>}
                </Form>
                <aside className="studio-panel-solid h-fit overflow-hidden"><div className="studio-media-frame">{coverUrl || imageDraft?.dataUrl ? <img src={coverUrl || imageDraft?.dataUrl} alt="" className="aspect-[4/3] w-full object-cover" /> : <div className="studio-empty flex aspect-[4/3] items-center justify-center p-4 text-center text-sm">{content || translate("assets.noCover")}</div>}</div><div className="p-4"><h3 className="studio-title truncate font-medium">{title || translate("assets.untitledAsset")}</h3><div className="mt-2 flex flex-wrap gap-1">{tags.length ? tags.map((tag) => <Tag key={tag}>{tag}</Tag>) : <Tag>{translate("assets.noTags")}</Tag>}</div></div></aside>
            </div>
            <input ref={coverInputRef} hidden type="file" accept="image/*" onChange={(event) => { void uploadCover(event.target.files?.[0]); event.target.value = ""; }} />
            <input ref={imageInputRef} hidden type="file" accept="image/*" onChange={(event) => { void uploadContent(event.target.files?.[0]); event.target.value = ""; }} />
        </Modal>
    );
}
