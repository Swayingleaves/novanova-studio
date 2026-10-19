package com.novanovastudio;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.repository.TeamRepository;
import com.novanovastudio.service.StorageBillingService;
import com.novanovastudio.service.TeamTaskScopeService;
import java.util.function.Supplier;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 既有平台业务测试使用的明确平台空间依赖，新团队行为另行验证。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-18 10:00
 */
public final class TeamTestSupport {
    /** 禁止实例化。 */
    private TeamTestSupport() { }

    /** @return 不改变既有平台业务执行顺序的作用域模拟 */
    @SuppressWarnings("unchecked")
    public static TeamTaskScopeService taskScope() {
        TeamTaskScopeService service = mock(TeamTaskScopeService.class, org.mockito.Mockito.withSettings().strictness(org.mockito.quality.Strictness.LENIENT));
        when(service.execute(anyString(), anyString(), any())).thenAnswer(invocation -> ((Supplier<Mono<Void>>) invocation.getArgument(2)).get());
        when(service.usingModel(anyString(), any())).thenAnswer(invocation -> invocation.getArgument(1));
        when(service.guardEvents(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(service.requireCurrentActive()).thenReturn(Mono.empty());
        when(service.requireActive(anyLong())).thenReturn(Mono.empty());
        return service;
    }

    /** @return 固定平台资源归属的仓储模拟 */
    public static TeamRepository teamRepository() {
        TeamRepository repository = mock(TeamRepository.class, org.mockito.Mockito.withSettings().strictness(org.mockito.quality.Strictness.LENIENT));
        when(repository.listPreferences(anyLong())).thenReturn(Flux.empty());
        when(repository.findResource(anyString(), anyString())).thenAnswer(invocation -> {
            JSONObject resource = new JSONObject(); resource.put("teamId", 0L); return Mono.just(resource);
        });
        return repository;
    }

    /** @return 尚未启用存储计费的明确平台依赖 */
    public static StorageBillingService storageBilling() {
        StorageBillingService service = mock(StorageBillingService.class, org.mockito.Mockito.withSettings().strictness(org.mockito.quality.Strictness.LENIENT));
        when(service.requireWritable(anyLong())).thenReturn(Mono.empty());
        when(service.registerObject(any(), anyString(), anyLong())).thenReturn(Mono.empty());
        when(service.requestMediaDeletion(anyLong(), any())).thenReturn(Mono.empty());
        return service;
    }
}
