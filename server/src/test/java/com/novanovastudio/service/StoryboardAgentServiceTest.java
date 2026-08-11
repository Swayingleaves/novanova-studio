package com.novanovastudio.service;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.agent.AgentScopeAgentFactory;
import com.novanovastudio.agent.AgentScopeModelFactory;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.dto.StoryboardDtos;
import com.novanovastudio.security.CurrentUserProvider;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.List;
import java.util.function.Function;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * 分镜脚本Agent结构化结果与计费失败处理测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-08 00:00
 */
class StoryboardAgentServiceTest {

    /** 测试使用的整体视觉风格。 */
    private static final String VISUAL_STYLE = "国风手绘厚涂，电影级质感";

    /** 积分服务。 */
    private CreditService creditService;

    /** 待测试分镜服务。 */
    private StoryboardAgentService storyboardAgentService;

    /**
     * 初始化测试依赖。
     */
    @BeforeEach
    void setUp() {
        creditService = mock(CreditService.class);
        storyboardAgentService = new StoryboardAgentService(
                mock(CurrentUserProvider.class), mock(AgentScopeModelFactory.class), mock(AgentScopeAgentFactory.class), creditService);
    }

    /**
     * 合成结果应按输入镜头顺序回写，且保留稳定镜头标识。
     */
    @Test
    void shouldOrderChinesePromptMappingsByInputShotIdentifier() {
        List<StoryboardDtos.StoryboardShot> shots = List.of(shot("shot-1", 1), shot("shot-2", 2));
        StoryboardDtos.PromptCompositionResult result = new StoryboardDtos.PromptCompositionResult(List.of(
                new StoryboardDtos.StoryboardPrompt("shot-2", formattedPrompt("雨夜街道，角色快步穿过霓虹倒影")),
                new StoryboardDtos.StoryboardPrompt("shot-1", formattedPrompt("清晨公园，角色站在树下，柔和逆光"))));

        List<StoryboardDtos.StoryboardPrompt> prompts = invokePromptValidation(shots, result);

        Assertions.assertEquals(List.of("shot-1", "shot-2"), prompts.stream().map(StoryboardDtos.StoryboardPrompt::shotId).toList());
        Assertions.assertTrue(prompts.getFirst().finalPrompt().contains("清晨公园"));
    }

    /**
     * 最终提示词以英文为主时应被拒绝，避免中文工作流返回英文提示词。
     */
    @Test
    void shouldRejectPredominantlyLatinPrompt() {
        List<StoryboardDtos.StoryboardShot> shots = List.of(shot("shot-1", 1));
        StoryboardDtos.PromptCompositionResult result = new StoryboardDtos.PromptCompositionResult(List.of(
                new StoryboardDtos.StoryboardPrompt("shot-1", """
                        镜头规格：远景，5 秒。

                        画面内容：A warrior walks through a rain-soaked street under cinematic lighting.

                        场景：A dark street with neon signs and reflective puddles.

                        道具：A sword and a lantern.

                        光影氛围：Cold blue lighting with deep shadows.

                        运镜：Slow push-in toward the character.

                        声音：Rainfall and distant thunder.

                        视觉风格：%s
                        """.formatted(VISUAL_STYLE).trim())));

        BusinessException exception = Assertions.assertThrows(BusinessException.class, () -> invokePromptValidation(shots, result));

        Assertions.assertEquals("分镜Agent返回的最终提示词必须以中文为主", exception.getMessage());
    }

    /**
     * 用户指定视觉风格中的技术标识应原样保留，不能被中文校验误判。
     */
    @Test
    void shouldAllowTechnicalLatinCharactersInVisualStyle() {
        String visualStyle = "国风动漫3D";
        List<StoryboardDtos.StoryboardShot> shots = List.of(shot("shot-1", 1));
        StoryboardDtos.PromptCompositionResult result = new StoryboardDtos.PromptCompositionResult(List.of(
                new StoryboardDtos.StoryboardPrompt("shot-1", formattedPrompt("雨夜街道中的角色缓慢前行", visualStyle))));

        List<StoryboardDtos.StoryboardPrompt> prompts = invokePromptValidation(shots, visualStyle, result);

        Assertions.assertEquals("视觉风格：国风动漫3D", prompts.getFirst().finalPrompt().lines().reduce((first, second) -> second).orElseThrow());
    }

