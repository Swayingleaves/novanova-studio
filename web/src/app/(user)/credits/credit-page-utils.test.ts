import assert from "node:assert/strict";
import test from "node:test";

const { creditTransactionDetail, creditTransactionTypeLabel, formatCreditChange, formatCredits, generationSourceLabel, normalizeGenerationDistribution, normalizeModelDistribution } = await import(new URL("./credit-page-utils.ts", import.meta.url).href);

test("任务类型分布固定显示图片和视频的有效消耗", () => {
    assert.deepEqual(normalizeGenerationDistribution([
        { name: "video", consumedCredits: 18 },
        { name: "image", consumedCredits: 6 },
    ]), [
        { name: "图片生成", value: 6 },
        { name: "视频生成", value: 18 },
    ]);
});

test("模型分布忽略零消耗项", () => {
    assert.deepEqual(normalizeModelDistribution([
        { name: "模型一", consumedCredits: 0 },
        { name: "模型二", consumedCredits: 12 },
    ]), [{ name: "模型二", value: 12 }]);
});

test("历史流水缺少来源时明确显示未记录", () => {
    assert.equal(generationSourceLabel(null), "未记录");
    assert.equal(generationSourceLabel("canvas"), "无限画布");
});

test("分镜任务来源显示为分镜脚本", () => {
    assert.equal(generationSourceLabel("storyboard"), "分镜脚本");
});

test("积分流水类型映射为中文文案", () => {
    assert.equal(creditTransactionTypeLabel("task_charge"), "任务扣费");
    assert.equal(creditTransactionTypeLabel("task_refund"), "任务退款");
    assert.equal(creditTransactionTypeLabel("admin_adjustment"), "管理员调整");
    assert.equal(creditTransactionTypeLabel("card_redeem"), "卡密兑换");
    assert.equal(creditTransactionTypeLabel("initial_grant"), "初始发放");
});

test("积分变动格式化保留正负号", () => {
    assert.equal(formatCreditChange(1000), "+1,000");
    assert.equal(formatCreditChange(-500), "-500");
    assert.equal(formatCreditChange(0), "0");
});

test("缺失字段时积分格式化不崩溃", () => {
    assert.equal(formatCreditChange(undefined), "0");
    assert.equal(formatCredits(null), "0");
    assert.equal(creditTransactionTypeLabel(undefined), "未知类型");
});

test("任务流水详情显示生成类型与模型", () => {
    assert.equal(creditTransactionDetail("task_charge", "video", "agnes-video-v2.0", "视频生成任务扣费"), "视频生成 · agnes-video-v2.0");
    assert.equal(creditTransactionDetail("task_refund", "image", null, "图片生成任务退款"), "图片生成");
});

test("非任务流水详情显示变动原因", () => {
    assert.equal(creditTransactionDetail("card_redeem", null, null, "兑换积分卡密"), "兑换积分卡密");
    assert.equal(creditTransactionDetail("admin_adjustment", null, null, "活动补偿"), "活动补偿");
});
