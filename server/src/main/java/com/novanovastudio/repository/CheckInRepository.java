package com.novanovastudio.repository;

import java.time.LocalDate;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * @title        CheckInRepository.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  用户每日签到数据访问仓储
 * @createTime   2026-09-17 10:30:00
 */
@Repository
public class CheckInRepository {

    /** 数据库客户端 */
    private final DatabaseClient databaseClient;

    /**
     * 构造签到数据访问仓储。
     *
     * @param databaseClient DatabaseClient 数据库客户端
     */
    public CheckInRepository(DatabaseClient databaseClient) {
        this.databaseClient = databaseClient;
    }

    /**
     * 查询用户指定日期区间内已签到的日期。
     *
     * @param userId Long 用户ID
     * @param startDate LocalDate 区间起始日期，包含
     * @param endDate LocalDate 区间结束日期，不包含
     * @return Flux<LocalDate> 已签到日期，按日期升序
     */
    public Flux<LocalDate> listCheckInDates(Long userId, LocalDate startDate, LocalDate endDate) {
        return databaseClient.sql("""
                SELECT check_in_date
                FROM user_check_ins
                WHERE user_id = :userId
                  AND check_in_date >= :startDate
                  AND check_in_date < :endDate
                ORDER BY check_in_date ASC
                """)
                .bind("userId", userId)
                .bind("startDate", startDate)
                .bind("endDate", endDate)
                .map((row, metadata) -> row.get("check_in_date", LocalDate.class))
                .all();
    }

    /**
     * 查询用户指定日期的签到记录。
     *
     * @param userId Long 用户ID
     * @param checkInDate LocalDate 签到日期
     * @return Mono<CheckInRecord> 该日期的签到记录，未签到时为空
     */
    public Mono<CheckInRecord> getCheckIn(Long userId, LocalDate checkInDate) {
        return databaseClient.sql("""
                SELECT check_in_date, credits
                FROM user_check_ins
                WHERE user_id = :userId
                  AND check_in_date = :checkInDate
                """)
                .bind("userId", userId)
                .bind("checkInDate", checkInDate)
                .map((row, metadata) -> new CheckInRecord(
                        row.get("check_in_date", LocalDate.class),
                        row.get("credits", Integer.class)))
                .one();
    }

    /**
     * 写入签到记录并抢占当日签到幂等键。
     *
     * @param userId Long 用户ID
     * @param checkInDate LocalDate 签到日期
     * @param credits int 本次签到发放的积分
     * @return Mono<Long> 新签到记录ID，当天已签到时为空
     */
    public Mono<Long> claimCheckIn(Long userId, LocalDate checkInDate, int credits) {
        return databaseClient.sql("""
                INSERT INTO user_check_ins(user_id, check_in_date, credits)
                VALUES (:userId, :checkInDate, :credits)
                ON CONFLICT (user_id, check_in_date) DO NOTHING
                RETURNING id
                """)
                .bind("userId", userId)
                .bind("checkInDate", checkInDate)
                .bind("credits", credits)
                .map((row, metadata) -> row.get("id", Long.class))
                .one();
    }

    /**
     * 用户签到记录。
     *
     * @param checkInDate LocalDate 签到日期
     * @param credits int 本次签到发放的积分
     */
    public record CheckInRecord(LocalDate checkInDate, int credits) {
    }
}
