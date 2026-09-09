package com.novanovastudio.repository;

import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Mono;

/**
 * 邀请关系数据访问仓储。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-09 00:00
 */
@Repository
@RequiredArgsConstructor
public class InvitationRepository {

    /** 数据库客户端 */
    private final DatabaseClient databaseClient;

    /**
     * 根据邀请码查询邀请人用户ID。
     *
     * @param invitationCode 邀请码
     * @return 邀请人用户ID，不存在时为空
     */
    public Mono<Long> findInviterUserId(String invitationCode) {
        return databaseClient.sql("SELECT id FROM users WHERE invitation_code = :invitationCode")
                .bind("invitationCode", invitationCode)
                .map((row, metadata) -> row.get("id", Long.class))
                .one();
    }

    /**
     * 查询用户的邀请码。
     *
     * @param userId 用户ID
     * @return 用户邀请码，不存在时为空
     */
    public Mono<String> findInvitationCode(Long userId) {
        return databaseClient.sql("SELECT invitation_code FROM users WHERE id = :userId")
                .bind("userId", userId)
                .map((row, metadata) -> row.get("invitation_code", String.class))
                .one();
    }
}

