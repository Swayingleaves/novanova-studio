package com.novanovastudio.service;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

import com.novanovastudio.agent.AgentTaskOrchestrator;
import com.novanovastudio.ai.AiProviderAdapterRegistry;
import com.novanovastudio.ai.provider.CustomProviderAdapter;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.repository.AiTaskRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.task.AiTaskEventPublisher;
import com.novanovastudio.task.AiTaskQueue;
import com.novanovastudio.task.ModelTaskExecutionDispatcher;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.reactive.TransactionalOperator;

/**
 * AI模型目录访问权限测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-24 23:09
 */
class AiTaskModelAccessTest {

    /**
     * 未登录用户查询模型目录时应被拒绝，并且不得读取平台模型配置。
     *
     * @return void 无返回值
     */
    @Test
    void shouldRejectModelCatalogRequestWithoutAuthenticatedUser() {
        PersistenceService persistenceService = mock(PersistenceService.class);
        AiTaskService service = new AiTaskService(
                mock(AiTaskRepository.class),
                new CurrentUserProvider(),
                mock(NovanovaProperties.class),
                persistenceService,
                mock(AiTaskEventPublisher.class),
                mock(AiTaskQueue.class),
                mock(ModelTaskExecutionDispatcher.class),
                mock(AgentTaskOrchestrator.class),
                mock(AiProviderAdapterRegistry.class),
                mock(CustomProviderAdapter.class),
                mock(CreditService.class),
                mock(TransactionalOperator.class));

        BusinessException exception = Assertions.assertThrows(BusinessException.class,
                () -> service.listModels().block());

        Assertions.assertEquals(ErrorCode.TOKEN_INVALID, exception.getCode());
        verifyNoInteractions(persistenceService);
    }
}
