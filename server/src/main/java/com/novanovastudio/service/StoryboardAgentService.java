package com.novanovastudio.service;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.agent.AgentScopeAgentFactory;
import com.novanovastudio.agent.AgentScopeModelFactory;
import com.novanovastudio.ai.AiTaskSources;
import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.StoryboardDtos;
import com.novanovastudio.security.CurrentUserProvider;
import io.agentscope.core.ReActAgent;
import io.agentscope.core.agent.RuntimeContext;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;

/**
 * 分镜脚本Agent编排、结构化校验与独立积分计费服务。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-08 00:00
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class StoryboardAgentService {

    /** 标准景别集合。 */
    private static final Set<String> SHOT_SIZES = Set.of(
            "大特写", "特写", "近景", "头肩景", "中景", "中远景", "全景", "远景", "大远景", "大全景");

    /** 标准资产类别集合。 */
    private static final Set<String> ASSET_KINDS = Set.of("character", "scene", "prop");

    /** 最终提示词固定段落标题。 */
    private static final List<String> FINAL_PROMPT_SECTION_TITLES = List.of(
            "镜头规格：", "画面内容：", "场景：", "道具：", "光影氛围：", "运镜：", "声音：", "视觉风格：");

    /** 前七个固定段落之间的分隔符，允许空白字符但不影响最后的多行视觉风格。 */
    private static final Pattern PROMPT_SECTION_SEPARATOR = Pattern.compile("\\n[ \\t]*\\n");

    /** 资产图片提示词模板的类别段落标记，形如“# character”。 */
    private static final Pattern ASSET_PROMPT_SECTION = Pattern.compile("^#\\s*(\\S+)\\s*$");

    /** 资产图片提示词模板的占位符，形如“{{name}}”。 */
    private static final Pattern ASSET_PROMPT_PLACEHOLDER = Pattern.compile("\\{\\{\\s*(\\w+)\\s*\\}\\}");

    /** 当前用户提供器。 */
    private final CurrentUserProvider currentUserProvider;

    /** 文本模型解析工厂。 */
    private final AgentScopeModelFactory modelFactory;

    /** 分镜Agent工厂。 */
    private final AgentScopeAgentFactory agentFactory;

    /** 服务配置。 */
    private final NovanovaProperties properties;

    /** 积分服务。 */
    private final CreditService creditService;

    /** 系统提示词模板服务。 */
    private final SystemPromptTemplateService promptTemplateService;

    /** AI任务服务。 */
    private final AiTaskService aiTaskService;

    /**
     * 根据剧本文本和用户描述生成分镜与资产清单。
     *
     * @param request GenerateStoryboardRequest 生成请求
     * @return Mono<GenerateStoryboardResponse> 镜头、资产及实际扣费
     */
    public Mono<StoryboardDtos.GenerateStoryboardResponse> generateStoryboard(StoryboardDtos.GenerateStoryboardRequest request) {
        validateGenerateRequest(request);
        return currentUserProvider.currentUserId()
                .flatMap(userId -> modelFactory.resolveTextModel(request.model())
                        .flatMap(model -> generateWithModel(userId, model, request)));
    }

    /**
     * 根据用户确认后的镜头与资产合成全部中文最终提示词。
     *
     * @param request ComposePromptsRequest 合成请求
     * @return Mono<ComposePromptsResponse> 按稳定镜头标识返回的提示词与实际扣费
     */
    public Mono<StoryboardDtos.ComposePromptsResponse> composePrompts(StoryboardDtos.ComposePromptsRequest request) {
        validateComposeRequest(request);
        return currentUserProvider.currentUserId()
                .flatMap(userId -> modelFactory.resolveTextModel(request.model())
                        .flatMap(model -> composeWithModel(userId, model, request)));
    }

    /**
     * 为分镜资产创建图片生成任务，提示词由服务端按资产类别模板渲染。
     *
     * @param request CreateAssetImageTaskRequest 资产图片任务请求
     * @return Mono<AiGenerationTaskResponse> 已入队的AI任务
     */
    public Mono<AiTaskDtos.AiGenerationTaskResponse> createAssetImageTask(StoryboardDtos.CreateAssetImageTaskRequest request) {
        validateAssetImageRequest(request);
        Map<String, Object> parameters = new LinkedHashMap<>();
        parameters.put("count", 1);
        parameters.put("quality", request.settings().quality());
        parameters.put("resolution", request.settings().resolution());
        parameters.put("size", request.settings().size());
        parameters.put("storyboardNodeId", request.nodeId().trim());
        parameters.put("storyboardAssetId", request.asset().id().trim());
        AiTaskDtos.CreateAiTaskRequest taskRequest = new AiTaskDtos.CreateAiTaskRequest(
                AiTaskTypes.IMAGE, renderAssetImagePrompt(request), request.model().trim(), parameters, null, null, AiTaskSources.STORYBOARD);
        return aiTaskService.createTask(taskRequest);
    }

    /**
     * 使用已解析模型完成首次分镜生成。
     *
     * @param userId Long 当前用户ID
     * @param model TextModelSelection 已解析模型
     * @param request GenerateStoryboardRequest 生成请求
     * @return Mono<GenerateStoryboardResponse> 生成结果
     */
    private Mono<StoryboardDtos.GenerateStoryboardResponse> generateWithModel(
            Long userId, AgentScopeModelFactory.TextModelSelection model, StoryboardDtos.GenerateStoryboardRequest request) {
        return executeChargedOperation(userId, model.creditCost(), "分镜首次生成", operationId -> callGenerateAgent(userId, operationId, model, request)
                        .map(this::normalizeGeneratedStoryboard))
                .map(result -> new StoryboardDtos.GenerateStoryboardResponse(result.shots(), result.assets(), model.creditCost()));
    }

    /**
     * 使用已解析模型完成所有镜头提示词合成。
     *
     * @param userId Long 当前用户ID
     * @param model TextModelSelection 已解析模型
     * @param request ComposePromptsRequest 合成请求
     * @return Mono<ComposePromptsResponse> 合成结果
     */
    private Mono<StoryboardDtos.ComposePromptsResponse> composeWithModel(
            Long userId, AgentScopeModelFactory.TextModelSelection model, StoryboardDtos.ComposePromptsRequest request) {
        int credits = multiplyCredits(model.creditCost(), request.shots().size());
        return executeChargedOperation(userId, credits, "分镜提示词合成", operationId -> callComposeAgent(userId, operationId, model, request)
                        .map(result -> validatePromptComposition(request.shots(), request.visualStyle(), result)))
                .map(prompts -> new StoryboardDtos.ComposePromptsResponse(prompts, credits));
    }

    /**
     * 执行一次需要扣费的同步Agent操作；Agent超时、调用失败或结果校验失败时全额退款。
     *
     * @param userId Long 当前用户ID
     * @param credits int 本次应扣积分
     * @param operationName String 业务操作名称
     * @param operation Function<String, Mono<T>> 带稳定操作标识的实际调用
     * @return Mono<T> 业务结果
     * @param <T> 业务结果类型
     */
    private <T> Mono<T> executeChargedOperation(Long userId, int credits, String operationName,
                                                  Function<String, Mono<T>> operation) {
        String operationId = UUID.randomUUID().toString();
        AtomicBoolean charged = new AtomicBoolean(false);
        return creditService.chargeOperation(userId, operationId, credits, operationName)
                .then(Mono.defer(() -> {
                    charged.set(credits > 0);
                    log.info("开始执行分镜Agent操作: operationId={}, userId={}, operationName={}, credits={}", operationId, userId, operationName, credits);
                    return operation.apply(operationId);
                }))
                .doOnSuccess(ignored -> log.info("分镜Agent操作完成: operationId={}, userId={}, operationName={}", operationId, userId, operationName))
                .onErrorResume(exception -> {
                    if (!charged.get()) {
                        return Mono.error(exception);
                    }
                    log.error("分镜Agent操作失败，准备全额退款: operationId={}, userId={}, operationName={}", operationId, userId, operationName, exception);
                    return creditService.refundOperation(userId, operationId, operationName)
                            .doOnSuccess(ignored -> log.info("分镜Agent操作退款完成: operationId={}, userId={}, operationName={}", operationId, userId, operationName))
                            .then(Mono.error(exception));
                });
    }

    /**
     * 调用Agent生成首次分镜结构。
     *
     * @param userId Long 当前用户ID
     * @param operationId String 稳定操作标识
     * @param model TextModelSelection 已解析模型
     * @param request GenerateStoryboardRequest 生成请求
     * @return Mono<GeneratedStoryboardResult> Agent结构化结果
     */
    private Mono<StoryboardDtos.GeneratedStoryboardResult> callGenerateAgent(
            Long userId, String operationId, AgentScopeModelFactory.TextModelSelection model,
            StoryboardDtos.GenerateStoryboardRequest request) {
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("action", "generateStoryboard");
        input.put("scriptContent", request.scriptContent().trim());
        input.put("instruction", request.instruction().trim());
        input.put("visualStyle", request.visualStyle().trim());
        return callAgent(userId, operationId, model, input, StoryboardDtos.GeneratedStoryboardResult.class);
    }

    /**
     * 调用Agent合成全部镜头提示词。
     *
     * @param userId Long 当前用户ID
     * @param operationId String 稳定操作标识
     * @param model TextModelSelection 已解析模型
     * @param request ComposePromptsRequest 合成请求
     * @return Mono<PromptCompositionResult> Agent结构化结果
     */
    private Mono<StoryboardDtos.PromptCompositionResult> callComposeAgent(
            Long userId, String operationId, AgentScopeModelFactory.TextModelSelection model,
            StoryboardDtos.ComposePromptsRequest request) {
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("action", "composePrompts");
        input.put("scriptContent", request.scriptContent().trim());
        input.put("instruction", request.instruction().trim());
        input.put("visualStyle", request.visualStyle().trim());
        input.put("shots", buildComposeAgentShots(request));
        return callAgent(userId, operationId, model, input, StoryboardDtos.PromptCompositionResult.class);
    }

    /**
     * 构建按镜头裁剪资产后的Agent输入，避免无关资产影响最终提示词。
     *
     * @param request ComposePromptsRequest 已校验的提示词合成请求
     * @return List<Map<String, Object>> 每个镜头及其关联资产
     */
    private List<Map<String, Object>> buildComposeAgentShots(StoryboardDtos.ComposePromptsRequest request) {
        Map<String, StoryboardDtos.StoryboardAsset> assetsById = new LinkedHashMap<>();
        for (StoryboardDtos.StoryboardAsset asset : request.assets() == null ? List.<StoryboardDtos.StoryboardAsset>of() : request.assets()) {
            assetsById.put(asset.id(), asset);
        }
        return request.shots().stream().map(shot -> {
            Map<String, Object> input = new LinkedHashMap<>();
            input.put("id", shot.id());
            input.put("shotNumber", shot.shotNumber());
            input.put("durationSeconds", shot.durationSeconds());
            input.put("visualDescription", shot.visualDescription());
            input.put("shotSize", shot.shotSize());
            input.put("lightingAtmosphere", shot.lightingAtmosphere());
            input.put("dialogueVoiceover", shot.dialogueVoiceover());
            input.put("soundEffect", shot.soundEffect());
            input.put("cameraMovement", shot.cameraMovement());
            input.put("associatedAssets", shot.assetIds().stream().map(assetsById::get).toList());
            return input;
        }).toList();
    }

    /**
     * 使用固定分镜Agent执行结构化调用。
     *
     * @param userId Long 当前用户ID
     * @param operationId String 稳定操作标识
     * @param model TextModelSelection 已解析模型
     * @param input Map<String, Object> Agent输入
     * @param resultType Class<T> 期望结构化结果类型
     * @return Mono<T> 结构化结果
     * @param <T> 结构化结果类型
     */
    private <T> Mono<T> callAgent(Long userId, String operationId, AgentScopeModelFactory.TextModelSelection model,
                                  Map<String, Object> input, Class<T> resultType) {
        return Mono.defer(() -> {
                    ReActAgent agent = agentFactory.storyboardAgent(model.agentModel());
                    return agent.call(JSON.toJSONString(input), resultType, RuntimeContext.builder()
                                    .sessionId("storyboard:" + operationId)
                                    .userId(String.valueOf(userId))
                                    .build())
                            .timeout(Duration.ofSeconds(properties.getAi().getStoryboardAgent().getTimeoutSeconds()))
                            .map(message -> message.getStructuredData(resultType))
                            .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "分镜Agent未返回结构化结果")))
                            .doFinally(signal -> agent.close());
                })
                .onErrorMap(exception -> exception instanceof BusinessException
                        ? exception
                        : new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "分镜Agent调用失败: " + errorMessage(exception)));
    }

    /**
     * 校验并规范化首次生成的分镜结果，补齐稳定标识和待生成提示词。
     *
     * @param result GeneratedStoryboardResult Agent结构化结果
     * @return NormalizedStoryboard 已规范化镜头与资产
     */
    private NormalizedStoryboard normalizeGeneratedStoryboard(StoryboardDtos.GeneratedStoryboardResult result) {
        if (result == null || result.shots() == null || result.shots().isEmpty()) {
            throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "分镜Agent未生成有效镜头");
        }
        if (result.shots().size() > StoryboardDtos.MAX_SHOT_COUNT) {
            throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "分镜Agent返回的镜头数量超出限制");
        }
        if (result.assets() != null && result.assets().size() > 300) {
            throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "分镜Agent返回的资产数量超出限制");
        }
        List<StoryboardDtos.StoryboardAsset> assets = new ArrayList<>();
        Map<String, String> assetIdByReferenceKey = new LinkedHashMap<>();
        for (StoryboardDtos.GeneratedStoryboardAsset asset : result.assets() == null ? List.<StoryboardDtos.GeneratedStoryboardAsset>of() : result.assets()) {
            String kind = asset == null ? "" : normalizeRequiredText(asset.kind(), "分镜Agent返回的资产类别");
            if (asset == null || !ASSET_KINDS.contains(kind)) {
                throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "分镜Agent返回了不支持的资产类别");
            }
            String referenceKey = normalizeRequiredText(asset.referenceKey(), "分镜Agent返回的资产引用键");
            if (assetIdByReferenceKey.containsKey(referenceKey)) {
                throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "分镜Agent返回了重复的资产引用键");
            }
            String assetId = UUID.randomUUID().toString();
            assetIdByReferenceKey.put(referenceKey, assetId);
            assets.add(new StoryboardDtos.StoryboardAsset(
                    assetId, kind, normalizeRequiredText(asset.name(), "分镜Agent返回的资产名称"),
                    normalizeOptionalText(asset.description())));
        }
        Set<Integer> shotNumbers = new LinkedHashSet<>();
        List<StoryboardDtos.StoryboardShot> shots = new ArrayList<>();
        for (StoryboardDtos.GeneratedStoryboardShot shot : result.shots()) {
            if (shot == null) {
                throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "分镜Agent返回了空镜头");
            }
            validateShotFields(shot.shotNumber(), shot.durationSeconds(), shot.visualDescription(), shot.shotSize(), shotNumbers, "分镜Agent返回的镜头");
            if (shot.assetReferenceKeys() == null) {
                throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "分镜Agent返回的镜头资产引用不能为空");
            }
            Set<String> referencedAssetKeys = new LinkedHashSet<>();
            List<String> assetIds = new ArrayList<>();
            for (String referenceKeyValue : shot.assetReferenceKeys()) {
                String referenceKey = normalizeRequiredText(referenceKeyValue, "分镜Agent返回的镜头资产引用");
                if (!referencedAssetKeys.add(referenceKey)) {
                    throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "分镜Agent返回了重复的镜头资产引用");
                }
                String assetId = assetIdByReferenceKey.get(referenceKey);
                if (assetId == null) {
                    throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "分镜Agent返回了不存在的镜头资产引用");
                }
                assetIds.add(assetId);
            }
            shots.add(new StoryboardDtos.StoryboardShot(
                    UUID.randomUUID().toString(), shot.shotNumber(), shot.durationSeconds(), shot.visualDescription().trim(), shot.shotSize().trim(),
                    normalizeOptionalText(shot.lightingAtmosphere()), normalizeOptionalText(shot.dialogueVoiceover()),
                    normalizeOptionalText(shot.soundEffect()), normalizeOptionalText(shot.cameraMovement()), "", List.copyOf(assetIds)));
        }
        return new NormalizedStoryboard(List.copyOf(shots), List.copyOf(assets));
    }

    /**
     * 校验合成结果与输入镜头标识一一对应，并拒绝非中文为主的最终提示词。
     *
     * @param shots List<StoryboardShot> 输入镜头
     * @param visualStyle String 用户指定的整体视觉风格
     * @param result PromptCompositionResult Agent结构化结果
     * @return List<StoryboardPrompt> 按输入镜头顺序排列的提示词映射
     */
    private List<StoryboardDtos.StoryboardPrompt> validatePromptComposition(
            List<StoryboardDtos.StoryboardShot> shots, String visualStyle, StoryboardDtos.PromptCompositionResult result) {
        if (result == null || result.prompts() == null || result.prompts().size() != shots.size()) {
            throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "分镜Agent返回的提示词数量与镜头数量不一致");
        }
        String normalizedVisualStyle = normalizeLineBreaks(normalizeRequiredText(visualStyle, "视觉风格"));
        Set<String> expectedShotIds = shots.stream().map(StoryboardDtos.StoryboardShot::id).collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
        Map<String, String> promptByShotId = new LinkedHashMap<>();
        for (StoryboardDtos.StoryboardPrompt prompt : result.prompts()) {
            String shotId = prompt == null ? "" : normalizeRequiredText(prompt.shotId(), "分镜Agent返回的镜头标识");
            String finalPrompt = prompt == null ? "" : normalizeRequiredText(prompt.finalPrompt(), "分镜Agent返回的最终提示词");
            if (!expectedShotIds.contains(shotId) || promptByShotId.putIfAbsent(shotId, finalPrompt) != null) {
                throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "分镜Agent返回了缺失、重复或额外的镜头标识");
            }
            if (!isChinesePrompt(finalPrompt)) {
                throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "分镜Agent返回的最终提示词必须以中文为主");
            }
            StoryboardDtos.StoryboardShot shot = shots.stream().filter(item -> item.id().equals(shotId)).findFirst().orElseThrow();
            if (!isFixedPromptFormat(finalPrompt, shot, normalizedVisualStyle)) {
                throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "分镜Agent返回的最终提示词未按固定格式生成");
            }
        }
        if (!promptByShotId.keySet().equals(expectedShotIds)) {
            throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "分镜Agent返回的镜头标识不完整");
        }
        return shots.stream().map(shot -> new StoryboardDtos.StoryboardPrompt(shot.id(), promptByShotId.get(shot.id()))).toList();
    }

    /**
     * 校验最终提示词的固定段落结构和用户指定的视觉风格。
     *
     * @param finalPrompt String Agent返回的最终提示词
     * @param shot StoryboardShot 当前镜头
     * @param visualStyle String 用户指定的整体视觉风格
     * @return boolean 是否符合固定格式
     */
    private boolean isFixedPromptFormat(String finalPrompt, StoryboardDtos.StoryboardShot shot, String visualStyle) {
        String normalizedPrompt = finalPrompt.replace("\r\n", "\n").replace('\r', '\n').trim();
        String expectedSpecification = "镜头规格：" + shot.shotSize().trim() + "，" + shot.durationSeconds() + " 秒。";
        int sectionStart = 0;
        Matcher separatorMatcher = PROMPT_SECTION_SEPARATOR.matcher(normalizedPrompt);
        for (int index = 0; index < FINAL_PROMPT_SECTION_TITLES.size() - 1; index++) {
            separatorMatcher.region(sectionStart, normalizedPrompt.length());
            if (!separatorMatcher.find()) {
                return false;
            }
            String rawSection = normalizedPrompt.substring(sectionStart, separatorMatcher.start());
            if (!rawSection.equals(rawSection.trim())) {
                return false;
            }
            String section = rawSection.trim();
            if (index == 0 && !expectedSpecification.equals(section)) {
                return false;
            }
            String title = FINAL_PROMPT_SECTION_TITLES.get(index);
            if (index > 0 && (!section.startsWith(title) || !StringUtils.hasText(section.substring(title.length()).trim()))) {
                return false;
            }
            sectionStart = separatorMatcher.end();
        }
        String visualStyleSection = normalizedPrompt.substring(sectionStart).trim();
        return visualStyleSection.equals("视觉风格：" + visualStyle);
    }

    /**
     * 校验首次生成请求。
     *
     * @param request GenerateStoryboardRequest 生成请求
     * @return void 无返回值
     */
    private void validateGenerateRequest(StoryboardDtos.GenerateStoryboardRequest request) {
        if (request == null) {
            throw new BusinessException(ErrorCode.PARAM_MISSING, "分镜生成请求不能为空");
        }
        normalizeRequiredText(request.scriptContent(), "剧本文本");
        normalizeRequiredText(request.instruction(), "分镜描述");
        normalizeRequiredText(request.visualStyle(), "视觉风格");
        normalizeRequiredText(request.model(), "文本模型");
    }

    /**
     * 校验提示词合成请求及当前用户已编辑的镜头、资产。
     *
     * @param request ComposePromptsRequest 合成请求
     * @return void 无返回值
     */
    private void validateComposeRequest(StoryboardDtos.ComposePromptsRequest request) {
        if (request == null) {
            throw new BusinessException(ErrorCode.PARAM_MISSING, "提示词合成请求不能为空");
        }
        normalizeRequiredText(request.scriptContent(), "剧本文本");
        normalizeRequiredText(request.instruction(), "分镜描述");
        normalizeRequiredText(request.visualStyle(), "视觉风格");
        normalizeRequiredText(request.model(), "文本模型");
        if (request.shots() == null || request.shots().isEmpty()) {
            throw new BusinessException(ErrorCode.PARAM_MISSING, "至少需要一个镜头");
        }
        if (request.shots().size() > StoryboardDtos.MAX_SHOT_COUNT) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "镜头数量不能超过100");
        }
        Set<String> assetIds = new LinkedHashSet<>();
        for (StoryboardDtos.StoryboardAsset asset : request.assets() == null ? List.<StoryboardDtos.StoryboardAsset>of() : request.assets()) {
            if (asset == null || !ASSET_KINDS.contains(normalizeRequiredText(asset.kind(), "资产类别"))) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "资产类别仅支持character、scene、prop");
            }
            String assetId = normalizeRequiredText(asset.id(), "资产标识");
            if (!assetIds.add(assetId)) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "资产标识不能重复");
            }
            normalizeRequiredText(asset.name(), "资产名称");
        }
        Set<Integer> shotNumbers = new LinkedHashSet<>();
        Set<String> shotIds = new LinkedHashSet<>();
        for (StoryboardDtos.StoryboardShot shot : request.shots()) {
            if (shot == null) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "镜头不能为空");
            }
            String shotId = normalizeRequiredText(shot.id(), "镜头标识");
            if (!shotIds.add(shotId)) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "镜头标识不能重复");
            }
            validateShotFields(shot.shotNumber(), shot.durationSeconds(), shot.visualDescription(), shot.shotSize(), shotNumbers, "镜头");
            if (shot.assetIds() == null) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "镜头关联资产不能为空");
            }
            Set<String> associatedAssetIds = new LinkedHashSet<>();
            for (String assetIdValue : shot.assetIds()) {
                String assetId = normalizeRequiredText(assetIdValue, "镜头关联资产标识");
                if (!associatedAssetIds.add(assetId)) {
                    throw new BusinessException(ErrorCode.PARAM_INVALID, "镜头关联资产标识不能重复");
                }
                if (!assetIds.contains(assetId)) {
                    throw new BusinessException(ErrorCode.PARAM_INVALID, "镜头关联了不存在的资产");
                }
            }
        }
    }

    /**
     * 校验资产图片任务请求。
     *
     * @param request CreateAssetImageTaskRequest 资产图片任务请求
     * @return void 无返回值
     */
    private void validateAssetImageRequest(StoryboardDtos.CreateAssetImageTaskRequest request) {
        if (request == null) {
            throw new BusinessException(ErrorCode.PARAM_MISSING, "资产图片任务请求不能为空");
        }
        normalizeRequiredText(request.nodeId(), "分镜节点标识");
        normalizeRequiredText(request.visualStyle(), "视觉风格");
        normalizeRequiredText(request.model(), "图片模型");
        if (request.asset() == null || request.settings() == null) {
            throw new BusinessException(ErrorCode.PARAM_MISSING, "资产与图片生成参数不能为空");
        }
        if (!ASSET_KINDS.contains(normalizeRequiredText(request.asset().kind(), "资产类别"))) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "资产类别仅支持character、scene、prop");
        }
        normalizeRequiredText(request.asset().id(), "资产标识");
        normalizeRequiredText(request.asset().name(), "资产名称");
    }

    /**
     * 按资产类别渲染资产图片提示词。
     * <p>模板中整行占位符都取不到值时省略该行，避免留下“描述：”这类空标签行。</p>
     *
     * @param request CreateAssetImageTaskRequest 资产图片任务请求
     * @return String 渲染后的提示词
     */
    private String renderAssetImagePrompt(StoryboardDtos.CreateAssetImageTaskRequest request) {
        StoryboardDtos.StoryboardAsset asset = request.asset();
        Map<String, String> values = Map.of(
                "name", asset.name().trim(),
                "description", asset.description() == null ? "" : asset.description().trim(),
                "visualStyle", request.visualStyle().trim());
        List<String> rendered = new ArrayList<>();
        for (String line : readAssetImagePromptSection(asset.kind().trim()).split("\n", -1)) {
            Matcher matcher = ASSET_PROMPT_PLACEHOLDER.matcher(line);
            StringBuilder text = new StringBuilder();
            boolean hasPlaceholder = false;
            boolean hasValue = false;
            while (matcher.find()) {
                hasPlaceholder = true;
                String value = values.get(matcher.group(1));
                if (value == null) {
                    log.warn("分镜资产图片提示词模板存在未知占位符: placeholder={}", matcher.group(1));
                    value = "";
                } else if (!value.isEmpty()) {
                    hasValue = true;
                }
                matcher.appendReplacement(text, Matcher.quoteReplacement(value));
            }
            matcher.appendTail(text);
            if (hasPlaceholder && !hasValue) {
                continue;
            }
            rendered.add(text.toString());
        }
        if (rendered.isEmpty()) {
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, "分镜资产图片提示词模板段落内容为空: " + asset.kind());
        }
        return String.join("\n", rendered).trim();
    }

    /**
     * 从模板中截取指定资产类别的提示词段落。
     *
     * @param kind String 资产类别
     * @return String 该类别对应的提示词段落
     */
    private String readAssetImagePromptSection(String kind) {
        String currentKind = "";
        List<String> lines = new ArrayList<>();
        for (String line : promptTemplateService.get(PromptTemplateType.IMAGE_STORYBOARD_ASSET).split("\n", -1)) {
            Matcher matcher = ASSET_PROMPT_SECTION.matcher(line);
            if (matcher.matches()) {
                if (kind.equals(currentKind)) {
                    return String.join("\n", lines).trim();
                }
                currentKind = matcher.group(1);
                lines.clear();
                continue;
            }
            if (!currentKind.isEmpty()) {
                lines.add(line);
            }
        }
        if (kind.equals(currentKind)) {
            return String.join("\n", lines).trim();
        }
        throw new BusinessException(ErrorCode.BUSINESS_ERROR, "分镜资产图片提示词模板缺少类别段落: " + kind);
    }

    /**
     * 校验镜头关键字段与标准景别。
     *
     * @param shotNumber Integer 镜号
     * @param durationSeconds Integer 时长秒数
     * @param visualDescription String 画面描述
     * @param shotSize String 景别
     * @param shotNumbers Set<Integer> 已出现镜号
     * @param subject String 字段所属对象名称
     * @return void 无返回值
     */
    private void validateShotFields(Integer shotNumber, Integer durationSeconds, String visualDescription, String shotSize,
                                    Set<Integer> shotNumbers, String subject) {
        if (shotNumber == null || shotNumber < 1 || !shotNumbers.add(shotNumber)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, subject + "镜号必须为不重复的正整数");
        }
        if (durationSeconds == null || durationSeconds < 1 || durationSeconds > 600) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, subject + "时长必须为1至600秒的正整数");
        }
        normalizeRequiredText(visualDescription, subject + "画面描述");
        if (!SHOT_SIZES.contains(normalizeRequiredText(shotSize, subject + "景别"))) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, subject + "景别不合法");
        }
    }

    /**
     * 计算按镜头数量计费的总积分。
     *
     * @param unitCredits int 单镜头积分
     * @param shotCount int 镜头数量
     * @return int 总积分
     */
    private int multiplyCredits(int unitCredits, int shotCount) {
        try {
            return Math.multiplyExact(unitCredits, shotCount);
        } catch (ArithmeticException exception) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "分镜提示词合成积分计算超出范围");
        }
    }

    /**
     * 读取必填文本。
     *
     * @param value String 原始文本
     * @param fieldName String 字段名称
     * @return String 去除首尾空白后的文本
     */
    private String normalizeRequiredText(String value, String fieldName) {
        String normalized = value == null ? "" : value.trim();
        if (!StringUtils.hasText(normalized)) {
            throw new BusinessException(ErrorCode.PARAM_MISSING, fieldName + "不能为空");
        }
        return normalized;
    }

    /**
     * 统一文本换行符。
     *
     * @param value String 原始文本
     * @return String 使用换行符的文本
     */
    private String normalizeLineBreaks(String value) {
        return value.replace("\r\n", "\n").replace('\r', '\n');
    }

    /**
     * 读取可选文本。
     *
     * @param value String 原始文本
     * @return String 去除首尾空白后的文本，缺失时为空字符串
     */
    private String normalizeOptionalText(String value) {
        return value == null ? "" : value.trim();
    }

    /**
     * 判断提示词是否以中文为主。
     *
     * @param value String 提示词
     * @return boolean 汉字数量至少为其他文字字母数量两倍时为true
     */
    private boolean isChinesePrompt(String value) {
        long chineseCharacterCount = 0;
        long otherLetterCount = 0;
        for (int codePoint : value.codePoints().toArray()) {
            Character.UnicodeScript script = Character.UnicodeScript.of(codePoint);
            if (script == Character.UnicodeScript.HAN) {
                chineseCharacterCount++;
            } else if (Character.isLetter(codePoint)) {
                otherLetterCount++;
            }
        }
        return chineseCharacterCount > 0 && chineseCharacterCount >= otherLetterCount * 2;
    }

    /**
     * 读取对用户安全的调用失败摘要。
     *
     * @param exception Throwable 异常
     * @return String 错误摘要
     */
    private String errorMessage(Throwable exception) {
        String message = exception.getMessage();
        return StringUtils.hasText(message) ? message.trim() : "服务暂不可用";
    }

    /**
     * 已规范化的首次生成分镜。
     *
     * @param shots List<StoryboardShot> 镜头列表
     * @param assets List<StoryboardAsset> 资产列表
     */
    private record NormalizedStoryboard(List<StoryboardDtos.StoryboardShot> shots,
                                        List<StoryboardDtos.StoryboardAsset> assets) {
    }
}
