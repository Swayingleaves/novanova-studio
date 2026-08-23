package com.novanovastudio.service;

import com.novanovastudio.dto.ApiAccessLogDtos;
import com.novanovastudio.entity.ApiAccessLog;
import com.novanovastudio.repository.ApiAccessLogRepository;
import java.time.Instant;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

/**
 * @title        ApiAccessLogService.java
 * @description  接口访问日志服务
 * @createTime   2026-08-23
 */
@Service
@RequiredArgsConstructor
public class ApiAccessLogService {

    /** 接口访问日志仓储 */
    private final ApiAccessLogRepository apiAccessLogRepository;

    /**
     * 分页查询接口访问日志。
     *
     * @param page      int 页码
     * @param pageSize  int 每页数量
     * @param keyword   String 关键字
     * @param result    String 结果筛选
     * @return Mono<ApiAccessLogListResponse> 日志列表
     */
    public Mono<ApiAccessLogDtos.ApiAccessLogListResponse> listLogs(int page, int pageSize, String keyword, String result) {
        ApiAccessLogRepository.ApiLogQuery query = new ApiAccessLogRepository.ApiLogQuery(keyword, result);
        return apiAccessLogRepository.listLogs(query, page, pageSize)
                .collectList()
                .zipWith(apiAccessLogRepository.countLogs(query))
                .map(pair -> {
                    List<ApiAccessLogDtos.ApiAccessLogResponse> logs = pair.getT1().stream()
                            .map(ApiAccessLogDtos::toResponse)
                            .toList();
                    return new ApiAccessLogDtos.ApiAccessLogListResponse(logs, pair.getT2());
                });
    }

    /**
     * 写入一条接口访问日志。
     *
     * @param log ApiAccessLog 日志实体
     * @return Mono<Long> 主键
     */
    public Mono<Long> record(ApiAccessLog log) {
        return apiAccessLogRepository.insert(log);
    }

    /**
     * 删除早于指定时间的日志。
     *
     * @param cutoff Instant 时间阈值
     * @return Mono<Integer> 删除行数
     */
    public Mono<Long> deleteOld(Instant cutoff) {
        return apiAccessLogRepository.deleteOld(cutoff);
    }
}
