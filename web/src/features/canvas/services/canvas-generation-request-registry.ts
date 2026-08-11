export type CanvasGenerationRequest = {
    targetNodeId: string;
    originNodeId: string;
    runningNodeId: string;
    controller: AbortController;
};

export interface CanvasGenerationRequestRegistry {
    start(targetNodeId: string, originNodeId: string, runningNodeId: string, controller: AbortController): AbortController;
    finish(targetNodeId: string, controller: AbortController): boolean;
    stopByRunningId(runningNodeId: string): Set<string>;
    stopAll(): void;
    isRunning(runningNodeId: string): boolean;
}

export function createCanvasGenerationRequestRegistry(): CanvasGenerationRequestRegistry {
    const requests = new Map<string, CanvasGenerationRequest>();
    return {
        start(targetNodeId, originNodeId, runningNodeId, controller) {
            const previous = requests.get(targetNodeId);
            if (previous?.controller !== controller) previous?.controller.abort();
            requests.set(targetNodeId, { targetNodeId, originNodeId, runningNodeId, controller });
            return controller;
        },
        finish(targetNodeId, controller) {
            if (requests.get(targetNodeId)?.controller !== controller) return false;
            requests.delete(targetNodeId);
            return true;
        },
        stopByRunningId(runningNodeId) {
            const affectedNodeIds = new Set<string>();
            requests.forEach((request, targetNodeId) => {
                if (request.runningNodeId !== runningNodeId) return;
                request.controller.abort();
                requests.delete(targetNodeId);
                affectedNodeIds.add(request.targetNodeId);
                affectedNodeIds.add(request.originNodeId);
            });
            return affectedNodeIds;
        },
        stopAll() {
            requests.forEach((request) => request.controller.abort());
            requests.clear();
        },
        isRunning(runningNodeId) {
            return [...requests.values()].some((request) => request.runningNodeId === runningNodeId);
        },
    };
}
