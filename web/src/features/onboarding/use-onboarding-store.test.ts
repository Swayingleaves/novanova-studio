import assert from "node:assert/strict";
import test from "node:test";
import { useOnboardingStore } from "./stores/use-onboarding-store";

test("两种导览互斥：启动一种会覆盖另一种，停止后清空", () => {
    const store = useOnboardingStore.getState();
    store.stop();
    assert.equal(useOnboardingStore.getState().tour, null);
    assert.equal(useOnboardingStore.getState().step, 0);

    store.start("global");
    assert.equal(useOnboardingStore.getState().tour, "global");
    assert.equal(useOnboardingStore.getState().step, 0);

    store.setStep(3);
    assert.equal(useOnboardingStore.getState().step, 3);

    store.start("creation");
    assert.equal(useOnboardingStore.getState().tour, "creation");
    assert.equal(useOnboardingStore.getState().step, 0);

    store.stop();
    assert.equal(useOnboardingStore.getState().tour, null);
    assert.equal(useOnboardingStore.getState().step, 0);
});
