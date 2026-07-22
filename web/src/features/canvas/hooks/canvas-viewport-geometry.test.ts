import assert from "node:assert/strict";
import test from "node:test";

import { convertScreenPointToCanvas } from "./canvas-viewport-geometry.ts";

test("屏幕坐标按照容器偏移和缩放转换为画布坐标", () => {
    assert.deepEqual(
        convertScreenPointToCanvas({ x: 310, y: 220 }, { left: 10, top: 20 }, { x: 100, y: 50, k: 2 }),
        { x: 100, y: 75 },
    );
});
