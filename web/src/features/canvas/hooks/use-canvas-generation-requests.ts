import { useCallback, useEffect, useRef } from "react";

import { createCanvasGenerationRequestRegistry } from "../services/canvas-generation-request-registry";

export function useCanvasGenerationRequests() {
    const registryRef = useRef(createCanvasGenerationRequestRegistry());

    const start = useCallback((targetNodeId: string, originNodeId: string, runningNodeId = originNodeId, controller = new AbortController()) => {
        return registryRef.current.start(targetNodeId, originNodeId, runningNodeId, controller);
    }, []);

    const finish = useCallback((targetNodeId: string, controller: AbortController) => {
        return registryRef.current.finish(targetNodeId, controller);
    }, []);

    const stopByRunningId = useCallback((runningNodeId: string) => {
        return registryRef.current.stopByRunningId(runningNodeId);
    }, []);

    const isRunning = useCallback((runningNodeId: string) => registryRef.current.isRunning(runningNodeId), []);

    useEffect(() => () => registryRef.current.stopAll(), []);

    return { start, finish, stopByRunningId, isRunning };
}
