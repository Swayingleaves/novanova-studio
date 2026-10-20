import assert from "node:assert/strict";
import test from "node:test";
import { cloneImageSizeMappings, IMAGE_ASPECT_RATIOS, normalizeImageSizeMappings } from "./image-size-mappings";

test("默认尺寸严格对应最终13种比例与三档像素，比例顺序保持一致", () => {
    const expected = [
        ["1:1", "1024x1024", "2048x2048", "2880x2880"],
        ["1:2", "512x1024", "1024x2048", "1648x3296"],
        ["2:1", "1024x512", "2048x1024", "3296x1648"],
        ["9:16", "720x1280", "1152x2048", "2160x3840"],
        ["16:9", "1280x720", "2048x1152", "3840x2160"],
        ["3:4", "864x1152", "1536x2048", "2448x3264"],
        ["4:3", "1152x864", "2048x1536", "3264x2448"],
        ["3:2", "1536x1024", "2400x1600", "3456x2304"],
        ["2:3", "1024x1536", "1600x2400", "2304x3456"],
        ["5:4", "1120x896", "2240x1792", "3200x2560"],
        ["4:5", "896x1120", "1792x2240", "2560x3200"],
        ["21:9", "1344x576", "2016x864", "3808x1632"],
        ["9:21", "576x1344", "864x2016", "1632x3808"],
    ];
    assert.deepEqual(IMAGE_ASPECT_RATIOS, expected.map(([ratio]) => ratio));
    const defaults = cloneImageSizeMappings();
    for (const [ratio, first, second, fourth] of expected) assert.deepEqual(defaults[ratio], { "1K": first, "2K": second, "4K": fourth });
});

test("模型尺寸表深拷贝且恢复默认不会影响其他模型", () => {
    const first = cloneImageSizeMappings();
    const second = cloneImageSizeMappings();
    first["1:1"]["4K"] = "4096x4096";
    assert.equal(second["1:1"]["4K"], "2880x2880");
    assert.equal(cloneImageSizeMappings()["1:1"]["4K"], "2880x2880");
    assert.equal(cloneImageSizeMappings(first)["1:1"]["4K"], "4096x4096");
});

test("自定义尺寸可规范化乘号，未填档位保持未配置", () => {
    const mappings = normalizeImageSizeMappings({ "1:1": { "1K": " 1024 × 1024 ", "2K": "2048 X 2048", "4K": "" } });
    assert.deepEqual(mappings, { "1:1": { "1K": "1024x1024", "2K": "2048x2048" } });
    assert.deepEqual(normalizeImageSizeMappings({}), {});
    for (const pixels of ["0x1024", "-1x1024", "1.5x1024", "1024", "1024:1024"]) {
        assert.throws(() => normalizeImageSizeMappings({ "1:1": { "4K": pixels } }));
    }
});
