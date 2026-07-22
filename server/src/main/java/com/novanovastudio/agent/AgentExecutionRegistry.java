package com.novanovastudio.agent;

import com.alibaba.fastjson2.JSONObject;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import reactor.core.Disposable;
import org.springframework.stereotype.Component;

/**
 * Agent 会话执行登记，用于关联运行中的 Agent Loop 与已创建的生成任务。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-18 22:20
 */
@Component
public class AgentExecutionRegistry {

    /** sessionId 到执行状态的映射 */
    private final ConcurrentHashMap<String, ExecutionState> executions = new ConcurrentHashMap<>();

    /**
     * 登记新的 Agent 会话执行。
     *
     * @param userId Long 当前用户ID
     * @param sessionId String Agent 会话ID
     */
    public void open(Long userId, String sessionId) {
        executions.put(sessionId, new ExecutionState(userId));
    }

    /**
     * 关联 Agent Loop 的订阅控制器。
     *
     * @param sessionId String Agent 会话ID
     * @param subscription Disposable Agent Loop 订阅控制器
     */
    public void attachSubscription(String sessionId, Disposable subscription) {
        ExecutionState state = executions.get(sessionId);
        if (state == null) {
            subscription.dispose();
            return;
        }
        boolean shouldDispose;
        synchronized (state) {
            state.subscription = subscription;
            shouldDispose = state.cancelRequested && state.creatingTaskCount == 0;
        }
        if (shouldDispose) {
            subscription.dispose();
        }
    }

    /**
     * 登记本会话新创建的生成任务。
     *
     * @param sessionId String Agent 会话ID
     * @param task AgentTaskRegistration 任务与取消态轮次信息
     * @return boolean 当前会话是否已请求取消
     */
    public boolean registerTask(String sessionId, AgentTaskRegistration task) {
        ExecutionState state = executions.get(sessionId);
        if (state == null) {
            return true;
        }
        synchronized (state) {
            state.tasks.put(task.taskId(), task);
            return state.cancelRequested;
        }
    }

    /**
     * 标记会话开始创建生成任务，用于覆盖创建与取消并发窗口。
     *
     * @param sessionId String Agent 会话ID
     */
    public void beginTaskCreation(String sessionId) {
        ExecutionState state = executions.get(sessionId);
        if (state == null) {
            return;
        }
        synchronized (state) {
            state.creatingTaskCount++;
        }
    }

    /**
     * 标记会话完成创建生成任务；已请求取消时中止 Agent Loop。
     *
     * @param sessionId String Agent 会话ID
     */
    public void completeTaskCreation(String sessionId) {
        ExecutionState state = executions.get(sessionId);
        if (state == null) {
            return;
        }
        Disposable subscription = null;
        synchronized (state) {
            state.creatingTaskCount = Math.max(0, state.creatingTaskCount - 1);
            if (state.cancelRequested && state.creatingTaskCount == 0) {
                subscription = state.subscription;
            }
        }
        if (subscription != null) {
            subscription.dispose();
        }
    }

    /**
     * 移除已结束的生成任务。
     *
     * @param sessionId String Agent 会话ID
     * @param taskId String 生成任务ID
     */
    public void removeTask(String sessionId, String taskId) {
        ExecutionState state = executions.get(sessionId);
        if (state != null) {
            state.tasks.remove(taskId);
        }
    }

    /**
     * 判断会话是否已经请求取消。
     *
     * @param sessionId String Agent 会话ID
     * @return boolean 是否已经请求取消
     */
    public boolean isCancelRequested(String sessionId) {
        ExecutionState state = executions.get(sessionId);
        return state != null && state.cancelRequested;
    }