    /**
     * 最终提示词必须以固定八段格式回传，且保留用户输入的视觉风格。
     */
    @Test
    void shouldRejectPromptWithoutRequiredVisualStyleSection() {
        List<StoryboardDtos.StoryboardShot> shots = List.of(shot("shot-1", 1));
        StoryboardDtos.PromptCompositionResult result = new StoryboardDtos.PromptCompositionResult(List.of(
                new StoryboardDtos.StoryboardPrompt("shot-1", formattedPrompt("雨夜街道").replace(VISUAL_STYLE, "赛博霓虹风格"))));

        BusinessException exception = Assertions.assertThrows(BusinessException.class, () -> invokePromptValidation(shots, result));

        Assertions.assertEquals("分镜Agent返回的最终提示词未按固定格式生成", exception.getMessage());
    }

    /**
     * 合成结果缺失输入镜头或携带额外镜头标识时应拒绝回写。
     */
    @Test
    void shouldRejectMissingOrExtraPromptShotIdentifier() {
        List<StoryboardDtos.StoryboardShot> shots = List.of(shot("shot-1", 1), shot("shot-2", 2));
        StoryboardDtos.PromptCompositionResult result = new StoryboardDtos.PromptCompositionResult(List.of(
                new StoryboardDtos.StoryboardPrompt("shot-1", formattedPrompt("清晨公园，角色站在树下")),
                new StoryboardDtos.StoryboardPrompt("extra-shot", formattedPrompt("雨夜街道，角色奔跑"))));

        BusinessException exception = Assertions.assertThrows(BusinessException.class, () -> invokePromptValidation(shots, result));

        Assertions.assertEquals("分镜Agent返回了缺失、重复或额外的镜头标识", exception.getMessage());
    }

    /**
     * 分镜Agent返回非法景别或资产类别时应拒绝其结构化结果。
     */
    @Test
    void shouldRejectIllegalGeneratedShotSizeAndAssetKind() {
        StoryboardDtos.GeneratedStoryboardResult invalidShot = new StoryboardDtos.GeneratedStoryboardResult(List.of(
                new StoryboardDtos.GeneratedStoryboardShot(1, 5, "雨夜街道", "鸟瞰景", "霓虹光", "", "雨声", "推进", List.of())), List.of());
        StoryboardDtos.GeneratedStoryboardResult invalidAsset = new StoryboardDtos.GeneratedStoryboardResult(List.of(
                new StoryboardDtos.GeneratedStoryboardShot(1, 5, "雨夜街道", "远景", "霓虹光", "", "雨声", "推进", List.of())), List.of(
                new StoryboardDtos.GeneratedStoryboardAsset("vehicle", "car", "汽车", "黑色轿车")));

        BusinessException shotException = Assertions.assertThrows(BusinessException.class, () -> invokeGeneratedStoryboardValidation(invalidShot));
        BusinessException assetException = Assertions.assertThrows(BusinessException.class, () -> invokeGeneratedStoryboardValidation(invalidAsset));

        Assertions.assertEquals("分镜Agent返回的镜头景别不合法", shotException.getMessage());
        Assertions.assertEquals("分镜Agent返回了不支持的资产类别", assetException.getMessage());
    }

    /**
     * Agent返回的资产类别应去除首尾空白后再写入画布数据。
     */
    @Test
    void shouldTrimGeneratedStoryboardAssetKind() {
        StoryboardDtos.GeneratedStoryboardResult result = new StoryboardDtos.GeneratedStoryboardResult(List.of(
                new StoryboardDtos.GeneratedStoryboardShot(1, 5, "雨夜街道", "远景", "霓虹光", "", "雨声", "推进", List.of("detective"))), List.of(
                new StoryboardDtos.GeneratedStoryboardAsset(" character ", "detective", "侦探", "黑色风衣")));

        Object normalized = invokeGeneratedStoryboardValidation(result);

        Assertions.assertEquals("character", JSON.parseObject(JSON.toJSONString(normalized))
                .getJSONArray("assets").getJSONObject(0).getString("kind"));
    }

