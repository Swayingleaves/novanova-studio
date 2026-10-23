import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";

import { generationLogQueryOptions, mergeGenerationLogPages } from "./generation-log-pagination";

type Conversation = { id: string };

/** 使用正式分页配置测试查询缓存与翻页行为。 */
function createObserver(context: TestContext, readPage: (page: number) => Promise<{ logs: Conversation[]; hasMore: boolean }>) {
    const client = new QueryClient();
    const observer = new InfiniteQueryObserver(client, generationLogQueryOptions("image", "user-1", readPage));
    context.after(() => { observer.destroy(); client.clear(); });
    return observer;
}

/** 构造按服务端顺序排列的任务。 */
function conversations(count: number) {
    return Array.from({ length: count }, (_, index) => ({ id: `conversation-${index + 1}` }));
}

test("首屏、下一页每次15条，末页停止请求", async (context) => {
    const source = conversations(31);
    const requests: number[] = [];
    const observer = createObserver(context, async (page) => {
        requests.push(page);
        return { logs: source.slice((page - 1) * 15, page * 15), hasMore: page * 15 < source.length };
    });

    const first = await observer.refetch();
    assert.equal(first.data?.pages[0].logs.length, 15);
    assert.equal(observer.getCurrentResult().hasNextPage, true);
    const second = await observer.fetchNextPage({ cancelRefetch: false });
    assert.equal(mergeGenerationLogPages(second.data!.pages).length, 30);
    const last = await observer.fetchNextPage({ cancelRefetch: false });
    assert.deepEqual(last.data?.pages.map((page) => page.logs.length), [15, 15, 1]);
    assert.equal(last.hasNextPage, false);
    await observer.fetchNextPage({ cancelRefetch: false });
    assert.deepEqual(requests, [1, 2, 3]);
});

test("快速重复触发滚动只请求一次下一页", async (context) => {
    let finishPage!: () => void;
    const pendingPage = new Promise<void>((resolve) => { finishPage = resolve; });
    const requests: number[] = [];
    const observer = createObserver(context, async (page) => {
        requests.push(page);
        if (page === 2) await pendingPage;
        return { logs: [{ id: `page-${page}` }], hasMore: page < 2 };
    });
    await observer.refetch();
    const firstScroll = observer.fetchNextPage({ cancelRefetch: false });
    const secondScroll = observer.fetchNextPage({ cancelRefetch: false });
    finishPage();
    await Promise.all([firstScroll, secondScroll]);
    assert.deepEqual(requests, [1, 2]);
    assert.deepEqual(observer.getCurrentResult().data?.pageParams, [1, 2]);
});

test("刷新重读已加载的所有页面，新增和删除后保持正确页边界", async (context) => {
    let source = conversations(31);
    const requests: number[] = [];
    const observer = createObserver(context, async (page) => {
        requests.push(page);
        return { logs: source.slice((page - 1) * 15, page * 15), hasMore: page * 15 < source.length };
    });
    await observer.refetch();
    await observer.fetchNextPage({ cancelRefetch: false });
    source = [{ id: "new-conversation" }, ...source.filter((conversation) => conversation.id !== "conversation-5")];
    const refreshed = await observer.refetch();
    assert.deepEqual(requests, [1, 2, 1, 2]);
    assert.deepEqual(mergeGenerationLogPages(refreshed.data!.pages), source.slice(0, 30));
    source = source.slice(0, 3);
    const afterDeletion = await observer.refetch();
    assert.deepEqual(afterDeletion.data?.pageParams, [1]);
    assert.equal(observer.getCurrentResult().hasNextPage, false);
    assert.deepEqual(mergeGenerationLogPages(afterDeletion.data!.pages), source);
});

test("下一页失败保留已有列表，重试同一页成功后再继续", async (context) => {
    let failing = true;
    const requests: number[] = [];
    const observer = createObserver(context, async (page) => {
        requests.push(page);
        if (page === 2 && failing) throw new Error("任务加载失败");
        return { logs: [{ id: `page-${page}` }], hasMore: page < 2 };
    });
    await observer.refetch();
    const failed = await observer.fetchNextPage({ cancelRefetch: false });
    assert.equal(failed.isFetchNextPageError, true);
    assert.deepEqual(failed.data?.pageParams, [1]);
    assert.equal(failed.hasNextPage, true);
    failing = false;
    const retried = await observer.fetchNextPage({ cancelRefetch: false });
    assert.equal(retried.error, null);
    assert.deepEqual(retried.data?.pageParams, [1, 2]);
    assert.deepEqual(requests, [1, 2, 2]);
});

test("刷新中途失败保留完整旧列表，避免新旧页面混合", async (context) => {
    let refreshing = false;
    const observer = createObserver(context, async (page) => {
        if (refreshing && page === 2) throw new Error("刷新第二页失败");
        return { logs: [{ id: `${refreshing ? "new" : "old"}-${page}` }], hasMore: true };
    });
    await observer.refetch();
    const loaded = await observer.fetchNextPage({ cancelRefetch: false });
    refreshing = true;
    const failed = await observer.refetch();
    assert.equal(failed.isRefetchError, true);
    assert.deepEqual(failed.data, loaded.data);
});

test("新任务引起相邻页面重复时保留服务端顺序并去重", () => {
    assert.deepEqual(mergeGenerationLogPages([
        { logs: [{ id: "new" }, { id: "existing" }], hasMore: true },
        { logs: [{ id: "existing" }, { id: "older" }], hasMore: false },
    ]), [{ id: "new" }, { id: "existing" }, { id: "older" }]);
});
