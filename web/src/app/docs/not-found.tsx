import Link from "next/link";
import { ArrowLeft, BookOpen } from "lucide-react";

export default function DocsNotFound() {
    return (
        <main className="flex min-h-dvh items-center justify-center bg-[var(--studio-page)] px-6 py-16 text-center text-[var(--studio-ink)]">
            <section className="max-w-md">
                <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-lg border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] text-[var(--studio-primary)]">
                    <BookOpen className="size-7" aria-hidden="true" />
                </div>
                <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--studio-primary)]">404</p>
                <h1 className="mt-3 text-3xl font-semibold">文档页面不存在</h1>
                <p className="mt-3 text-sm leading-6 text-[var(--studio-muted)]">Documentation page not found. The address may be incorrect or the page may have moved.</p>
                <Link href="/docs" className="mt-8 inline-flex min-h-11 items-center gap-2 rounded-lg bg-[var(--studio-primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--studio-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--studio-action)]">
                    <ArrowLeft className="size-4" aria-hidden="true" />
                    返回文档首页 / Back to docs
                </Link>
            </section>
        </main>
    );
}