    /**
     * 当前资产标识重复时应在调用Agent前拒绝请求。
     */
    @Test
    void shouldRejectDuplicateStoryboardAssetIdentifiers() {
        StoryboardDtos.ComposePromptsRequest request = new StoryboardDtos.ComposePromptsRequest(
                "剧本文本", "生成追逐片段", VISUAL_STYLE, "channel::story-model", List.of(shot("shot-1", 1)), List.of(
                new StoryboardDtos.StoryboardAsset("asset-1", "character", "主角", "年轻侦探"),
                new StoryboardDtos.StoryboardAsset("asset-1", "prop", "手电筒", "金属手电筒")));

        BusinessException exception = Assertions.assertThrows(BusinessException.class, () -> invoke("validateComposeRequest", new Class<?>[]{StoryboardDtos.ComposePromptsRequest.class}, request));

        Assertions.assertEquals("资产标识不能重复", exception.getMessage());
    }

    /**
     * Agent初始分镜的资产引用键应映射为画布资产标识。
     */
    @Test
    void shouldMapGeneratedAssetReferenceKeysToCanvasAssetIdentifiers() {
        StoryboardDtos.GeneratedStoryboardResult result = new StoryboardDtos.GeneratedStoryboardResult(List.of(
                new StoryboardDtos.GeneratedStoryboardShot(1, 5, "雨夜街道", "远景", "霓虹光", "", "雨声", "推进", List.of("detective", "street"))), List.of(
                new StoryboardDtos.GeneratedStoryboardAsset("character", "detective", "侦探", "黑色风衣"),
                new StoryboardDtos.GeneratedStoryboardAsset("scene", "street", "雨夜街道", "潮湿的霓虹街道")));

        var normalized = JSON.parseObject(JSON.toJSONString(invokeGeneratedStoryboardValidation(result)));
        List<String> assetIds = normalized.getJSONArray("assets").stream()
                .map(item -> ((com.alibaba.fastjson2.JSONObject) item).getString("id"))
                .toList();
        List<String> shotAssetIds = normalized.getJSONArray("shots").getJSONObject(0).getList("assetIds", String.class);

        Assertions.assertEquals(assetIds, shotAssetIds);
    }

    /**
     * Agent引用未声明的资产时应拒绝整次生成结果。
     */
    @Test
    void shouldRejectUnknownGeneratedAssetReferenceKey() {
        StoryboardDtos.GeneratedStoryboardResult result = new StoryboardDtos.GeneratedStoryboardResult(List.of(
                new StoryboardDtos.GeneratedStoryboardShot(1, 5, "雨夜街道", "远景", "霓虹光", "", "雨声", "推进", List.of("unknown"))), List.of());

        BusinessException exception = Assertions.assertThrows(BusinessException.class, () -> invokeGeneratedStoryboardValidation(result));

        Assertions.assertEquals("分镜Agent返回了不存在的镜头资产引用", exception.getMessage());
    }

    /**
     * Agent返回重复资产引用键时应拒绝整次生成结果。
     */
    @Test
    void shouldRejectDuplicateGeneratedAssetReferenceKeys() {
        StoryboardDtos.GeneratedStoryboardResult result = new StoryboardDtos.GeneratedStoryboardResult(List.of(
                new StoryboardDtos.GeneratedStoryboardShot(1, 5, "雨夜街道", "远景", "霓虹光", "", "雨声", "推进", List.of("detective"))), List.of(
                new StoryboardDtos.GeneratedStoryboardAsset("character", "detective", "侦探", "黑色风衣"),
                new StoryboardDtos.GeneratedStoryboardAsset("character", "detective", "搭档", "深色夹克")));

        BusinessException exception = Assertions.assertThrows(BusinessException.class, () -> invokeGeneratedStoryboardValidation(result));

        Assertions.assertEquals("分镜Agent返回了重复的资产引用键", exception.getMessage());
    }

