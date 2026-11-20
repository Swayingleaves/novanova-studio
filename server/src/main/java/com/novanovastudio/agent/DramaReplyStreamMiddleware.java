package com.novanovastudio.agent;

import com.novanovastudio.agent.dto.AgentEvent;
import io.agentscope.core.agent.Agent;
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.core.event.TextBlockDeltaEvent;
import io.agentscope.core.event.TextBlockEndEvent;
import io.agentscope.core.event.TextBlockStartEvent;
import io.agentscope.core.middleware.AgentInput;
import io.agentscope.core.middleware.MiddlewareBase;
import java.util.function.Function;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;

/**
 * 短剧回复流中间件。短剧Agent返回的是结构化JSON，这里从原始生成文本里增量截出reply字段，
 * 边生成边转发给前端；解析不出来时静默退化为不输出，最终正文仍由结构化结果落库。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-15 20:10
 */
@Component
@RequiredArgsConstructor
public class DramaReplyStreamMiddleware implements MiddlewareBase {

    /** 累计到这么多字符就发一次，避免每个token都打一次Redis。 */
    private static final int FLUSH_CHARACTERS = 8;

    /** 距上次发送超过这个间隔就发一次，让长间隔的单字也能及时出现。 */
    private static final long FLUSH_INTERVAL_NANOS = 60_000_000L;

    /** Agent事件发射器 */
    private final AgentEventEmitter eventEmitter;

    /**
     * 旁路观察短剧Agent事件流，把reply字段的增量转发成text-delta事件。
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
        DramaReplyStreamContext streamContext = runtimeContext.get(DramaReplyStreamContext.class);
        if (streamContext == null) {
            return next.apply(input);
        }
        ReplyExtractor extractor = new ReplyExtractor();
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
     * 按阈值把已解析出的新增正文发给前端。
     *
     * @param streamContext 本次调用的业务上下文
     * @param pending 待发送正文
     * @param lastEmitAt 上次发送时刻
     * @param force 是否忽略阈值立即发送
     */
    private void flush(DramaReplyStreamContext streamContext, StringBuilder pending, long[] lastEmitAt, boolean force) {
        if (pending.length() == 0) {
            return;
        }
        long now = System.nanoTime();
        if (!force && pending.length() < FLUSH_CHARACTERS && now - lastEmitAt[0] < FLUSH_INTERVAL_NANOS) {
            return;
        }
        String delta = pending.toString();
        pending.setLength(0);
        lastEmitAt[0] = now;
        eventEmitter.emit(streamContext.userId(), streamContext.teamId(),
                AgentEvent.textDelta(streamContext.sessionId(), streamContext.assistantId(), delta));
    }

    /**
     * 当前短剧调用的流式业务上下文。
     *
     * @param userId Long 当前已认证用户编号
     * @param teamId Long 当前团队空间编号
     * @param sessionId String 前端Agent会话编号
     * @param assistantId String 本轮助手消息编号，与落库消息编号一致
     */
    public record DramaReplyStreamContext(Long userId, Long teamId, String sessionId, String assistantId) {
    }

    /**
     * 从累积的原始生成文本里增量解析reply字段。
     */
    private static final class ReplyExtractor {

        /** reply字段在JSON里的键名 */
        private static final String KEY = "\"reply\"";

        /** 已收到的原始生成文本 */
        private final StringBuilder raw = new StringBuilder();

        /** 已经交给调用方的正文长度 */
        private int emitted;

        /**
         * 开始新的文本块。
         */
        void reset() {
            raw.setLength(0);
            emitted = 0;
        }

        /**
         * 记录一段增量原文。
         *
         * @param delta String 增量原文
         */
        void append(String delta) {
            if (StringUtils.hasText(delta)) {
                raw.append(delta);
            }
        }

        /**
         * 取出到目前为止可以确定的新增正文。
         *
         * @return String 新增正文，没有进展时返回空串
         */
        String drain() {
            String reply = decode();
            if (reply.length() <= emitted) {
                return "";
            }
            String next = reply.substring(emitted);
            emitted = reply.length();
            return next;
        }

        /**
         * 解析当前缓冲区里reply字段已经完整的部分。
         *
         * @return String 已能确定的正文
         */
        private String decode() {
            int keyIndex = raw.indexOf(KEY);
            if (keyIndex < 0) {
                return "";
            }
            int index = skipSpaces(keyIndex + KEY.length());
            if (index >= raw.length() || raw.charAt(index) != ':') {
                return "";
            }
            index = skipSpaces(index + 1);
            if (index >= raw.length() || raw.charAt(index) != '"') {
                return "";
            }
            StringBuilder text = new StringBuilder();
            for (int cursor = index + 1; cursor < raw.length(); cursor++) {
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
         * @param from int 起始位置
         * @return int 第一个非空白位置
         */
        private int skipSpaces(int from) {
            int index = from;
            while (index < raw.length() && Character.isWhitespace(raw.charAt(index))) {
                index += 1;
            }
            return index;
        }

        /**
         * 判断是否四位十六进制数字。
         *
         * @param value String 待判断文本
         * @return boolean 全部是十六进制数字时为true
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
