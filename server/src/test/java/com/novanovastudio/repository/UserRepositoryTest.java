package com.novanovastudio.repository;

import com.novanovastudio.common.BusinessException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * 用户仓储时间筛选解析测试。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-26 21:00
 */
class UserRepositoryTest {

    /**
     * 前端日期选择器传入的带Z字符串应按同一时刻解析，不能抛解析异常。
     *
     * @return void 无返回值
     */
    @Test
    void shouldParseIsoInstantWithZuluOffset() {
        OffsetDateTime parsed = UserRepository.parseFilterTime("2026-09-30T16:00:00.000Z");

        Assertions.assertEquals(OffsetDateTime.of(2026, 9, 30, 16, 0, 0, 0, ZoneOffset.UTC).toInstant(), parsed.toInstant());
    }

    /**
     * 不带偏移的本地时间按统计时区解释。
     *
     * @return void 无返回值
     */
    @Test
    void shouldParseLocalDateTimeInStatisticsZone() {
        OffsetDateTime parsed = UserRepository.parseFilterTime("2026-10-01T00:00:00");

        Assertions.assertEquals("2026-10-01T00:00+08:00", parsed.toString());
    }

    /**
     * 纯日期按统计时区当天零点解析，便于手工调用接口。
     *
     * @return void 无返回值
     */
    @Test
    void shouldParsePlainDateAsStartOfDay() {
        OffsetDateTime parsed = UserRepository.parseFilterTime("2026-10-01");

        Assertions.assertEquals("2026-10-01T00:00+08:00", parsed.toString());
    }

    /**
     * 无法解析的值应转成参数错误，而不是冒泡成服务端异常。
     *
     * @return void 无返回值
     */
    @Test
    void shouldRejectUnparsableFilterTime() {
        Assertions.assertThrows(BusinessException.class, () -> UserRepository.parseFilterTime("昨天"));
    }
}