    /**
     * 合成Agent只应接收当前镜头关联的资产。
     */
    @Test
    void shouldPassOnlyAssociatedAssetsToComposeAgent() {
        StoryboardDtos.StoryboardShot shot = new StoryboardDtos.StoryboardShot(
                "shot-1", 1, 5, "雨夜街道中的角色", "远景", "霓虹反光", "", "雨声", "推进", "", List.of("asset-1"));
        StoryboardDtos.ComposePromptsRequest request = new StoryboardDtos.ComposePromptsRequest(
                "剧本文本", "生成追逐片段", VISUAL_STYLE, "channel::story-model", List.of(shot), List.of(
                new StoryboardDtos.StoryboardAsset("asset-1", "character", "主角", "年轻侦探"),
                new StoryboardDtos.StoryboardAsset("asset-2", "prop", "手电筒", "金属手电筒")));

        var shots = JSON.parseArray(JSON.toJSONString(invoke("buildComposeAgentShots", new Class<?>[]{StoryboardDtos.ComposePromptsRequest.class}, request)));
        var associatedAssets = shots.getJSONObject(0).getJSONArray("associatedAssets");

        Assertions.assertEquals(1, associatedAssets.size());
        Assertions.assertEquals("asset-1", associatedAssets.getJSONObject(0).getString("id"));
    }

    /**
     * 用户提交未知镜头资产关联时应在调用Agent前拒绝。
     */
    @Test
    void shouldRejectUnknownAssociatedAssetIdentifier() {
        StoryboardDtos.StoryboardShot shot = new StoryboardDtos.StoryboardShot(
                "shot-1", 1, 5, "雨夜街道中的角色", "远景", "霓虹反光", "", "雨声", "推进", "", List.of("missing-asset"));
        StoryboardDtos.ComposePromptsRequest request = new StoryboardDtos.ComposePromptsRequest(
                "剧本文本", "生成追逐片段", VISUAL_STYLE, "channel::story-model", List.of(shot), List.of());

        BusinessException exception = Assertions.assertThrows(BusinessException.class, () -> invoke("validateComposeRequest", new Class<?>[]{StoryboardDtos.ComposePromptsRequest.class}, request));

        Assertions.assertEquals("镜头关联了不存在的资产", exception.getMessage());
    }

    /**
     * 分镜生成请求缺少视觉风格时应在调用Agent前拒绝。
     */
    @Test
    void shouldRejectGenerateRequestWithoutVisualStyle() {
        StoryboardDtos.GenerateStoryboardRequest request = new StoryboardDtos.GenerateStoryboardRequest(
                "剧本文本", "生成追逐片段", "", "channel::story-model");

        BusinessException exception = Assertions.assertThrows(BusinessException.class,
                () -> invoke("validateGenerateRequest", new Class<?>[]{StoryboardDtos.GenerateStoryboardRequest.class}, request));

        Assertions.assertEquals("视觉风格不能为空", exception.getMessage());
    }

    /**
     * 分镜Agent调用失败后必须触发原操作标识的全额退款。
     */
    @Test
    void shouldRefundChargedStoryboardOperationAfterFailure() {
        when(creditService.chargeOperation(eq(8L), anyString(), eq(6), eq("测试分镜操作"))).thenReturn(Mono.empty());
        when(creditService.refundOperation(eq(8L), anyString(), eq("测试分镜操作"))).thenReturn(Mono.empty());
        @SuppressWarnings("unchecked")
        Mono<String> result = (Mono<String>) invoke(
                "executeChargedOperation",
                new Class<?>[]{Long.class, int.class, String.class, Function.class},
                8L,
                6,
                "测试分镜操作",
                (Function<String, Mono<String>>) ignored -> Mono.error(new IllegalStateException("Agent调用失败")));

        StepVerifier.create(result)
                .expectError(IllegalStateException.class)
                .verify();

        verify(creditService).refundOperation(eq(8L), anyString(), eq("测试分镜操作"));
    }