    /**
     * 请求取消指定用户的活跃 Agent 会话。
     *
     * @param userId Long 当前用户ID
     * @param sessionId String Agent 会话ID
     * @return AgentCancellation 会话是否活跃及已创建任务快照
     */
    public AgentCancellation requestCancellation(Long userId, String sessionId) {
        ExecutionState state = executions.get(sessionId);
        if (state == null || !state.userId.equals(userId)) {
            return AgentCancellation.inactive();
        }
        synchronized (state) {
            state.cancelRequested = true;
            return new AgentCancellation(true, List.copyOf(state.tasks.values()));
        }
    }

    /**
     * 清除未实际取消任务时预先写入的取消标记。
     *
     * @param sessionId String Agent 会话ID
     */
    public void clearCancellation(String sessionId) {
        ExecutionState state = executions.get(sessionId);
        if (state == null) {
            return;
        }
        synchronized (state) {
            state.cancelRequested = false;
        }
    }

    /**
     * 停止尚未创建生成任务的 Agent Loop。
     *
     * @param sessionId String Agent 会话ID
     */
    public void disposeIfTaskless(String sessionId) {
        ExecutionState state = executions.get(sessionId);
        if (state == null) {
            return;
        }
        Disposable subscription = null;
        synchronized (state) {
            if (state.tasks.isEmpty() && state.creatingTaskCount == 0) {
                subscription = state.subscription;
            }
        }
        if (subscription != null) {
            subscription.dispose();
        }
    }

    /**
     * 在没有进行中任务创建时停止会话的 Agent Loop。
     *
     * @param sessionId String Agent 会话ID
     */
    public void disposeWhenReady(String sessionId) {
        ExecutionState state = executions.get(sessionId);
        if (state == null) {
            return;
        }
        Disposable subscription = null;
        synchronized (state) {
            if (state.creatingTaskCount == 0) {
                subscription = state.subscription;
            }
        }
        if (subscription != null) {
            subscription.dispose();
        }
    }

    /**
     * 停止指定会话的 Agent Loop。
     *
     * @param sessionId String Agent 会话ID
     */
    public void dispose(String sessionId) {
        ExecutionState state = executions.get(sessionId);
        if (state == null) {
            return;
        }
        Disposable subscription;
        synchronized (state) {
            subscription = state.subscription;
        }
        if (subscription != null) {
            subscription.dispose();
        }
    }

    /**
     * 清理已结束会话的执行登记。
     *
     * @param sessionId String Agent 会话ID
     */
    public void complete(String sessionId) {
        executions.remove(sessionId);
    }

    /**
     * 已登记的生成任务及其取消态历史轮次。
     *
     * @param taskId String 生成任务ID
     * @param logType String 生成记录类型
     * @param title String 生成记录标题
     * @param canceledRound JSONObject 取消后写入的终态轮次
     */
    public record AgentTaskRegistration(String taskId, String logType, String title, JSONObject canceledRound) {
    }

    /**
     * 会话取消快照。
     *
     * @param active boolean 会话是否仍处于活跃状态
     * @param tasks List<AgentTaskRegistration> 已创建的生成任务
     */
    public record AgentCancellation(boolean active, List<AgentTaskRegistration> tasks) {

        /**
         * 构造未命中活跃会话的取消结果。
         *
         * @return AgentCancellation 未激活会话结果
         */
        public static AgentCancellation inactive() {
            return new AgentCancellation(false, List.of());
        }
    }

    /** Agent 会话的并发状态。 */
    private static final class ExecutionState {

        /** 会话所属用户ID */
        private final Long userId;

        /** 已创建但尚未结束的任务 */
        private final ConcurrentHashMap<String, AgentTaskRegistration> tasks = new ConcurrentHashMap<>();

        /** 正在创建但尚未完成登记的任务数量 */
        private int creatingTaskCount;

        /** 是否已请求取消 */
        private volatile boolean cancelRequested;

        /** Agent Loop 订阅控制器 */
        private Disposable subscription;

        /**
         * 创建会话执行状态。
         *
         * @param userId Long 会话所属用户ID
         */
        private ExecutionState(Long userId) {
            this.userId = userId;
        }
    }
}
