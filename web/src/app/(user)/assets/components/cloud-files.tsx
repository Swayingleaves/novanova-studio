"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, App, Button, Empty, Input, Modal, Pagination, Select, Skeleton, Table, Tag, Tooltip } from "antd";
import { Download, Eye, File, FileAudio, FileImage, FileText, FileVideo, RefreshCw, Search, Trash2 } from "lucide-react";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { useTeamStore } from "@/features/team/stores/use-team-store";
import { useTranslation } from "@/features/locale/use-translation";
import { currentLanguageTag } from "@/features/locale/translate";
import { formatStorageFileBytes, storageFileCategories } from "@/features/storage/capacity-format";
import { createMediaDownloadFileName } from "@/features/storage/services/media-download-name";
import { deleteStorageFile, getStorageFileAccess, listStorageFiles, type StorageFile, type StorageFileQuery } from "@/services/api/storage";

const fileIcons = { image: FileImage, video: FileVideo, audio: FileAudio, document: FileText, other: File };

/** 实际云文件列表独立于收藏，按当前用户和空间查询、预览及清理。 */
export function CloudFiles() {
    const translate = useTranslation();
    const { message } = App.useApp();
    const userId = useUserStore((state) => state.user?.id);
    const teamId = useTeamStore((state) => state.team?.id || 0);
    const ready = useTeamStore((state) => state.ready);
    const [query, setQuery] = useState<StorageFileQuery>({ page: 1, pageSize: 20, keyword: "", category: "", sort: "newest" });
    const [search, setSearch] = useState("");
    const [previewFile, setPreviewFile] = useState<StorageFile | null>(null);
    const [previewFailed, setPreviewFailed] = useState(false);
    const [downloadingId, setDownloadingId] = useState<string>();
    const [deletingFile, setDeletingFile] = useState<StorageFile | null>(null);
    const [deleting, setDeleting] = useState(false);
    const files = useQuery({ queryKey: ["storageFiles", userId, teamId, query], queryFn: () => listStorageFiles(query), enabled: !!userId && ready, refetchInterval: 15_000 });
    const access = useQuery({
        queryKey: ["storageFileAccess", userId, teamId, previewFile?.objectId],
        queryFn: () => getStorageFileAccess(previewFile!.objectId, "preview"),
        enabled: !!previewFile && !!userId && ready,
        staleTime: 0,
        gcTime: 0,
        retry: false,
        refetchOnWindowFocus: false,
    });

    useEffect(() => {
        const timer = window.setTimeout(() => setQuery((current) => (current.keyword === search.trim() ? current : { ...current, keyword: search.trim(), page: 1 })), 300);
        return () => window.clearTimeout(timer);
    }, [search]);

    useEffect(() => {
        if (!files.data) return;
        const lastPage = Math.max(1, Math.ceil(files.data.total / query.pageSize));
        if (query.page > lastPage) setQuery((current) => ({ ...current, page: lastPage }));
    }, [files.data, query.page, query.pageSize]);

    const canPreview = (file: StorageFile) => file.status === "available" && /^(image|video|audio)\//.test(file.mimeType);
    const openPreview = (file: StorageFile) => {
        setPreviewFailed(false);
        setPreviewFile(file);
    };
    const retryPreview = () => {
        setPreviewFailed(false);
        void access.refetch();
    };
    const download = async (file: StorageFile) => {
        setDownloadingId(file.objectId);
        try {
            const result = await getStorageFileAccess(file.objectId, "download");
            if ((useTeamStore.getState().team?.id || 0) !== teamId || useUserStore.getState().user?.id !== userId) return;
            const anchor = document.createElement("a");
            anchor.href = result.url;
            if (file.category === "image" || file.category === "video") {
                const extension = file.fileName.match(/\.([^.]+)$/)?.[1] || file.mimeType.split("/")[1];
                anchor.download = createMediaDownloadFileName(file.category === "image" ? "img" : "video", extension);
            } else {
                anchor.download = file.fileName;
            }
            anchor.referrerPolicy = "no-referrer";
            document.body.append(anchor);
            anchor.click();
            anchor.remove();
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("storage.fileAccessFailed"));
        } finally {
            setDownloadingId(undefined);
        }
    };
    const confirmDelete = async () => {
        if (!deletingFile || deleting) return;
        setDeleting(true);
        try {
            await deleteStorageFile(deletingFile.objectId);
            setDeletingFile(null);
            message.success(translate("storage.fileDeletionQueued"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("storage.fileDeleteFailed"));
        } finally {
            setDeleting(false);
        }
    };
    const status = (file: StorageFile) =>
        file.status === "available" ? (
            <span className="text-xs text-[var(--studio-muted)]">{translate("storage.fileStatus_available")}</span>
        ) : (
            <Tag color={file.status === "deletionFailed" ? "error" : "processing"}>{translate(`storage.fileStatus_${file.status}`)}</Tag>
        );
    const actions = (file: StorageFile) => (
        <div className="flex flex-wrap items-center gap-1">
            {canPreview(file) ? (
                <Tooltip title={translate("storage.previewFile")}>
                    <Button type="text" icon={<Eye className="size-4" aria-hidden />} aria-label={`${translate("storage.previewFile")} ${file.fileName}`} onClick={() => openPreview(file)} />
                </Tooltip>
            ) : null}
            <Tooltip title={translate("storage.downloadFile")}>
                <Button
                    type="text"
                    disabled={file.status !== "available"}
                    loading={downloadingId === file.objectId}
                    icon={<Download className="size-4" aria-hidden />}
                    aria-label={`${translate("storage.downloadFile")} ${file.fileName}`}
                    onClick={() => void download(file)}
                />
            </Tooltip>
            <Tooltip title={translate(file.status === "deletionFailed" ? "storage.retryDeletion" : "storage.deleteFile")}>
                <Button type="text" danger disabled={file.status === "pendingDeletion"} icon={<Trash2 className="size-4" aria-hidden />} aria-label={`${translate("storage.deleteFile")} ${file.fileName}`} onClick={() => setDeletingFile(file)} />
            </Tooltip>
        </div>
    );
    const fileName = (file: StorageFile) => {
        const Icon = fileIcons[file.category];
        return (
            <div className="flex min-w-0 items-center gap-2">
                <Icon className="size-5 shrink-0 text-[var(--studio-muted)]" aria-hidden />
                <span className="min-w-0 truncate text-sm text-[var(--studio-ink)]" title={file.fileName}>
                    {file.fileName}
                </span>
            </div>
        );
    };
    const storedTime = (file: StorageFile) => new Date(file.storedAt).toLocaleString(currentLanguageTag(), { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

    return (
        <section className="space-y-4" aria-label={translate("storage.cloudFiles")}>
            <div className="flex flex-wrap gap-3">
                <Input
                    className="min-w-0! sm:max-w-sm"
                    prefix={<Search className="size-4 text-[var(--studio-muted)]" aria-hidden />}
                    allowClear
                    maxLength={200}
                    aria-label={translate("storage.searchFiles")}
                    placeholder={translate("storage.searchFiles")}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                />
                <Select
                    className="min-w-28"
                    aria-label={translate("storage.fileType")}
                    value={query.category}
                    options={[{ value: "", label: translate("storage.allFiles") }, ...storageFileCategories.map((category) => ({ value: category, label: translate(`storage.fileCategory_${category}`) }))]}
                    onChange={(category) => setQuery((current) => ({ ...current, category, page: 1 }))}
                />
                <Select
                    className="min-w-36"
                    aria-label={translate("storage.sortFiles")}
                    value={query.sort}
                    options={["newest", "oldest", "largest", "smallest"].map((sort) => ({ value: sort, label: translate(`storage.fileSort_${sort}`) }))}
                    onChange={(sort: StorageFileQuery["sort"]) => setQuery((current) => ({ ...current, sort, page: 1 }))}
                />
                <Tooltip title={translate("storage.refreshFiles")}>
                    <Button className="ml-auto" icon={<RefreshCw className="size-4" aria-hidden />} aria-label={translate("storage.refreshFiles")} loading={files.isFetching} onClick={() => void files.refetch()} />
                </Tooltip>
            </div>
            {files.isError ? (
                <Alert
                    type="error"
                    showIcon
                    title={translate("storage.filesLoadFailed")}
                    action={
                        <Button size="small" onClick={() => void files.refetch()}>
                            {translate("storage.retry")}
                        </Button>
                    }
                />
            ) : null}
            {files.isPending ? (
                <Skeleton active paragraph={{ rows: 6 }} />
            ) : files.data?.items.length ? (
                <>
                    <div className="hidden md:block">
                        <Table<StorageFile>
                            rowKey="objectId"
                            dataSource={files.data.items}
                            pagination={false}
                            size="middle"
                            scroll={{ x: 900 }}
                            columns={[
                                { title: translate("storage.fileName"), key: "name", width: 260, render: (_, file) => fileName(file) },
                                { title: translate("storage.fileType"), dataIndex: "category", width: 80, render: (category: StorageFile["category"]) => translate(`storage.fileCategory_${category}`) },
                                { title: translate("storage.fileSize"), dataIndex: "fileBytes", width: 100, render: (bytes: string) => <span className="tabular-nums">{formatStorageFileBytes(bytes)}</span> },
                                { title: translate("storage.fileSource"), dataIndex: "sourceType", width: 110, render: (source: StorageFile["sourceType"]) => translate(`storage.fileSourceType_${source}`) },
                                { title: translate("storage.storedAt"), key: "time", width: 160, render: (_, file) => <span className="text-xs text-[var(--studio-muted)]">{storedTime(file)}</span> },
                                { title: translate("storage.fileState"), key: "status", width: 120, render: (_, file) => status(file) },
                                { title: translate("storage.capacityActions"), key: "actions", width: 120, render: (_, file) => actions(file) },
                            ]}
                        />
                    </div>
                    <ul className="divide-y divide-[var(--studio-line)] md:hidden">
                        {files.data.items.map((file) => (
                            <li key={file.objectId} className="space-y-3 py-4">
                                <div>{fileName(file)}</div>
                                <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--studio-muted)]">
                                    <span className="tabular-nums">{formatStorageFileBytes(file.fileBytes)}</span>
                                    <span>{translate(`storage.fileCategory_${file.category}`)}</span>
                                    <span>{translate(`storage.fileSourceType_${file.sourceType}`)}</span>
                                </div>
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="space-y-1">
                                        <p className="text-xs text-[var(--studio-muted)]">{storedTime(file)}</p>
                                        {status(file)}
                                    </div>
                                    {actions(file)}
                                </div>
                            </li>
                        ))}
                    </ul>
                </>
            ) : files.data ? (
                <Empty className="py-12" image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate(query.keyword || query.category ? "storage.noMatchingFiles" : "storage.noCloudFiles")} />
            ) : null}
            {files.data?.total ? (
                <Pagination
                    className="justify-center!"
                    responsive
                    current={query.page}
                    pageSize={query.pageSize}
                    total={files.data.total}
                    showSizeChanger
                    pageSizeOptions={[20, 50, 100]}
                    onChange={(page, pageSize) => setQuery((current) => ({ ...current, page, pageSize }))}
                />
            ) : null}
            <p className="text-xs text-[var(--studio-muted)]">{translate("storage.deletionReleaseNotice")}</p>
            <Modal open={!!previewFile} title={previewFile?.fileName} footer={null} width={820} style={{ maxWidth: "calc(100vw - 32px)" }} onCancel={() => setPreviewFile(null)} destroyOnHidden>
                {access.isFetching ? (
                    <Skeleton active paragraph={{ rows: 4 }} />
                ) : access.isError || previewFailed ? (
                    <Alert type="error" showIcon title={translate("storage.fileAccessFailed")} action={<Button onClick={retryPreview}>{translate("storage.retry")}</Button>} />
                ) : access.data && previewFile ? (
                    <div className="space-y-4 pt-2">
                        {previewFile.category === "image" ? (
                            <img src={access.data.url} alt={previewFile.fileName} className="max-h-[60vh] w-full rounded-lg object-contain" referrerPolicy="no-referrer" onError={() => setPreviewFailed(true)} />
                        ) : previewFile.category === "video" ? (
                            <video key={access.data.url} src={access.data.url} controls preload="metadata" className="max-h-[60vh] w-full rounded-lg" onError={() => setPreviewFailed(true)} />
                        ) : (
                            <audio key={access.data.url} src={access.data.url} controls preload="metadata" className="w-full" onError={() => setPreviewFailed(true)} />
                        )}
                        <Button icon={<Download className="size-4" aria-hidden />} loading={downloadingId === previewFile.objectId} onClick={() => void download(previewFile)}>
                            {translate("storage.downloadFile")}
                        </Button>
                    </div>
                ) : null}
            </Modal>
            <Modal
                title={translate("storage.deleteFile")}
                open={!!deletingFile}
                onCancel={() => !deleting && setDeletingFile(null)}
                onOk={() => void confirmDelete()}
                okText={translate("storage.confirmDeleteFile")}
                cancelText={translate("storage.cancelCapacityPurchase")}
                okButtonProps={{ danger: true }}
                confirmLoading={deleting}
                closable={!deleting}
                mask={{ closable: !deleting }}
            >
                <p className="break-all py-2 text-sm">{translate("storage.deleteFileConfirmation", { value0: deletingFile?.fileName ?? "" })}</p>
                <Alert type="warning" showIcon title={translate("storage.fileReferenceWarning")} />
            </Modal>
        </section>
    );
}
