package com.novanovastudio.agent;

import com.novanovastudio.agent.dto.AgentEvent;
import io.agentscope.core.agent.Agent;
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.core.event.TextBlockDeltaEvent;
import io.agentscope.core.event.TextBlockEndEvent;
import io.agentscope.core.event.TextBlockStartEvent;
import io.agentscope.core.middleware.AgentInput;
import io.agentscope.core.middleware.MiddlewareBase;
import java.util.List;
import java.util.function.Function;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;

/**
 * 创作对话回复流中间件。主Agent和视频工作流对话助手返回结构化JSON，
 * 这里从原始生成文本里增量抽取面向用户的文本字段（如summary、clarificationQuestion、message），
 * 边生成边转发为text-delta事件；解析不出时静默退化，不影响最终结构化结果。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-20 22:58
 */
@Component
@RequiredArgsConstructor
public class CreationReplyStreamMiddleware implements MiddlewareBase {

    /** 累计到该字符数就发一次，兼顾前端逐片动效细腻度与事件推送频次。 */
    private static final int FLUSH_CHARACTERS = 4;

    /** 距上次发送超过该时间间隔即刷新，避免慢速输出时长时间卡顿。 */
    private static final long FLUSH_INTERVAL_NANOS = 40_000_000L;

    /** Agent事件发射器 */
    private final AgentEventEmitter eventEmitter;

    /**
     * 旁路观察创作Agent事件流，将目标JSON字段增量转发为text-delta事件。
     *
     * @param agent Agent 当前Agent实例
     * @param runtimeContext RuntimeContext 当前调用上下文
     * @param input AgentInput 当前Agent输入
     * @param next Function 后续中间件或Agent核心逻辑
     * @return Flux&lt;io.agentscope.core.event.AgentEvent&gt; 原始AgentScope事件流
     */
    @Override
    public Flux<io.agentscope.core.event.AgentEvent> onAgent(
            Agent agent,
            RuntimeContext runtimeContext,
            AgentInput input,
            Function<AgentInput, Flux<io.agentscope.core.event.AgentEvent>> next) {
        CreationReplyStreamContext streamContext = runtimeContext.get(CreationReplyStreamContext.class);
        if (streamContext == null || streamContext.targetKeys() == null || streamContext.targetKeys().isEmpty()) {
            return next.apply(input);
        }
        JsonStringFieldExtractor extractor = new JsonStringFieldExtractor(streamContext.targetKeys());
        StringBuilder pending = new StringBuilder();
        long[] lastEmitAt = {0L};
        return next.apply(input).doOnNext(event -> {
            if (event instanceof TextBlockStartEvent) {
                extractor.reset();
                pending.setLength(0);
                return;
            }
            if (event instanceof TextBlockDeltaEvent deltaEvent) {
                extractor.append(deltaEvent.getDelta());
            } else if (!(event instanceof TextBlockEndEvent)) {
                return;
            }
            pending.append(extractor.drain());
            flush(streamContext, pending, lastEmitAt, event instanceof TextBlockEndEvent);
        }).doFinally(signal -> flush(streamContext, pending, lastEmitAt, true));
    }

    /**
     * 按字符或时间阈值将新增正文推送给前端。
     *
     * @param streamContext CreationReplyStreamContext 当前调用的流式业务上下文
     * @param pending StringBuilder 待推送正文缓冲
     * @param lastEmitAt long[] 上次推送时间戳数组
     * @param force boolean 是否忽略阈值立即推送
     */
    private void flush(CreationReplyStreamContext streamContext, StringBuilder pending, long[] lastEmitAt, boolean force) {
        if (pending.isEmpty()) {
            return;
        }
        long now = System.nanoTime();
        if (!force && pending.length() < FLUSH_CHARACTERS && now - lastEmitAt[0] < FLUSH_INTERVAL_NANOS) {
            return;
        }
        String delta = pending.toString();
        pending.setLength(0);
        lastEmitAt[0] = now;
        eventEmitter.emit(streamContext.userId(),
                AgentEvent.textDelta(streamContext.sessionId(), streamContext.assistantId(), delta));
    }

    /**
     * 创作对话流式转发业务上下文。
     *
     * @param userId Long 当前已认证用户编号
     * @param sessionId String 前端Agent会话编号
     * @param assistantId String 本轮助手消息编号
     * @param targetKeys List&lt;String&gt; 按优先级待抽取的JSON字符串字段名列表
     */
    public record CreationReplyStreamContext(
            Long userId,
            String sessionId,
            String assistantId,
            List<String> targetKeys
    ) {
    }

    /**
     * 从累积的原始JSON流中增量解码首个非空目标字符串字段。
     */
    static final class JsonStringFieldExtractor {

        /** 候选JSON字段键名列表（不含引号） */
        private final List<String> targetKeys;

        /** 已收到的原始生成文本 */
        private final StringBuilder raw = new StringBuilder();

