import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { PendingGenerationField } from "./pending-generation-field";

test("生成状态按媒体类型展示骨架屏与右上角进度", () => {
    const imageMarkup = renderToStaticMarkup(<PendingGenerationField variant="image" progress={42} />);
    const videoMarkup = renderToStaticMarkup(<PendingGenerationField variant="video" />);

    assert.match(imageMarkup, /data-pending-generation-field="true"/);
    assert.match(imageMarkup, /data-pending-generation-variant="image"/);
    assert.match(imageMarkup, /studio-skeleton studio-skeleton-media/);
    assert.match(imageMarkup, /42%/);
    assert.doesNotMatch(imageMarkup, /animate-spin/);
    assert.match(videoMarkup, /data-pending-generation-variant="video"/);
    assert.match(videoMarkup, /studio-skeleton studio-skeleton-media/);
    assert.doesNotMatch(videoMarkup, /%/);
});
