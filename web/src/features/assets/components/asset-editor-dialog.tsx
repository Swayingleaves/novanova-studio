"use client";

import { useEffect, useRef, useState } from "react";
import { App, Button, Form, Input, Modal, Select, Space, Tag } from "antd";
import { Upload } from "lucide-react";

import { formatBytes } from "@/features/generation/lib/image-utils";
import { uploadImage } from "@/features/storage/services/image-storage";
import { useAssetStore, type Asset, type ImageAsset } from "../stores/use-asset-store";

type AssetFormValues = { kind: "text" | "image"; title: string; coverUrl: string; tags: string[]; source?: string; note?: string; content?: string };
type ImageDraft = ImageAsset["data"] | null;

export function AssetEditorDialog({ open, asset, onClose }: { open: boolean; asset: Asset | null; onClose: () => void }) {
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
            source: asset?.source || "手动添加",
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
            if (!imageDraft) return void message.error("请选择图片文件");
            persist({ ...common, kind: "image", data: imageDraft });
        }
        message.success(asset ? "资产已更新" : "资产已保存");
        onClose();
    };
    const persist = (value: Parameters<typeof addAsset>[0]) => asset ? updateAsset(asset.id, value) : addAsset(value);
    const uploadCover = async (file?: File) => {
        if (!file) return;
        try { form.setFieldValue("coverUrl", (await uploadImage(file)).url); } catch (error) { message.error(error instanceof Error ? error.message : "上传封面失败"); }
    };
    const uploadContent = async (file?: File) => {
        if (!file?.type.startsWith("image/")) return;
        try {
            const image = await uploadImage(file);
            const draft = { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType, objectStorage: image.objectStorage };
            setImageDraft(draft);
            if (!form.getFieldValue("coverUrl")) form.setFieldValue("coverUrl", image.url);
            if (!form.getFieldValue("title")) form.setFieldValue("title", file.name);
        } catch (error) { message.error(error instanceof Error ? error.message : "上传图片资产失败"); }
    };

    return (
        <Modal title={asset ? "编辑资产" : "新增资产"} open={open} width={900} okText="保存" cancelText="取消" onOk={() => void save()} onCancel={onClose} destroyOnHidden>
            <div className="grid gap-6 pt-2 lg:grid-cols-[minmax(0,1fr)_280px]">
                <Form form={form} layout="vertical" requiredMark={false}>
                    <Form.Item name="kind" label="类型"><Select options={[{ label: "文本", value: "text" }, { label: "图片", value: "image" }]} onChange={setKind} /></Form.Item>
                    <Form.Item name="title" label="标题" rules={[{ required: true, message: "请输入标题" }]}><Input placeholder="便于检索的资产名称" /></Form.Item>
                    <Form.Item name="coverUrl" label="封面"><Space.Compact className="w-full"><Input placeholder="图片 URL 或本地上传" /><Button icon={<Upload className="size-4" />} onClick={() => coverInputRef.current?.click()}>上传</Button></Space.Compact></Form.Item>
                    <Form.Item name="tags" label="标签"><Select mode="tags" tokenSeparators={[",", "，"]} placeholder="输入后回车" /></Form.Item>
                    <div className="grid gap-4 sm:grid-cols-2"><Form.Item name="source" label="来源"><Input /></Form.Item><Form.Item name="note" label="备注"><Input /></Form.Item></div>
                    {kind === "text" ? <Form.Item name="content" label="文本内容" rules={[{ required: true, message: "请输入文本内容" }]}><Input.TextArea rows={7} /></Form.Item> : <div className="studio-empty flex items-center gap-3 p-4"><Button icon={<Upload className="size-4" />} onClick={() => imageInputRef.current?.click()}>选择图片</Button><span className="studio-caption text-xs">{imageDraft ? `${imageDraft.width} × ${imageDraft.height} · ${formatBytes(imageDraft.bytes)}` : "未选择图片"}</span></div>}
                </Form>
                <aside className="studio-panel-solid h-fit overflow-hidden"><div className="studio-media-frame">{coverUrl || imageDraft?.dataUrl ? <img src={coverUrl || imageDraft?.dataUrl} alt="" className="aspect-[4/3] w-full object-cover" /> : <div className="studio-empty flex aspect-[4/3] items-center justify-center p-4 text-center text-sm">{content || "暂无封面"}</div>}</div><div className="p-4"><h3 className="studio-title truncate font-medium">{title || "未命名资产"}</h3><div className="mt-2 flex flex-wrap gap-1">{tags.length ? tags.map((tag) => <Tag key={tag}>{tag}</Tag>) : <Tag>未打标签</Tag>}</div></div></aside>
            </div>
            <input ref={coverInputRef} hidden type="file" accept="image/*" onChange={(event) => { void uploadCover(event.target.files?.[0]); event.target.value = ""; }} />
            <input ref={imageInputRef} hidden type="file" accept="image/*" onChange={(event) => { void uploadContent(event.target.files?.[0]); event.target.value = ""; }} />
        </Modal>
    );
}
