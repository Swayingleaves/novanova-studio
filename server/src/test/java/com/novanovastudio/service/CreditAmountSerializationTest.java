package com.novanovastudio.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONFactory;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.ApiResponse;
import com.novanovastudio.common.CreditAmounts;
import com.novanovastudio.config.ApplicationConfiguration;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.CheckInDtos;
import com.novanovastudio.dto.ComicDramaDtos;
import com.novanovastudio.dto.CreditCardDtos;
import com.novanovastudio.dto.CreditDtos;
import com.novanovastudio.dto.EpisodeBodiesDtos;
import com.novanovastudio.dto.InvitationDtos;
import com.novanovastudio.dto.NovelAdaptationDtos;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.dto.ScriptDtos;
import com.novanovastudio.dto.StoryBibleDtos;
import com.novanovastudio.dto.StoryboardDtos;
import com.novanovastudio.dto.UserDtos;
import com.novanovastudio.dto.VideoBillingConfiguration;
import com.novanovastudio.dto.WholeBookAdaptationDtos;
import jakarta.validation.Validation;
import java.math.BigDecimal;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.codec.ServerCodecConfigurer;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import static org.junit.jupiter.api.Assertions.*;

/**
 * 验证真实WebFlux金额序列化及六位小数边界。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-18 12:00
 */
class CreditAmountSerializationTest {
    /** 真实项目列表响应保留高精度坐标的数值类型，不套用积分范围。 */
    @Test
    void shouldPreserveCanvasNumbersThroughHttp() {
        JSONObject project = JSON.parseObject("""
                {"scene":{"nodes":[{"frame":{"position":{"x":1137.897707015529,"y":515.5159602765772}}}]},
                 "metadata":{"largeNumber":123456789012345678901.123456789,"credits":0.123456789}}
                """);
        JSONObject returned = responseJson(new PersistenceDtos.ProjectListResponse(List.of(project)))
                .getJSONObject("data").getJSONArray("projects").getJSONObject(0);
        assertEquals(project, returned);
        JSONObject position = returned.getJSONObject("scene").getJSONArray("nodes").getJSONObject(0)
                .getJSONObject("frame").getJSONObject("position");
        assertInstanceOf(Number.class, position.get("x"));
        assertInstanceOf(Number.class, position.get("y"));
        assertEquals(new BigDecimal("1137.897707015529"), position.getBigDecimal("x"));
        assertEquals(new BigDecimal("515.5159602765772"), position.getBigDecimal("y"));
    }

    /**
     * 使用生产WebFlux编解码配置获取真实HTTP响应正文。
     * @param data 待编码的业务响应
     * @return 解析后的统一响应
     */
    private JSONObject responseJson(Object data) {
        byte[] body = WebTestClient.bindToController(new SerializationController(data))
                .httpMessageCodecs(new ApplicationConfiguration().fastjson2CodecCustomizer()::customize)
                .build().get().uri("/serializeResponse").exchange()
                .expectStatus().isOk().expectBody().returnResult().getResponseBody();
        assertNotNull(body);
        return JSON.parseObject(body);
    }

    /** 钱包金额精确输出字符串，包含最大金额、最小金额、整数、负数和尾随零。 */
    @Test
    void shouldSerializeDecimalStringsWithoutPrecisionLoss() {
        List<String> amounts = List.of("999999999999999999.123456", "0.000001", "2.500000", "-0.123456", "0", "1E+6");
        var balances = amounts.stream().map(amount -> new CreditDtos.CreditBalanceResponse(1L, new BigDecimal(amount))).toList();
        var returned = responseJson(balances).getJSONArray("data");
        for (int index = 0; index < amounts.size(); index++) {
            assertEquals(CreditAmounts.text(new BigDecimal(amounts.get(index))), returned.getJSONObject(index).get("creditBalance"));
        }
        JSONObject emptyBalance = responseJson(new CreditDtos.CreditBalanceResponse(1L, null)).getJSONObject("data");
        assertTrue(emptyBalance.containsKey("creditBalance"));
        assertNull(emptyBalance.get("creditBalance"));
    }

    /** 所有积分接口结构均接受精确字符串并按字符串返回，覆盖报价、奖励、流水与创作任务。 */
    @Test
    void shouldKeepAmountStringsAcrossAllCreditContracts() {
        String amount = "999999999999999999.123456";
        var ordinaryTypes = List.of(ComicDramaDtos.Shot.class, ComicDramaDtos.VoiceTrack.class, ComicDramaDtos.TimelineText.class);
        var groups = List.of(AiTaskDtos.class, CheckInDtos.class, ComicDramaDtos.class, CreditCardDtos.class,
                CreditDtos.class, EpisodeBodiesDtos.class, InvitationDtos.class, NovelAdaptationDtos.class,
                PersistenceDtos.class, ScriptDtos.class, StoryBibleDtos.class, StoryboardDtos.class,
                UserDtos.class, WholeBookAdaptationDtos.class);
        for (Class<?> group : groups) {
            for (Class<?> responseType : group.getDeclaredClasses()) {
                if (!responseType.isRecord() || ordinaryTypes.contains(responseType)) continue;
                var fields = Arrays.stream(responseType.getRecordComponents())
                        .filter(component -> component.getType() == BigDecimal.class).toList();
                if (fields.isEmpty()) continue;
                JSONObject input = new JSONObject();
                fields.forEach(field -> input.put(field.getName(), amount));
                Object response = JSON.parseObject(input.toJSONString(), responseType);
                JSONObject returned = JSON.parseObject(JSON.toJSONString(response));
                fields.forEach(field -> assertEquals(amount, returned.get(field.getName()), responseType.getSimpleName() + "." + field.getName()));
            }
        }
    }