        /** 已经锁定开始输出的字段名，锁定后不再切换，防止多字段串台 */
        private String lockedKey;

        /** 已经吐出给调用方的正文长度 */
        private int emitted;

        /**
         * 使用候选字段名列表构造抽取器。
         *
         * @param targetKeys List&lt;String&gt; 候选JSON字段名
         */
        JsonStringFieldExtractor(List<String> targetKeys) {
            this.targetKeys = targetKeys;
        }

        /**
         * 重置当前文本块解析状态。
         */
        void reset() {
            raw.setLength(0);
            lockedKey = null;
            emitted = 0;
        }

        /**
         * 追加一段增量原文。
         *
         * @param delta String 增量文本
         */
        void append(String delta) {
            if (StringUtils.hasText(delta) || (delta != null && !delta.isEmpty())) {
                raw.append(delta);
            }
        }

        /**
         * 取出当前已可安全确认的新增正文片段。
         *
         * @return String 新增正文，无进展时返回空串
         */
        String drain() {
            if (lockedKey == null) {
                lockedKey = findActiveKey();
            }
            if (lockedKey == null) {
                return "";
            }
            String decoded = decodeField(lockedKey);
            if (decoded.length() <= emitted) {
                return "";
            }
            String next = decoded.substring(emitted);
            emitted = decoded.length();
            return next;
        }

        /**
         * 在候选键中查找首个已出现且非空字符串值的字段。
         *
         * @return String 命中的字段名，尚未命中时返回null
         */
        private String findActiveKey() {
            int earliestIndex = Integer.MAX_VALUE;
            String candidate = null;
            for (String key : targetKeys) {
                int valueStart = findStringValueStart(key);
                if (valueStart < 0 || valueStart >= raw.length()) {
                    continue;
                }
                // 跳过已明确为空字符串的字段（例如 summary 为 "" 而 clarificationQuestion 非空）。
                if (raw.charAt(valueStart) == '"') {
                    continue;
                }
                if (valueStart < earliestIndex) {
                    earliestIndex = valueStart;
                    candidate = key;
                }
            }
            return candidate;
        }

        /**
         * 定位指定JSON字符串字段值开引号后的首个字符位置。
         *
         * @param key String 字段名
         * @return int 字符串内容起始下标；尚未出现或值不是字符串时返回-1
         */
        private int findStringValueStart(String key) {
            String quotedKey = "\"" + key + "\"";
            int keyIndex = raw.indexOf(quotedKey);
            if (keyIndex < 0) {
                return -1;
            }
            int index = skipSpaces(keyIndex + quotedKey.length());
            if (index >= raw.length() || raw.charAt(index) != ':') {
                return -1;
            }
            index = skipSpaces(index + 1);
            if (index >= raw.length() || raw.charAt(index) != '"') {
                return -1;
            }
            return index + 1;
        }

        /**
         * 解码指定字段目前已完整的字符串内容。
         *
         * @param key String 字段名
         * @return String 已解码正文
         */
        private String decodeField(String key) {
            int contentStart = findStringValueStart(key);
            if (contentStart < 0) {
                return "";
            }
            StringBuilder text = new StringBuilder();
            for (int cursor = contentStart; cursor < raw.length(); cursor++) {
                char current = raw.charAt(cursor);
                if (current == '"') {
                    break;
                }
                if (current != '\\') {
                    text.append(current);
                    continue;
                }
                if (cursor + 1 >= raw.length()) {
                    break;
                }
                char escaped = raw.charAt(cursor + 1);
                if (escaped == 'u') {
                    if (cursor + 5 >= raw.length()) {
                        return text.toString();
                    }
                    String hex = raw.substring(cursor + 2, cursor + 6);
                    if (!isHex(hex)) {
                        return text.toString();
                    }
                    text.append((char) Integer.parseInt(hex, 16));
                    cursor += 5;
                    continue;
                }
                switch (escaped) {
                    case 'n' -> text.append('\n');
                    case 't' -> text.append('\t');
                    case 'r' -> text.append('\r');
                    case 'b' -> text.append('\b');
                    case 'f' -> text.append('\f');
                    default -> text.append(escaped);
                }
                cursor += 1;
            }
            return text.toString();
        }

        /**
         * 跳过JSON里的空白字符。
         *
         * @param from int 起始下标
         * @return int 第一个非空白字符下标
         */
        private int skipSpaces(int from) {
            int index = from;
            while (index < raw.length() && Character.isWhitespace(raw.charAt(index))) {
                index += 1;
            }
            return index;
        }

        /**
         * 判断字符串是否全部由十六进制字符组成。
         *
         * @param value String 待检验文本
         * @return boolean 合法返回true
         */
        private boolean isHex(String value) {
            for (int index = 0; index < value.length(); index++) {
                if (Character.digit(value.charAt(index), 16) < 0) {
                    return false;
                }
            }
            return true;
        }
    }
}
