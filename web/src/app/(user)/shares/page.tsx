"use client";
import { SharedWorkList } from "@/features/shared-work/components/shared-work-list";

export default function MySharesPage() {
    return <main className="studio-page h-full overflow-y-auto"><div className="mx-auto max-w-5xl space-y-6 px-4 pb-6 pt-20 sm:px-6 md:pt-6"><header><h1 className="studio-title text-2xl font-semibold">我的分享</h1><p className="studio-subtitle mt-2 text-sm">查看审核进度与公开链接。分享为固定快照，更新内容请重新投稿。</p></header><SharedWorkList /></div></main>;
}
