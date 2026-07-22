import { useCallback, useEffect, useRef, useState } from "react";

import { createCanvasGenerationRequestRegistry } from "../services/canvas-generation-request-registry";

export function useCanvasGenerationRequests() {
    const registryRef = useRef(createCanvasGenerationRequestRegistry());
    const [requests, setRequests] = useState(() => registryRef.current.snapshot());

    const refresh = useCallback(() => setRequests(registryRef.current.snapshot()), []);

    const start = useCallback((targetNodeId: string, originNodeId: string, runningNodeId = originNodeId, controller = new AbortController()) => {
        const activeController = registryRef.current.start(targetNodeId, originNodeId, runningNodeId, controller);
        refresh();
        return activeController;
    }, [refresh]);

    const finish = useCallback((targetNodeId: string, controller: AbortController) => {
        if (registryRef.current.finish(targetNodeId, controller)) refresh();
    }, [refresh]);

    const stopByRunningId = useCallback((runningNodeId: string) => {
        const affectedNodeIds = registryRef.current.stopByRunningId(runningNodeId);
        if (affectedNodeIds.size) refresh();
        return affectedNodeIds;
    }, [refresh]);

    const isRunning = useCallback((runningNodeId: string) => registryRef.current.isRunning(runningNodeId), []);

    useEffect(() => () => registryRef.current.stopAll(), []);

    return { requests, start, finish, stopByRunningId, isRunning };
}
