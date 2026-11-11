package com.novanovastudio.agent;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import org.junit.jupiter.api.Test;

/**
 * 对话时长和页面配置的比较。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-10 19:30
 */
class VideoDurationRequestTest {

    @Test
    void shouldReadAnExplicitDurationWithoutUsingShotTimecodes() {
        assertEquals(10, VideoDurationRequest.requestedSeconds("纯文字，时长是10s"));
        assertEquals(10, VideoDurationRequest.requestedSeconds("时长:约10秒"));
        assertEquals(10, VideoDurationRequest.requestedSeconds("生成10秒视频"));
        assertEquals(10, VideoDurationRequest.requestedSeconds("10秒"));
        assertNull(VideoDurationRequest.requestedSeconds("留悬念，不明确胜负"));
        assertNull(VideoDurationRequest.requestedSeconds("【镜头4 烟尘悬决（8-10s）】大远景，画面停在2.5s"));
        assertEquals(10, VideoDurationRequest.requestedSeconds("""
                确认生成

                【云海剑宗·广场对决｜第1段｜双剑绞天】
                模型:minmax-h3｜时长:约10秒｜画幅:16:9｜类型:TEXT_TO_VIDEO
                【镜头1 剑罡起（0-2.5s）】中景。
                【镜头4 烟尘悬决（8-10s）】大远景。
                """));
    }

    @Test
    void shouldReportOnlyWhenTheRequestedDurationDiffersFromThePageSetting() {
        VideoDurationRequest.Mismatch mismatch = VideoDurationRequest.mismatch("纯文字，时长是10s", "5");
        assertEquals(10, mismatch.requestedSeconds());
        assertEquals(5, mismatch.configuredSeconds());
        assertNull(VideoDurationRequest.mismatch("纯文字，时长是10s", "10"));
        assertNull(VideoDurationRequest.mismatch("留悬念，不明确胜负", "5"));
    }
}
