import { Home } from "lucide-react";
import Link from "next/link";

/**
 * 全局 404 页：居中卡片提示页面不存在并提供返回首页入口。
 * <p>
 * 背景使用细微圆点纹理。
 */
export default function NotFound() {
    return (
        <div className="flex h-dvh flex-col overflow-hidden bg-background text-[var(--studio-ink)]">
            <main
                className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-background px-6 py-10 text-[var(--studio-ink)]"
                style={{ backgroundImage: "radial-gradient(var(--studio-line) 1px, transparent 1px)", backgroundSize: "16px 16px" }}
            >
                <section className="w-full max-w-md text-center">
                    <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-lg border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] text-2xl font-semibold shadow-[var(--studio-shadow)]">
                        404
                    </div>
                    <h1 className="text-3xl font-semibold tracking-normal">页面不存在</h1>
                    <p className="mt-3 text-sm leading-6 text-[var(--studio-muted)]">
                        这个地址没有对应的页面，可能已经移动或被合并到其他入口。
                    </p>
                    <div className="mt-8 flex flex-wrap justify-center gap-3">
                        <Link
                            href="/"
                            className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--studio-primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--studio-primary-hover)]"
                        >
                            <Home className="size-4" />
                            返回首页
                        </Link>
                    </div>
                </section>
            </main>
        </div>
    );
}
