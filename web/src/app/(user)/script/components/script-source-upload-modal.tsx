"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { nanoid } from "nanoid";
import { App, Button, Input, Modal, Select } from "antd";
import { Upload } from "lucide-react";

import { uploadScriptSource } from "@/services/api/script";
import type { ScriptContentType, ScriptSourceFileEncoding, ScriptSourceType } from "@/features/script/types";

const CONTENT_TYPES: Array<{ value: ScriptContentType; label: string }> = [
    { value: "comicDrama", label: "漫剧" },
    { value: "liveActionShort", label: "真人短剧" },
    { value: "animation", label: "动画" },
    { value: "advertisement", label: "广告 / 宣传片" },
    { value: "musicVideo", label: "音乐视频" },
    { value: "storyShort", label: "故事短片" },
];

const SOURCE_TYPES: Array<{ value: ScriptSourceType; label: string }> = [
    { value: "novel", label: "小说" },
    { value: "script", label: "剧本" },
];

const ENCODINGS: Array<{ value: ScriptSourceFileEncoding; label: string }> = [
    { value: "UTF-8", label: "UTF-8（默认）" },
    { value: "GB18030", label: "GB18030（简体中文旧编码）" },
];

/** 沿用服务端单文件上传上限。 */
const MAX_FILE_BYTES = 50 * 1024 * 1024;

const SUPPORTED_EXTENSIONS = ["txt", "docx", "doc"];

/** 上传剧本或小说原文弹窗，创建剧本项目并异步解析原文结构。 */
export function ScriptSourceUploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const router = useRouter();
    const { message } = App.useApp();
    const fileInputRef = useRef<HTMLInputElement>(null);
    /* 请求标识在打开弹窗时生成，重试沿用同一个标识，避免重复创建项目。 */
    const requestIdRef = useRef(nanoid());
    const [sourceType, setSourceType] = useState<ScriptSourceType>("novel");
    const [contentType, setContentType] = useState<ScriptContentType>("comicDrama");
    const [title, setTitle] = useState("");
    const [encoding, setEncoding] = useState<ScriptSourceFileEncoding>("UTF-8");
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);

    const extension = file?.name.split(".").pop()?.toLowerCase() || "";
    const isTextFile = extension === "txt";

    const reset = () => {
        requestIdRef.current = nanoid();
        setSourceType("novel");
        setContentType("comicDrama");
        setTitle("");
        setEncoding("UTF-8");
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const close = () => {
        reset();
        onClose();
    };

    const selectFile = (next: File | undefined) => {
        if (!next) return;
        const nextExtension = next.name.split(".").pop()?.toLowerCase() || "";
        if (!SUPPORTED_EXTENSIONS.includes(nextExtension)) {
            message.error("仅支持 TXT、DOCX 和 DOC 文件");
            return;
        }
        if (next.size > MAX_FILE_BYTES) {
            message.error("上传文件超过 50 MB 上限");
            return;
        }
        setFile(next);
        /* 项目名称默认取文件名，用户改过后不再覆盖。 */
        setTitle((current) => current.trim() ? current : next.name.replace(/\.[^.]+$/, ""));
    };

    const submit = async () => {
        if (!file) {
            message.warning("请选择要导入的文件");
            return;
        }
        if (!title.trim()) {
            message.warning("请输入项目名称");
            return;
        }
        setUploading(true);
        try {
            const result = await uploadScriptSource({
                file,
                sourceType,
                contentType,
                title: title.trim(),
                encoding: isTextFile ? encoding : undefined,
                clientRequestId: requestIdRef.current,
            });
            message.success("原文已上传，正在解析结构与正文");
            reset();
            router.push(`/script/${result.projectId}?source=1`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "原文上传失败，请重试");
        } finally {
            setUploading(false);
        }
    };

    return (
        <Modal title="上传剧本 / 小说" open={open} onCancel={close} onOk={() => void submit()} confirmLoading={uploading} okText="上传并解析" cancelText="取消" width={560} destroyOnHidden>
            <div className="flex flex-col gap-4 pt-2">
                <p className="text-xs leading-5 text-[var(--studio-muted)]">上传后只保存原文与章节结构，不会生成人物、分集或正式剧本场次；结构可在工作台“原文”中人工校对。</p>
                <label className="flex flex-col gap-2 text-sm text-[var(--studio-text)]">导入类型
                    <Select value={sourceType} options={SOURCE_TYPES} onChange={setSourceType} />
                </label>
                <label className="flex flex-col gap-2 text-sm text-[var(--studio-text)]">内容形式
                    <Select value={contentType} options={CONTENT_TYPES} onChange={setContentType} />
                </label>
                <label className="flex flex-col gap-2 text-sm text-[var(--studio-text)]">原文件
                    <span className="flex items-center gap-3">
                        <Button icon={<Upload className="size-4" />} onClick={() => fileInputRef.current?.click()}>选择文件</Button>
                        <span className="min-w-0 flex-1 truncate text-xs text-[var(--studio-muted)]">{file ? file.name : "支持 TXT、DOCX、DOC，单文件不超过 50 MB"}</span>
                    </span>
                    <input ref={fileInputRef} type="file" accept=".txt,.docx,.doc" className="hidden" onChange={(event) => selectFile(event.target.files?.[0])} />
                </label>
                {isTextFile ? <label className="flex flex-col gap-2 text-sm text-[var(--studio-text)]">文本编码
                    <Select value={encoding} options={ENCODINGS} onChange={setEncoding} />
                </label> : null}
                <label className="flex flex-col gap-2 text-sm text-[var(--studio-text)]">项目名称
                    <Input value={title} maxLength={120} showCount onChange={(event) => setTitle(event.target.value)} placeholder="默认取文件名，可修改" />
                </label>
            </div>
        </Modal>
    );
}
