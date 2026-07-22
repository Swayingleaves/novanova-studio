import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { PendingGenerationField } from "./pending-generation-field";

test("生成状态按媒体类型展示统一进度与辅助文本", () => {
    const imageMarkup = renderToStaticMarkup(<PendingGenerationField variant="image" />);
    const videoMarkup = renderToStaticMarkup(<PendingGenerationField variant="video" />);

    assert.match(imageMarkup, /data-pending-generation-field="true"/);
    assert.match(imageMarkup, /data-pending-generation-variant="image"/);
    assert.match(imageMarkup, /Image Agent/);
    assert.match(imageMarkup, /正在生成图片/);
    assert.match(imageMarkup, /animate-spin/);
    assert.doesNotMatch(imageMarkup, /pending-generation-scan-line|pending-generation-progress/);
    assert.match(videoMarkup, /data-pending-generation-variant="video"/);
    assert.match(videoMarkup, /Video Agent/);
    assert.match(videoMarkup, /正在生成视频/);
});
