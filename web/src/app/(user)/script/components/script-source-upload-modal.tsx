"use client";

import { translateMessage } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";

import { useRef, useState } from "react";
import { useRouter } from "@/shared/lib/team-navigation";
import { nanoid } from "nanoid";
import { App, Button, Input, Modal, Select } from "antd";
import { Upload } from "lucide-react";

import { uploadScriptSource } from "@/services/api/script";
import type { ScriptContentType, ScriptSourceFileEncoding, ScriptSourceType } from "@/features/script/types";

const getContentTypes = (translate = translateMessage): Array<{ value: ScriptContentType; label: string }> => ([
    { value: "comicDrama", label: translate("script.comicDrama") },
    { value: "liveActionShort", label: translate("script.liveActionShortDrama") },
    { value: "animation", label: translate("script.animation") },
    { value: "advertisement", label: translate("script.advertisementPromotionalVideo") },
    { value: "musicVideo", label: translate("script.musicVideo") },
    { value: "storyShort", label: translate("script.shortFilm") },
]);

const getSourceTypes = (translate = translateMessage): Array<{ value: ScriptSourceType; label: string }> => ([
    { value: "novel", label: translate("script.novel") },
    { value: "script", label: translate("script.script") },
]);

const getEncodings = (translate = translateMessage): Array<{ value: ScriptSourceFileEncoding; label: string }> => ([
    { value: "UTF-8", label: translate("script.utf8Default") },
    { value: "GB18030", label: translate("script.gb18030LegacySimplifiedChinese") },
]);

/** 沿用服务端单文件上传上限。 */
const MAX_FILE_BYTES = 50 * 1024 * 1024;

const SUPPORTED_EXTENSIONS = ["txt", "docx", "doc"];

/** 上传剧本或小说原文弹窗，创建剧本项目并异步解析原文结构。 */
export function ScriptSourceUploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const translate = useTranslation();
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
            message.error(translate("script.onlyTxtDocxAndDocFilesAreSupported"));
            return;
        }
        if (next.size > MAX_FILE_BYTES) {
            message.error(translate("script.theFileExceedsThe50MbLimit"));
            return;
        }
        setFile(next);
        /* 项目名称默认取文件名，用户改过后不再覆盖。 */
        setTitle((current) => current.trim() ? current : next.name.replace(/\.[^.]+$/, ""));
    };

    const submit = async () => {
        if (!file) {
            message.warning(translate("script.selectAFileToImport"));
            return;
        }
        if (!title.trim()) {
            message.warning(translate("script.enterAProjectName"));
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
            message.success(translate("script.sourceUploadedParsingStructureAndText"));
            reset();
            router.push(`/script/${result.projectId}?source=1`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("script.couldNotUploadTheSourceTryAgain"));
        } finally {
            setUploading(false);
        }
    };

    return (
        <Modal title={translate("script.uploadScriptNovel")} open={open} onCancel={close} onOk={() => void submit()} confirmLoading={uploading} okText={translate("script.uploadAndParse")} cancelText={translate("script.cancel")} width={560} destroyOnHidden>
            <div className="flex flex-col gap-4 pt-2">
                <p className="text-xs leading-5 text-[var(--studio-muted)]">{translate("script.uploadingSavesOnlySourceTextAndChapterStructureItDoes")}</p>
                <label className="flex flex-col gap-2 text-sm text-[var(--studio-text)]">{translate("script.importType")}<Select value={sourceType} options={getSourceTypes(translate)} onChange={setSourceType} />
                </label>
                <label className="flex flex-col gap-2 text-sm text-[var(--studio-text)]">{translate("script.contentFormat")}<Select value={contentType} options={getContentTypes(translate)} onChange={setContentType} />
                </label>
                <label className="flex flex-col gap-2 text-sm text-[var(--studio-text)]">{translate("script.sourceFile")}<span className="flex items-center gap-3">
                        <Button icon={<Upload className="size-4" />} onClick={() => fileInputRef.current?.click()}>{translate("script.chooseFile")}</Button>
                        <span className="min-w-0 flex-1 truncate text-xs text-[var(--studio-muted)]">{file ? file.name : translate("script.txtDocxOrDocUpTo50MbPerFile")}</span>
                    </span>
                    <input ref={fileInputRef} type="file" accept=".txt,.docx,.doc" className="hidden" onChange={(event) => selectFile(event.target.files?.[0])} />
                </label>
                {isTextFile ? <label className="flex flex-col gap-2 text-sm text-[var(--studio-text)]">{translate("script.textEncoding")}<Select value={encoding} options={getEncodings(translate)} onChange={setEncoding} />
                </label> : null}
                <label className="flex flex-col gap-2 text-sm text-[var(--studio-text)]">{translate("script.projectName")}<Input value={title} maxLength={120} showCount onChange={(event) => setTitle(event.target.value)} placeholder={translate("script.defaultsToTheFileNameEditable")} />
                </label>
            </div>
        </Modal>
    );
}
