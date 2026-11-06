"use client";
import { useEffect, useState } from "react";
import { Alert, App, Button, Checkbox, Form, Input, Modal, Select, Spin } from "antd";
import { FANTASTIC_SHOW_CATEGORIES } from "@/features/homepage/lib/fantastic-show";
import { useTeamStore } from "@/features/team/stores/use-team-store";
import { previewSharedWork, submitSharedWork, type ShareForm, type SharedSnapshot } from "@/services/api/shared-work";
import { useSharedWorkStore } from "../stores/use-shared-work-store";
import { SharedContent } from "./shared-content";

/** 所有入口共用服务端快照预览与发布表单。 */
export function ShareWorkDialog() {
    const source = useSharedWorkStore((state) => state.source);
    const beforePreview = useSharedWorkStore((state) => state.beforePreview);
    const close = useSharedWorkStore((state) => state.close);
    const team = useTeamStore((state) => state.team);
    const { message } = App.useApp();
    const [form] = Form.useForm<Pick<ShareForm, "title" | "description" | "category">>();
    const [includeInformation, setIncludeInformation] = useState(false);
    const [preview, setPreview] = useState<{ snapshot: SharedSnapshot; sourceVersion: string } | null>(null);
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [attempt, setAttempt] = useState(0);
    const [requestId, setRequestId] = useState("");
    useEffect(() => { if (source) { form.resetFields(); setIncludeInformation(false); setRequestId(crypto.randomUUID()); } }, [source, form]);
    useEffect(() => {
        if (!source) return;
        const controller = new AbortController();
        setPreview(null); setLoading(true); setError("");
        const read = async () => {
            await beforePreview?.();
            return previewSharedWork({ ...source, title: "作品预览", description: "", category: "视觉海报", includeGenerationInformation: includeInformation, requestId: "preview" }, controller.signal);
        };
        void read().then((result) => { if (!controller.signal.aborted) setPreview(result); }).catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "读取分享预览失败"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, [source, beforePreview, includeInformation, attempt]);
    const submit = async () => {
        if (!source || !preview || submitting) return;
        try {
            const fields = await form.validateFields();
            setSubmitting(true);
            await submitSharedWork({ ...source, ...fields, description: fields.description || "", includeGenerationInformation: includeInformation, requestId, sourceVersion: preview.sourceVersion });
            message.success("已提交，正在后台准备分享，可在我的分享中查看进度"); close();
        } catch (failure) { if (failure instanceof Error) setError(failure.message); }
        finally { setSubmitting(false); }
    };
    return <Modal title="分享作品" open={Boolean(source)} onCancel={() => { if (!submitting) close(); }} mask={{ closable: !submitting }} keyboard={!submitting} closable={!submitting} width={920} centered styles={{ body: { maxHeight: "calc(100dvh - 200px)", overflowY: "auto", paddingRight: 8 } }} destroyOnHidden footer={<><Button disabled={submitting} onClick={close}>取消</Button><Button type="primary" loading={submitting} disabled={loading || !preview} onClick={() => void submit()}>提交审核</Button></>}>
        <div className="space-y-5">
            <Alert type="info" showIcon title={team ? "提交后由当前团队管理员审核" : "提交后由平台管理员审核"} description="提交后立即返回，媒体副本在后台准备，无需停留在此页面。准备完成后进入审核。分享保存固定快照和独立媒体副本，占用当前空间存储容量。后续修改或删除原内容不会改变分享；需要更新时请重新投稿。" />
            {source?.workType === "canvas" ? <Alert type="warning" showIcon title="完整画布将公开节点、连线、文字、提示词及素材" description="不公开助手聊天、运行记录和账号配置。访客登录后可独立复制画布。请在下方确认公开内容。" /> : <Checkbox checked={includeInformation} disabled={submitting} onChange={(event) => setIncludeInformation(event.target.checked)}>公开提示词、模型和生成参数（不公开参考素材）</Checkbox>}
            {error ? <Alert type="error" showIcon title={error} action={<Button size="small" disabled={submitting} onClick={() => setAttempt((value) => value + 1)}>重新预览</Button>} /> : null}
            {loading ? <div className="grid min-h-48 place-items-center"><Spin description="正在保存并读取公开预览" /></div> : preview ? <SharedContent snapshot={preview.snapshot} /> : null}
            <Form form={form} layout="vertical" initialValues={{ category: "视觉海报" }} disabled={submitting}>
                <Form.Item name="title" label="标题" rules={[{ required: true, whitespace: true, message: "请填写标题" }, { max: 200 }]}><Input maxLength={200} showCount /></Form.Item>
                <Form.Item name="description" label="简介" rules={[{ max: 2000 }]}><Input.TextArea maxLength={2000} showCount autoSize={{ minRows: 2, maxRows: 5 }} /></Form.Item>
                <Form.Item name="category" label="分类" rules={[{ required: true }]}><Select options={FANTASTIC_SHOW_CATEGORIES.filter((value) => value !== "全部").map((value) => ({ label: value, value }))} /></Form.Item>
            </Form>
        </div>
    </Modal>;
}
