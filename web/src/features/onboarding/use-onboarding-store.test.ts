import assert from "node:assert/strict";
import test from "node:test";
import { useOnboardingStore } from "./stores/use-onboarding-store";

test("引导从第 0 步开始，可逐步推进，停止后复位", () => {
    const store = useOnboardingStore.getState();
    store.stop();
    assert.equal(useOnboardingStore.getState().active, false);
    assert.equal(useOnboardingStore.getState().step, 0);

    store.start();
    assert.equal(useOnboardingStore.getState().active, true);
    assert.equal(useOnboardingStore.getState().step, 0);

    store.setStep(3);
    assert.equal(useOnboardingStore.getState().step, 3);

    store.stop();
    assert.equal(useOnboardingStore.getState().active, false);
    assert.equal(useOnboardingStore.getState().step, 0);
});