    /** 编解码配置不修改全局小数序列化器，后台快照及模型请求中的普通小数保持原样。 */
    @Test
    void shouldLeaveGlobalDecimalWriterUnchanged() {
        var provider = JSONFactory.getDefaultObjectWriterProvider();
        var previous = provider.getObjectWriter(BigDecimal.class);
        new ApplicationConfiguration().fastjson2CodecCustomizer().customize(ServerCodecConfigurer.create());
        assertSame(previous, provider.getObjectWriter(BigDecimal.class));
        BigDecimal coordinate = new BigDecimal("1137.897707015529");
        assertEquals(coordinate, JSON.parseObject(JSON.toJSONString(Map.of("x", coordinate))).get("x"));
    }

    /** Redis及SSE使用的积分事件不依赖HTTP初始化，同样输出精确金额字符串。 */
    @Test
    void shouldSerializeCreditEventsWithoutGlobalRegistration() {
        var event = new AiTaskDtos.AiTaskEvent("creditBalance", null, null, new BigDecimal("0.123456"));
        assertEquals("0.123456", JSON.parseObject(JSON.toJSONString(event)).get("creditBalance"));
    }

    /** 模型价格表的金额为字符串，时长和自定义模型参数仍为数值。 */
    @Test
    void shouldSerializeModelPricesWithoutChangingParameters() {
        var pricing = new VideoBillingConfiguration("second", 5, Map.of("textToVideo", Map.of(
                "720p", new BigDecimal("1E-6"), "1080p", new BigDecimal("999999999999999999.123456"))));
        JSONObject parameters = JSON.parseObject("{\"temperature\":0.123456789}");
        var model = new PersistenceDtos.ModelConfig("model", "channel", "模型", "video", List.of(), false, 1,
                new BigDecimal("2.500000"), false, null, "second", 1, parameters, pricing, null, null, false, null);
        JSONObject returned = responseJson(model).getJSONObject("data");
        assertEquals("2.5", returned.get("creditCost"));
        assertEquals(parameters, returned.getJSONObject("customBodyParameters"));
        JSONObject videoPricing = returned.getJSONObject("videoBillingConfiguration");
        assertEquals(5, videoPricing.get("minimumDurationSeconds"));
        JSONObject prices = videoPricing.getJSONObject("modePrices").getJSONObject("textToVideo");
        assertEquals("0.000001", prices.get("720p"));
        assertEquals("999999999999999999.123456", prices.get("1080p"));
    }

    /** 漫剧时长、语速和字幕位置不受积分精度校验或字符串序列化影响。 */
    @Test
    void shouldPreserveOrdinaryTypedDecimals() {
        var shot = JSON.parseObject("{\"durationSeconds\":2.123456789}", ComicDramaDtos.Shot.class);
        var voice = JSON.parseObject("{\"speechRate\":1.123456789}", ComicDramaDtos.VoiceTrack.class);
        var subtitle = JSON.parseObject("{\"positionX\":0.123456789,\"positionY\":0.987654321}", ComicDramaDtos.TimelineText.class);
        JSONObject returned = responseJson(Map.of("shot", shot, "voice", voice, "subtitle", subtitle)).getJSONObject("data");
        assertEquals(shot.durationSeconds(), returned.getJSONObject("shot").get("durationSeconds"));
        assertEquals(voice.speechRate(), returned.getJSONObject("voice").get("speechRate"));
        assertEquals(subtitle.positionX(), returned.getJSONObject("subtitle").get("positionX"));
        assertEquals(subtitle.positionY(), returned.getJSONObject("subtitle").get("positionY"));
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            var validator = factory.getValidator();
            assertTrue(validator.validateProperty(shot, "durationSeconds").isEmpty());
            assertTrue(validator.validateProperty(voice, "speechRate").isEmpty());
            assertTrue(validator.validateProperty(subtitle, "positionX").isEmpty());
            assertTrue(validator.validateProperty(subtitle, "positionY").isEmpty());
        }
    }

    /** 零点一加零点二精确，超出六位或十八位整数明确拒绝。 */
    @Test
    void shouldValidateScaleAndRange() {
        assertEquals("0.3", CreditAmounts.text(CreditAmounts.of("0.1").add(CreditAmounts.of("0.2"))));
        assertThrows(com.novanovastudio.common.BusinessException.class, () -> CreditAmounts.of("0.0000001"));
        assertThrows(com.novanovastudio.common.BusinessException.class, () -> CreditAmounts.of("1000000000000000000"));
    }

    /** 只提供内存中的响应数据，测试不启动服务或连接数据库。 */
    @RestController
    static class SerializationController {
        /** 当前测试的业务响应。 */
        private final Object data;

        /**
         * 创建序列化测试控制器。
         * @param data 业务响应
         */
        SerializationController(Object data) { this.data = data; }

        /**
         * 返回与业务接口一致的响应包装。
         * @return 待编码的统一响应
         */
        @GetMapping("/serializeResponse")
        public ApiResponse<Object> serializeResponse() { return ApiResponse.ok(data); }
    }
}