    /**
     * 构造有效镜头。
     *
     * @param id String 稳定镜头标识
     * @param shotNumber Integer 镜号
     * @return StoryboardShot 有效镜头
     */
    private StoryboardDtos.StoryboardShot shot(String id, int shotNumber) {
        return new StoryboardDtos.StoryboardShot(id, shotNumber, 5, "雨夜街道中的角色", "远景", "霓虹反光", "", "雨声", "推进", "", List.of());
    }

    /**
     * 构造满足固定段落格式的中文最终提示词。
     *
     * @param visualContent String 画面内容
     * @return String 固定格式的最终提示词
     */
    private String formattedPrompt(String visualContent) {
        return formattedPrompt(visualContent, VISUAL_STYLE);
    }

    /**
     * 构造满足固定段落格式的中文最终提示词。
     *
     * @param visualContent String 画面内容
     * @param visualStyle String 整体视觉风格
     * @return String 固定格式的最终提示词
     */
    private String formattedPrompt(String visualContent, String visualStyle) {
        return """
                镜头规格：远景，5 秒。

                画面内容：%s。

                场景：雨夜街道。

                道具：无。

                光影氛围：霓虹反光。

                运镜：推进。

                声音：雨声。

                视觉风格：%s
                """.formatted(visualContent, visualStyle).trim();
    }

    /**
     * 反射调用提示词结构化结果校验。
     *
     * @param shots List<StoryboardShot> 输入镜头
     * @param result PromptCompositionResult Agent返回结果
     * @return List<StoryboardPrompt> 校验后的提示词映射
     */
    private List<StoryboardDtos.StoryboardPrompt> invokePromptValidation(
            List<StoryboardDtos.StoryboardShot> shots, StoryboardDtos.PromptCompositionResult result) {
        return invokePromptValidation(shots, VISUAL_STYLE, result);
    }

    /**
     * 反射调用提示词结构化结果校验。
     *
     * @param shots List<StoryboardShot> 输入镜头
     * @param visualStyle String 用户指定的整体视觉风格
     * @param result PromptCompositionResult Agent返回结果
     * @return List<StoryboardPrompt> 校验后的提示词映射
     */
    @SuppressWarnings("unchecked")
    private List<StoryboardDtos.StoryboardPrompt> invokePromptValidation(
            List<StoryboardDtos.StoryboardShot> shots, String visualStyle, StoryboardDtos.PromptCompositionResult result) {
        return (List<StoryboardDtos.StoryboardPrompt>) invoke("validatePromptComposition",
                new Class<?>[]{List.class, String.class, StoryboardDtos.PromptCompositionResult.class}, shots, visualStyle, result);
    }

    /**
     * 反射调用首次生成结构化结果校验。
     *
     * @param result GeneratedStoryboardResult Agent返回结果
     * @return Object 已规范化分镜结果
     */
    private Object invokeGeneratedStoryboardValidation(StoryboardDtos.GeneratedStoryboardResult result) {
        return invoke("normalizeGeneratedStoryboard", new Class<?>[]{StoryboardDtos.GeneratedStoryboardResult.class}, result);
    }

    /**
     * 调用私有方法并保留业务异常语义。
     *
     * @param methodName String 方法名称
     * @param parameterTypes Class<?>[] 参数类型
     * @param arguments Object[] 调用参数
     * @return Object 方法返回值
     */
    private Object invoke(String methodName, Class<?>[] parameterTypes, Object... arguments) {
        try {
            Method method = StoryboardAgentService.class.getDeclaredMethod(methodName, parameterTypes);
            method.setAccessible(true);
            return method.invoke(storyboardAgentService, arguments);
        } catch (InvocationTargetException exception) {
            Throwable cause = exception.getCause();
            if (cause instanceof RuntimeException runtimeException) {
                throw runtimeException;
            }
            throw new AssertionError("调用分镜服务私有方法失败", cause);
        } catch (ReflectiveOperationException exception) {
            throw new AssertionError("读取分镜服务私有方法失败", exception);
        }
    }
}
