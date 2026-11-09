"use client";

import { useRef, useState } from "react";
import { App, Button } from "antd";
import { ImageIcon, Upload, X } from "lucide-react";

import { useTranslation } from "@/features/locale/use-translation";
import { uploadImage } from "@/features/storage/services/image-storage";

type ProjectCoverFieldProps = {
    coverUrl: string;
    namespace: "script" | "comicDrama";
    disabled?: boolean;
    className?: string;
    /** 保存成功后的提示。创建项目时不传，只把地址交给表单。 */
    confirmText?: string;
    onChange: (coverUrl: string) => void | Promise<void>;
    onUploadingChange?: (uploading: boolean) => void;
};

/** 剧本与漫剧共用的封面上传。图片先进入对象存储，再把公开地址交给调用方保存。 */
export function ProjectCoverField({ coverUrl, namespace, disabled, className, confirmText, onChange, onUploadingChange }: ProjectCoverFieldProps) {
    const translate = useTranslation();
    const { message } = App.useApp();
    const inputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const labels = namespace === "script"
        ? {
            title: translate("script.cover"),
            hint: translate("script.coverIsSharedWithComicDrama"),
            upload: translate("script.uploadCover"),
            replace: translate("script.replaceCover"),
            remove: translate("script.removeCover"),
            uploadFailed: translate("script.coverUploadFailed"),
            chooseImage: translate("script.chooseAnImageFile"),
        }
        : {
            title: translate("comicDrama.cover"),
            hint: translate("comicDrama.coverIsSharedWithTheScript"),
            upload: translate("comicDrama.uploadCover"),
            replace: translate("comicDrama.replaceCover"),
            remove: translate("comicDrama.removeCover"),
            uploadFailed: translate("comicDrama.coverUploadFailed"),
            chooseImage: translate("comicDrama.chooseAnImageFile"),
        };

    const setBusy = (next: boolean) => {
        setUploading(next);
        onUploadingChange?.(next);
    };

    const apply = async (nextCoverUrl: string) => {
        await onChange(nextCoverUrl);
        if (confirmText) message.success(confirmText);
    };

    const upload = async (file?: File) => {
        if (!file || disabled) return;
        if (file.type && !file.type.startsWith("image/")) {
            message.warning(labels.chooseImage);
            return;
        }
        setBusy(true);
        try {
            const uploaded = await uploadImage(file);
            await apply(uploaded.url);
        } catch (error) {
            message.error(error instanceof Error ? error.message : labels.uploadFailed);
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        if (disabled || uploading) return;
        setBusy(true);
        try {
            await apply("");
        } catch (error) {
            message.error(error instanceof Error ? error.message : labels.uploadFailed);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className={className}>
            <span className="mb-2 block text-sm font-medium text-[var(--studio-text)]">{confirmText ? labels.title : namespace === "script" ? translate("script.coverOptional") : translate("comicDrama.coverOptional")}</span>
            <div className="flex items-start gap-3">
                <div className="h-28 w-44 shrink-0 overflow-hidden rounded-lg border border-[var(--studio-line)] bg-[var(--studio-surface)]">
                    {coverUrl ? <img src={coverUrl} alt="" className="size-full object-cover" /> : <div className="flex size-full items-center justify-center text-[var(--studio-faint)]"><ImageIcon className="size-6" aria-hidden="true" /></div>}
                </div>
                <div className="min-w-0">
                    <input
                        ref={inputRef}
                        hidden
                        type="file"
                        accept="image/*"
                        onChange={(event) => {
                            void upload(event.target.files?.[0]);
                            event.target.value = "";
                        }}
                    />
                    <div className="flex flex-wrap gap-2">
                        <Button icon={<Upload className="size-3.5" />} loading={uploading} disabled={disabled} onClick={() => inputRef.current?.click()}>
                            {coverUrl ? labels.replace : labels.upload}
                        </Button>
                        {coverUrl ? <Button icon={<X className="size-3.5" />} disabled={disabled || uploading} onClick={() => void remove()}>{labels.remove}</Button> : null}
                    </div>
                    <p className="mt-2 text-xs leading-5 text-[var(--studio-muted)]">{labels.hint}</p>
                </div>
            </div>
        </div>
    );
}
