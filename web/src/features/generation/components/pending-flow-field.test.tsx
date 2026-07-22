import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { PendingFlowField } from "./pending-flow-field";

test("图片和视频占位动画展示统一生成状态，不再使用旋转加载器", () => {
    for (const variant of ["image", "video"] as const) {
        const markup = renderToStaticMarkup(<PendingFlowField aspectRatio={704 / 1280} variant={variant} />);

        assert.match(markup, /data-pending-generation-field="true"/);
        assert.match(markup, new RegExp(`data-pending-generation-variant="${variant}"`));
        assert.doesNotMatch(markup, /animate-spin/);
    }
});
