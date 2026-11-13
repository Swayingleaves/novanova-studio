import assert from "node:assert/strict";
import test from "node:test";

import { fitThumbnailSize, IMAGE_LIST_THUMBNAIL_EDGE } from "./image-list-thumbnail.ts";

test("列表缩略图按长边缩小且不放大小图", () => {
    assert.deepEqual(fitThumbnailSize(2048, 1024), { width: IMAGE_LIST_THUMBNAIL_EDGE, height: 80 });
    assert.deepEqual(fitThumbnailSize(100, 400), { width: 40, height: IMAGE_LIST_THUMBNAIL_EDGE });
    assert.deepEqual(fitThumbnailSize(80, 60), { width: 80, height: 60 });
});
