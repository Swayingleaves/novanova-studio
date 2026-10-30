package com.novanovastudio.service;

import com.novanovastudio.repository.ComicDramaRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

/**
 * 剧本上游变化到漫剧下游“需要更新”状态的单向联动服务。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-21 12:30
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ComicDramaImpactService {

    /** 漫剧生产仓储。 */
    private final ComicDramaRepository repository;

    /**
     * 标记共享剧本变化影响，尚未初始化漫剧项目时安全地不产生记录。
     * <p>该服务只依赖仓储，允许剧本服务单向注入，不会与漫剧业务服务形成循环依赖。</p>
     *
     * @param projectId 共享剧本项目ID
     * @param sourceType 上游来源类型
     * @param sourceIds 上游变化实体稳定标识
     * @param summary 面向用户的变化摘要
     * @return 新增影响记录数量
     */
    public Mono<Long> markUpstreamChanges(String projectId, String sourceType, List<String> sourceIds, String summary) {
        List<String> normalizedIds = sourceIds == null ? List.of() : sourceIds.stream()
                .filter(value -> value != null && !value.isBlank()).distinct().toList();
        return repository.markUpstreamChanges(projectId, sourceType, normalizedIds, summary)
                .flatMap(count -> repository.refreshProjectProductionStatus(projectId).thenReturn(count))
                .doOnNext(count -> {
                    if (count > 0) {
                        log.info("已标记漫剧下游需要更新: projectId={}, sourceType={}, sourceIds={}, impactCount={}",
                                projectId, sourceType, normalizedIds, count);
                    }
                });
    }
}
