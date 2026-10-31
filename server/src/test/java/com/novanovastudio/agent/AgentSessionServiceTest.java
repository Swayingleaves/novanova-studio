package com.novanovastudio.agent;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import com.novanovastudio.agent.dto.AgentMessage;
import com.novanovastudio.agent.dto.AgentSession;
import com.novanovastudio.agent.dto.AgentSessionHistoryMessage;
import com.novanovastudio.common.BusinessException;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;

/**
 * 会话历史查询测试，验证正文恢复顺序和访问边界。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-20 12:00
 */
class AgentSessionServiceTest {

    /** 验证没有生成轮次时仍能取回完整问答，并且不会暴露内部消息和工具参数。 */
    @Test
    void shouldRestoreVisibleMessagesInStoredOrder() {
        AgentSessionRepository repository = mock(AgentSessionRepository.class);
        AgentSessionService service = new AgentSessionService(repository);
        OffsetDateTime now = OffsetDateTime.now();
        AgentSession session = new AgentSession("history", 377L, "图片对话", "imagePage", List.of(
                new AgentMessage("system", "system", "内部系统提示词", null),
                new AgentMessage("user", "user", "请生成图片", "内部元数据"),
                new AgentMessage("tool", "tool", "内部工具返回", null),
                new AgentMessage("assistant", "assistant", "请先补充图片要求", "内部元数据"),
                new AgentMessage("empty", "assistant", " ", null),
                new AgentMessage("follow-up", "user", "使用动漫风格", null)), now, now);
        when(repository.findById(377L, "history")).thenReturn(Mono.just(session));

        Assertions.assertEquals(List.of(
                new AgentSessionHistoryMessage("user", "user", "请生成图片"),
                new AgentSessionHistoryMessage("assistant", "assistant", "请先补充图片要求"),
                new AgentSessionHistoryMessage("follow-up", "user", "使用动漫风格")),
                service.getSessionHistory(377L, "history").block());
        verify(repository).findById(377L, "history");
        verifyNoMoreInteractions(repository);
    }

    /** 验证会话查不到时明确报错，不会创建新会话或返回其他用户的内容。 */
    @Test
    void shouldRejectMissingOrInaccessibleSession() {
        AgentSessionRepository repository = mock(AgentSessionRepository.class);
        AgentSessionService service = new AgentSessionService(repository);
        when(repository.findById(100L, "history")).thenReturn(Mono.empty());

        Assertions.assertThrows(BusinessException.class, () -> service.getSessionHistory(100L, "history").block());
        verify(repository).findById(100L, "history");
        verifyNoMoreInteractions(repository);
    }

    /** 验证空会话标识在访问数据库前即被拒绝。 */
    @Test
    void shouldRejectBlankSessionIdentifier() {
        AgentSessionRepository repository = mock(AgentSessionRepository.class);
        AgentSessionService service = new AgentSessionService(repository);

        Assertions.assertThrows(BusinessException.class, () -> service.getSessionHistory(377L, " ").block());
        verifyNoMoreInteractions(repository);
    }
}
