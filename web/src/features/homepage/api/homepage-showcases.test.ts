import assert from "node:assert/strict";
import test from "node:test";

import { homepageFallbackShowcases } from "./homepage-showcases";

test("首页静态回退内容包含首屏精选和精彩创作样例", () => {
    assert.equal(homepageFallbackShowcases.length, 18);
    assert.equal(
        homepageFallbackShowcases.slice(0, 3).every((item) => Boolean(item.category && item.creatorName)),
        true,
    );
    assert.equal(
        homepageFallbackShowcases.slice(3).every((item) => item.mediaUrl.startsWith("/homepage/fantastic-show/")),
        true,
    );
});
