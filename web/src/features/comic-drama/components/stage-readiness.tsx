"use client";

import { useRouter } from "next/navigation";
import { Alert, Button, Card, Tag } from "antd";
import { ArrowRight, CheckCircle2, CircleAlert, ExternalLink, Sparkles, XCircle } from "lucide-react";

import { useComicDramaStore } from "../stores/use-comic-drama-store";

const STATUS_CONFIG = {
    ready: { label: "已具备", color: "success", icon: CheckCircle2, className: "text-emerald-500" },
    attention: { label: "建议补充", color: "warning", icon: CircleAlert, className: "text-amber-500" },
    missing: { label: "缺失项", color: "error", icon: XCircle, className: "text-rose-500" },
};

/** 生产准备度检查阶段视图。 */
export function StageReadiness() {
    const router = useRouter();
    const workspace = useComicDramaStore((state) => state.workspace);
    const setActiveStage = useComicDramaStore((state) => state.setActiveStage);

    if (!workspace) return null;

    const { readiness, scriptProjectId, scriptProject } = workspace;
    const readyCount = readiness.items.filter((item) => item.status === "ready").length;
    const attentionCount = readiness.items.filter((item) => item.status === "attention").length;
    const missingCount = readiness.items.filter((item) => item.status === "missing").length;

    const openScript = () => {
        router.push(`/script/${encodeURIComponent(scriptProjectId)}`);
    };

    return (
        <div className="flex flex-col gap-6">
            <header className="flex flex-col gap-2 border-b border-[var(--studio-line)] pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-[var(--studio-ink)]">剧本生产准备度检查</h2>
                    <p className="mt-1 text-sm text-[var(--studio-muted)]">
                        检查共享剧本、主要人物、场景与分集正文的完整度，确保生产前具备必要素材。系统不会自动补写或擅自修改剧本。
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button icon={<ExternalLink className="size-4" />} onClick={openScript}>
                        前往剧本工作台
                    </Button>
                    <Button
                        type="primary"
                        icon={<Sparkles className="size-4" />}
                        onClick={() => setActiveStage(workspace.shots.length > 0 ? "shots" : "settings")}
                    >
                        继续制作流程
                    </Button>
                </div>
            </header>

            {readiness.ready ? (
                <Alert
                    type="success"
                    showIcon
                    title="剧本生产准备已就绪"
                    description="故事梗概、主要人物、分集和场次正文已基本完善，可随时开始配置生产参数、建立视觉资产并拆分镜头。"
                />
            ) : missingCount > 0 ? (
                <Alert
                    type="error"
                    showIcon
                    title={`存在 ${missingCount} 项生产缺失项`}
                    description="部分核心内容尚未完善（如缺少正文或人物设定），可能导致自动拆镜头或视觉生成效果受限。建议先前往剧本工作台补充。"
                    action={
                        <Button size="small" type="primary" onClick={openScript}>
                            去完善
                        </Button>
                    }
                />
            ) : (
                <Alert
                    type="warning"
                    showIcon
                    title={`建议补充 ${attentionCount} 项设定`}
                    description="已有基本故事内容，但补充详细设定可以让镜头画面、分镜提示词和角色外观更为稳定一致。"
                />
            )}

            <div className="grid grid-cols-3 gap-4">
                <div className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4 text-center">
                    <p className="text-2xl font-bold text-emerald-500">{readyCount}</p>
                    <p className="mt-1 text-xs text-[var(--studio-muted)]">已具备项目</p>
                </div>
                <div className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4 text-center">
                    <p className="text-2xl font-bold text-amber-500">{attentionCount}</p>
                    <p className="mt-1 text-xs text-[var(--studio-muted)]">建议补充</p>
                </div>
                <div className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4 text-center">
                    <p className="text-2xl font-bold text-rose-500">{missingCount}</p>
                    <p className="mt-1 text-xs text-[var(--studio-muted)]">生产缺失项</p>
                </div>
            </div>

            <div className="flex flex-col gap-3">
                <h3 className="text-base font-medium text-[var(--studio-ink)]">检查明细</h3>
                <div className="grid gap-3">
                    {readiness.items.map((item) => {
                        const config = STATUS_CONFIG[item.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.attention;
                        const Icon = config.icon;
                        return (
                            <div
                                key={item.key}
                                className="flex items-start justify-between gap-4 rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4 transition-colors hover:border-[var(--studio-line-strong)]"
                            >
                                <div className="flex items-start gap-3">
                                    <Icon className={`mt-0.5 size-5 shrink-0 ${config.className}`} />
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-[var(--studio-ink)]">{item.title}</span>
                                            <Tag color={config.color}>{config.label}</Tag>
                                        </div>
                                        <p className="mt-1 text-sm text-[var(--studio-muted)]">{item.description}</p>
                                    </div>
                                </div>
                                <Button
                                    size="small"
                                    type="link"
                                    icon={<ArrowRight className="size-3.5" />}
                                    onClick={openScript}
                                >
                                    编辑剧本
                                </Button>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="mt-4 flex items-center justify-between rounded-xl border border-dashed border-[var(--studio-line)] p-4">
                <div>
                    <h4 className="text-sm font-semibold text-[var(--studio-ink)]">当前关联剧本：{scriptProject.overview.title}</h4>
                    <p className="text-xs text-[var(--studio-muted)]">
                        已规划 {scriptProject.episodes.length} 集 · 修订号 {workspace.revision} · 单一数据源安全共享
                    </p>
                </div>
                <Button type="primary" onClick={() => setActiveStage("settings")}>
                    进入生产设置
                </Button>
            </div>
        </div>
    );
}
