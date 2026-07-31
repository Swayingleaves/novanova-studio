"use client";

import { useCallback, useReducer } from "react";

import type { ThinkingBlockState } from "./types";

export type AgentThinkingState = {
  completedThinkings: ThinkingBlockState[];
  activeThinking: ThinkingBlockState | null;
};

export type AgentThinkingAction =
  | { type: "delta"; thoughtId: string; delta: string }
  | { type: "complete"; thoughtId: string; durationMs: number }
  | { type: "reset" };

export const initialAgentThinkingState: AgentThinkingState = {
  completedThinkings: [],
  activeThinking: null,
};

/**
 * 归并主Agent思考增量、完成和清理动作。
 */
export function agentThinkingReducer(state: AgentThinkingState, action: AgentThinkingAction): AgentThinkingState {
  if (action.type === "reset") {
    return initialAgentThinkingState;
  }
  if (action.type === "delta") {
    if (!action.thoughtId || !action.delta) return state;
    const activeThinking = state.activeThinking?.id === action.thoughtId
      ? { ...state.activeThinking, text: state.activeThinking.text + action.delta }
      : { id: action.thoughtId, text: action.delta, durationMs: 0, collapsed: false };
    return { ...state, activeThinking };
  }
  if (state.activeThinking?.id !== action.thoughtId) {
    return state;
  }
  const completedThinking = {
    ...state.activeThinking,
    durationMs: Math.max(0, action.durationMs),
    collapsed: true,
  };
  return {
    completedThinkings: [...state.completedThinkings, completedThinking],
    activeThinking: null,
  };
}

/**
 * 管理当前任务的瞬时主Agent思考状态。
 */
export function useAgentThinking() {
  const [state, dispatch] = useReducer(agentThinkingReducer, initialAgentThinkingState);
  const onThoughtDelta = useCallback((thoughtId: string, delta: string) => {
    dispatch({ type: "delta", thoughtId, delta });
  }, []);
  const onThoughtComplete = useCallback((thoughtId: string, durationMs: number) => {
    dispatch({ type: "complete", thoughtId, durationMs });
  }, []);
  const resetThinkings = useCallback(() => dispatch({ type: "reset" }), []);

  return { ...state, onThoughtDelta, onThoughtComplete, resetThinkings };
}
