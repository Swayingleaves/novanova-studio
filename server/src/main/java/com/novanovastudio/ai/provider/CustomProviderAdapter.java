package com.novanovastudio.ai.provider;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.ai.AiHttpClient;
import com.novanovastudio.ai.AiJsonUtils;
import com.novanovastudio.ai.AiMediaSupport;
import com.novanovastudio.ai.AiProviderAdapter;
import com.novanovastudio.ai.AiTaskExecutionContext;
import com.novanovastudio.ai.AiTaskParameterReader;
import com.novanovastudio.ai.AiTaskPollingSupport;
import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.ai.VideoGenerationMode;
import com.novanovastudio.agent.AgentScopeModelFactory;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.PersistenceDtos;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.MsgRole;
import io.agentscope.core.message.TextBlock;
import io.agentscope.core.model.ChatResponse;
import io.agentscope.core.model.GenerateOptions;
import io.agentscope.core.model.Model;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.util.retry.Retry;

/**
 * @title        CustomProviderAdapter.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  自定义模型渠道适配器
 * @createTime   2026-08-24 00:00
 * <p>
 * 按模型配置的请求示例模板组装请求体（{{prompt}}等占位符替换），POST到渠道baseUrl发起调用，
 * 再按响应示例中配置的结果路径（如data.image.url）提取媒体地址；视频模型支持提交后轮询查询接口，
 * 全部提取失败时交给默认文本模型（LLM）从响应原文中提取媒体地址。
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class CustomProviderAdapter implements AiProviderAdapter {

    /** 查询轮询最大次数，配合默认轮询间隔约10分钟总超时 */
    private static final int MAX_POLLING_ATTEMPTS = 120;

    /** LLM提取媒体地址超时秒数 */
    private static final long LLM_EXTRACTION_TIMEOUT_SECONDS = 60;

    /** AI构造请求体返回空内容或非法JSON时的最大重试次数 */
    private static final int BODY_BUILD_MAX_RETRIES = 2;

    /** 请求体模板占位符匹配，如{{prompt}} */
    private static final Pattern PLACEHOLDER_PATTERN = Pattern.compile("\\{\\{(\\w+)}}");

    /** 常见媒体URL匹配 */
    private static final Pattern MEDIA_URL_PATTERN = Pattern.compile("https?://[^\\s\"'<>]+");

    /** AI HTTP客户端 */
    private final AiHttpClient aiHttpClient;

    /** AI媒体支持 */
    private final AiMediaSupport mediaSupport;

    /** 服务配置，读取统一轮询间隔 */
    private final NovanovaProperties properties;

    /**
     * AgentScope模型工厂。
     * <p>
     * 懒加载以避免与适配器注册表（构造依赖本适配器）形成初始化循环依赖。
     */
    @Autowired
    @Lazy
    private AgentScopeModelFactory agentScopeModelFactory;

    /**
     * 获取渠道调用格式
     *
     * @return String 渠道调用格式
     */
    @Override
    public String apiFormat() {
        return "custom";
    }

    /**
     * 判断当前适配器是否支持任务类型，仅支持图片与视频。
     *
     * @param taskType String 任务类型
     * @return boolean 是否支持
     */
    @Override
    public boolean supports(String taskType) {
        return List.of(AiTaskTypes.IMAGE, AiTaskTypes.VIDEO).contains(taskType);
    }

    /**
     * 执行自定义模型任务
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @return Mono<JSONObject> 任务结果JSON
     */
    @Override
    public Mono<JSONObject> execute(AiTaskExecutionContext context) {
        return switch (context.task().getTaskType()) {
            case AiTaskTypes.IMAGE -> executeImageTask(context);
            case AiTaskTypes.VIDEO -> executeVideoTask(context);
            default -> Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR,
                    "自定义模型调用格式暂不支持" + context.task().getTaskType() + "任务"));
        };
    }

    /**
     * 执行自定义模型图片任务，按是否有参考图判定文生图或图生图模式。
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @return Mono<JSONObject> 图片结果
     */
    private Mono<JSONObject> executeImageTask(AiTaskExecutionContext context) {
        String mode = AiTaskParameterReader.safeReferences(context.request().references()).isEmpty()
                ? "text-to-image" : "image-to-image";
        PersistenceDtos.CustomModelGroupConfig group = requireGroup(context, mode);
        return resolveReferenceUrls(context, context.request().references())
                .flatMap(referenceUrls -> submitAndResolveUrl(context, group, mode, AiTaskTypes.IMAGE, referenceUrls, List.of()))
                .flatMap(url -> registerMedia(context, AiTaskTypes.IMAGE, url));
    }

    /**
     * 执行自定义模型视频任务，按请求的视频生成模式或参考图判定文生视频、图生视频或全能参考模式。
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @return Mono<JSONObject> 视频结果
     */
    private Mono<JSONObject> executeVideoTask(AiTaskExecutionContext context) {
        String mode = resolveVideoMode(context);
        PersistenceDtos.CustomModelGroupConfig group = requireGroup(context, mode);
        return Mono.zip(
                        resolveReferenceUrls(context, context.request().references()),
                        resolveReferenceUrls(context, context.request().videoReferences()))
                .flatMap(tuple -> submitAndResolveUrl(context, group, mode, AiTaskTypes.VIDEO, tuple.getT1(), tuple.getT2()))
                .flatMap(url -> registerMedia(context, AiTaskTypes.VIDEO, url));
    }

    /**
     * 提交请求并解析最终媒体URL。
     * <p>
     * 提交响应按结果路径提取：命中http(s)地址直接成功；视频模式且配置了查询模板时，
     * 将提取结果作为任务ID进入轮询；其余情况交给LLM回退提取。
     *
     * @param context           AiTaskExecutionContext AI任务执行上下文
     * @param group             PersistenceDtos.CustomModelGroupConfig 当前能力或模式配置
     * @param mode              String 能力或模式
     * @param taskKind          String 任务类型
     * @param referenceUrls     List<String> 参考图片URL列表
     * @param videoReferenceUrls List<String> 参考视频URL列表
     * @return Mono<String> 媒体URL
     */
    private Mono<String> submitAndResolveUrl(AiTaskExecutionContext context, PersistenceDtos.CustomModelGroupConfig group,
                                             String mode, String taskKind, List<String> referenceUrls, List<String> videoReferenceUrls) {
        if (!StringUtils.hasText(group.requestPath())) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "自定义模型未配置请求路径"));
        }
        String method = normalizeMethod(group.requestMethod());
        String url = AiHttpClient.buildAiUrl(context.channel().baseUrl(), renderUrlPath(group.requestPath(), null));
        Mono<JSONObject> bodyMono = resolveSubmitBody(context, group, referenceUrls, videoReferenceUrls);
        return bodyMono.flatMap(body -> {
                    log.info("自定义模型提交请求: taskId={}, taskType={}, mode={}, method={}, url={}, body={}", context.task().getId(), taskKind,
                            mode, method, url, abbreviate(body == null ? "" : body.toJSONString()));
                    return aiHttpClient.sendBearerJsonUrlRequest(context.channel(), method, url, body);
                })
                .flatMap(response -> {
                    log.info("自定义模型提交响应: taskId={}, mode={}, response={}", context.task().getId(), mode,
                            AiJsonUtils.formatResponseForLog(response).toJSONString());
                    String errorMessage = providerErrorMessage(response);
                    if (StringUtils.hasText(errorMessage)) {
                        return Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR,
                                "自定义模型接口调用失败: " + errorMessage));
                    }
                    String extracted = extractByPath(response, group.resultPath());
                    if (isHttpUrl(extracted)) {
                        return Mono.just(extracted);
                    }
                    if (AiTaskTypes.VIDEO.equals(taskKind) && StringUtils.hasText(group.queryPath())
                            && StringUtils.hasText(extracted)) {
                        log.info("自定义模型提交响应返回任务ID，开始轮询: taskId={}, providerTaskId={}", context.task().getId(), extracted);
                        return pollQuery(context, group, extracted);
                    }
                    return extractWithAgent(context, taskKind, response);
                });
    }

    /**
     * 构造提交请求体：GET无请求体；配置了AI构造提示词时交给Agent生成；否则按模板+占位符拼接。
     *
     * @param context           AiTaskExecutionContext AI任务执行上下文
     * @param group             PersistenceDtos.CustomModelGroupConfig 当前能力或模式配置
     * @param referenceUrls     List<String> 参考图片URL列表
     * @param videoReferenceUrls List<String> 参考视频URL列表
     * @return Mono<JSONObject> 请求体，GET时为空对象
     */
    private Mono<JSONObject> resolveSubmitBody(AiTaskExecutionContext context, PersistenceDtos.CustomModelGroupConfig group,
                                               List<String> referenceUrls, List<String> videoReferenceUrls) {
        String method = normalizeMethod(group.requestMethod());
        if ("GET".equals(method)) {
            // Mono.just不允许null；GET时HTTP客户端忽略请求体，返回空对象即可
            return Mono.just(new JSONObject());
        }
        if (StringUtils.hasText(group.aiRequestPrompt())) {
            return buildBodyWithAgent(context, group, group.aiRequestPrompt(), "请求体", referenceUrls, videoReferenceUrls, null);
        }
        return Mono.fromCallable(() -> parseRenderedBody(
                renderTemplate(group.requestTemplate(), buildPlaceholders(context, group, referenceUrls, videoReferenceUrls, null)), "请求示例"));
    }

    /**
     * 轮询查询接口直到提取到媒体URL或超时。
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @param group   PersistenceDtos.CustomModelGroupConfig 当前能力或模式配置
     * @param taskId  String 提交响应提取的任务ID
     * @return Mono<String> 媒体URL
     */
    private Mono<String> pollQuery(AiTaskExecutionContext context, PersistenceDtos.CustomModelGroupConfig group,
                                   String taskId) {
        // 轮询间隔统一使用全局AI_TASK_POLLING_INTERVAL_SECONDS配置
        Duration interval = AiTaskPollingSupport.pollingInterval(properties);
        String method = normalizeMethod(group.queryMethod());
        String queryUrl = AiHttpClient.buildAiUrl(context.channel().baseUrl(), renderUrlPath(group.queryPath(), taskId));
        // 查询请求体只构造一次：AI构造模式避免每轮重复调用LLM，模板模式渲染结果幂等。
        Mono<JSONObject> bodyMono = resolveQueryBody(context, group, taskId).cache();
        AtomicReference<JSONObject> lastResponse = new AtomicReference<>();
        return Flux.range(0, MAX_POLLING_ATTEMPTS)
                .concatMap(attempt -> Mono.delay(interval)
                        .then(context.isCancelRequested())
                        .flatMap(cancelRequested -> {
                            if (Boolean.TRUE.equals(cancelRequested)) {
                                return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "任务已取消"));
                            }
                            int progress = Math.min(95, 20 + attempt);
                            return context.updateRunningProgress(progress).then(
                                    bodyMono.flatMap(body -> {
                                        log.info("自定义模型查询轮询第{}次: taskId={}, providerTaskId={}, method={}, url={}, body={}",
                                                attempt + 1, context.task().getId(), taskId, method, queryUrl, abbreviate(body == null ? "" : body.toJSONString()));
                                        return aiHttpClient.sendBearerJsonUrlRequest(context.channel(), method, queryUrl, body)
                                                // GOAWAY/连接重置等瞬态IO错误重发新连接即可恢复，不放大为任务失败
                                                .retryWhen(Retry.max(2).filter(CustomProviderAdapter::isTransientNetworkError))
                                                .doOnNext(response -> lastResponse.set(response))
                                                .flatMap(response -> {
                                                    String errorMessage = providerErrorMessage(response);
                                                    if (StringUtils.hasText(errorMessage)) {
                                                        return Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR,
                                                                "自定义模型查询接口调用失败: " + errorMessage));
                                                    }
                                                    log.info("自定义模型查询轮询第{}次响应: taskId={}, providerTaskId={}, response={}",
                                                            attempt + 1, context.task().getId(), taskId,
                                                            AiJsonUtils.formatResponseForLog(response).toJSONString());
                                                    return Mono.just(response);
                                                });
                                    }));
                        }))
                .map(response -> extractByPath(response, group.queryResultPath()))
                .filter(CustomProviderAdapter::isHttpUrl)
                .next()
                .switchIfEmpty(Mono.defer(() -> extractWithAgent(context, AiTaskTypes.VIDEO,
                        lastResponse.get() == null ? new JSONObject() : lastResponse.get())));
    }

    /**
     * 构造查询请求体：GET无请求体；配置了AI构造提示词时交给Agent生成；否则按模板+占位符拼接。
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @param group   PersistenceDtos.CustomModelGroupConfig 当前能力或模式配置
     * @param taskId  String 轮询任务ID
     * @return Mono<JSONObject> 查询请求体，GET时为空对象
     */
    private Mono<JSONObject> resolveQueryBody(AiTaskExecutionContext context, PersistenceDtos.CustomModelGroupConfig group,
                                              String taskId) {
        String method = normalizeMethod(group.queryMethod());
        if ("GET".equals(method)) {
            // Mono.just不允许null；GET时HTTP客户端忽略请求体，返回空对象即可
            return Mono.just(new JSONObject());
        }
        if (StringUtils.hasText(group.aiQueryPrompt())) {
            return buildBodyWithAgent(context, group, group.aiQueryPrompt(), "查询请求体", List.of(), List.of(), taskId);
        }
        return Mono.fromCallable(() -> parseRenderedBody(
                renderTemplate(group.queryRequestTemplate(), buildPlaceholders(context, group, List.of(), List.of(), taskId)), "查询请求示例"));
    }

    /**
     * 交由默认文本模型按用户提示词与本次请求参数构造请求体JSON。
     *
     * @param context           AiTaskExecutionContext AI任务执行上下文
     * @param group             PersistenceDtos.CustomModelGroupConfig 当前能力或模式配置
     * @param userPrompt        String 用户配置的AI构造提示词
     * @param purpose           String 构造用途（请求体/查询请求体），用于错误提示
     * @param referenceUrls     List<String> 参考图片URL列表
     * @param videoReferenceUrls List<String> 参考视频URL列表
     * @param taskId            String 轮询任务ID，提交阶段为null
     * @return Mono<JSONObject> AI构造的请求体
     */
    private Mono<JSONObject> buildBodyWithAgent(AiTaskExecutionContext context, PersistenceDtos.CustomModelGroupConfig group,
                                                String userPrompt, String purpose, List<String> referenceUrls,
                                                List<String> videoReferenceUrls, String taskId) {
        String prompt = "你是AI请求体构造助手。请严格按用户要求构造JSON请求体对象。\n\n"
                + "用户构造要求：\n" + userPrompt + "\n\n"
                + "本次请求信息：\n" + describeRequestParameters(context, group, referenceUrls, videoReferenceUrls, taskId) + "\n\n"
                + "只返回请求体JSON对象，不要返回解释、Markdown代码块或任何其他内容。";
        log.info("AI构造请求体请求: taskId={}, purpose={}, prompt={}", context.task().getId(), purpose, abbreviate(prompt));
        AtomicReference<String> agentOutput = new AtomicReference<>();
        return Mono.defer(() -> agentScopeModelFactory.defaultTextModel()
                        .flatMap(model -> {
                            Msg userMsg = Msg.builder().role(MsgRole.USER).textContent(prompt).build();
                            // 聚合整条流而非取首个块：deepseek思考模式首个SSE增量块content为空
                            return model.stream(List.of(userMsg), List.of(), GenerateOptions.builder().build())
                                    .map(CustomProviderAdapter::chatResponseText)
                                    .collectList()
                                    .map(parts -> String.join("", parts))
                                    .timeout(Duration.ofSeconds(LLM_EXTRACTION_TIMEOUT_SECONDS));
                        })
                        .doOnNext(text -> {
                            agentOutput.set(text);
                            log.info("AI构造请求体响应: taskId={}, purpose={}, output={}", context.task().getId(), purpose, abbreviate(text));
                        })
                        .map(CustomProviderAdapter::extractFirstJsonObject)
                        // 偶发空返回或非法JSON：清空上次输出记录并有限重试后再判定失败
                        .retryWhen(Retry.fixedDelay(BODY_BUILD_MAX_RETRIES, Duration.ofMillis(200))
                                .filter(CustomProviderAdapter::isRetryableBodyError)
                                .doAfterRetry(retrySignal -> agentOutput.set(null))))
                .onErrorResume(exception -> Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR,
                        "AI构造" + purpose + "失败: " + exception.getMessage()
                                + (StringUtils.hasText(agentOutput.get()) ? "，AI返回内容: " + abbreviate(agentOutput.get()) : ""))));
    }

    /**
     * 描述本次请求的实际参数，供AI构造请求体时参考。
     *
     * @param context           AiTaskExecutionContext AI任务执行上下文
     * @param group             PersistenceDtos.CustomModelGroupConfig 当前能力或模式配置
     * @param referenceUrls     List<String> 参考图片URL列表
     * @param videoReferenceUrls List<String> 参考视频URL列表
     * @param taskId            String 轮询任务ID，可为null
     * @return String 参数描述文本
     */
    private String describeRequestParameters(AiTaskExecutionContext context, PersistenceDtos.CustomModelGroupConfig group,
                                             List<String> referenceUrls, List<String> videoReferenceUrls, String taskId) {
        StringBuilder builder = new StringBuilder();
        builder.append("- 用户提示词: ").append(context.request().prompt()).append('\n');
        if (StringUtils.hasText(group.requestModelName())) {
            builder.append("- 请求模型名称: ").append(group.requestModelName()).append('\n');
        }
        builder.append("- 请求路径: ").append(group.requestPath()).append('\n');
        builder.append("- 请求方法: ").append(normalizeMethod(group.requestMethod())).append('\n');
        if (referenceUrls != null && !referenceUrls.isEmpty()) {
            builder.append("- 参考图片: ").append(referenceUrls).append('\n');
        }
        if (videoReferenceUrls != null && !videoReferenceUrls.isEmpty()) {
            builder.append("- 参考视频: ").append(videoReferenceUrls).append('\n');
        }
        Map<String, Object> parameters = context.request().parameters() == null ? Map.of() : context.request().parameters();
        String size = AiTaskParameterReader.stringParameter(parameters, "size", "");
        if (StringUtils.hasText(size)) {
            builder.append("- 画幅: ").append(size).append('\n');
        }
        String resolution = AiTaskParameterReader.stringParameter(parameters, "resolution", "");
        if (StringUtils.hasText(resolution)) {
            builder.append("- 分辨率: ").append(resolution).append('\n');
        }
        String seconds = AiTaskParameterReader.stringParameter(parameters, "seconds", "");
        if (StringUtils.hasText(seconds)) {
            builder.append("- 时长(秒): ").append(seconds).append('\n');
        }
        builder.append("- 数量: ").append(AiTaskParameterReader.intParameter(parameters, "count", 1, 1, 10)).append('\n');
        if (StringUtils.hasText(taskId)) {
            builder.append("- 轮询任务ID: ").append(taskId).append('\n');
        }
        return builder.toString().trim();
    }

    /**
     * 交由默认文本模型从响应原文中提取媒体URL，仍失败时报错。
     *
     * @param context  AiTaskExecutionContext AI任务执行上下文
     * @param taskKind String 任务类型
     * @param response JSONObject 实际响应原文
     * @return Mono<String> 媒体URL
     */
    private Mono<String> extractWithAgent(AiTaskExecutionContext context, String taskKind, JSONObject response) {
        String rawResponse = AiJsonUtils.formatResponseForLog(response).toJSONString();
        String target = AiTaskTypes.VIDEO.equals(taskKind) ? "视频" : "图片";
        return agentScopeModelFactory.defaultTextModel()
                .flatMap(model -> {
                    String prompt = "你是媒体地址提取助手。以下是调用第三方AI接口返回的JSON响应，请从中提取"
                            + target + "文件的直接可访问URL（http或https开头）。"
                            + "只返回一个JSON对象，格式为 {\"url\": \"<完整URL>\"}，不要返回任何其他内容。\n\n响应原文：\n" + rawResponse;
                    Msg userMsg = Msg.builder().role(MsgRole.USER).textContent(prompt).build();
                    // 聚合整条流而非取首个块：deepseek思考模式首个SSE增量块content为空
                    return model.stream(List.of(userMsg), List.of(), GenerateOptions.builder().build())
                            .map(CustomProviderAdapter::chatResponseText)
                            .collectList()
                            .map(parts -> String.join("", parts))
                            .timeout(Duration.ofSeconds(LLM_EXTRACTION_TIMEOUT_SECONDS));
                })
                .map(CustomProviderAdapter::findFirstMediaUrl)
                .flatMap(url -> StringUtils.hasText(url)
                        ? Mono.just(url)
                        : Mono.<String>error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR,
                        "自定义模型调用成功但无法从响应中解析出" + target + "媒体地址，请检查请求/响应示例与结果路径配置")))
                .onErrorResume(BusinessException.class, Mono::error)
                .onErrorResume(exception -> Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR,
                        "自定义模型调用成功但无法从响应中解析出" + target + "媒体地址，请检查请求/响应示例与结果路径配置")));
    }

    /**
     * 登记生成媒体地址并返回任务结果。
     *
     * @param context  AiTaskExecutionContext AI任务执行上下文
     * @param taskKind String 任务类型
     * @param url      String 媒体URL
     * @return Mono<JSONObject> 任务结果JSON
     */
    private Mono<JSONObject> registerMedia(AiTaskExecutionContext context, String taskKind, String url) {
        String mimeType = AiTaskTypes.VIDEO.equals(taskKind) ? "video/mp4" : null;
        return mediaSupport.registerGeneratedMediaUrl(context.task().getUserId(), taskKind, url, mimeType, null, null, null)
                .map(media -> AiJsonUtils.jsonObject(Map.of("item", media)));
    }

    /**
     * 解析参考媒体URL列表，保持关联顺序。
     *
     * @param context    AiTaskExecutionContext AI任务执行上下文
     * @param references List<AiTaskMediaReference> 原始参考媒体列表
     * @return Mono<List<String>> 解析后的公网URL列表
     */
    private Mono<List<String>> resolveReferenceUrls(AiTaskExecutionContext context,
                                                    List<AiTaskDtos.AiTaskMediaReference> references) {
        return Flux.fromIterable(AiTaskParameterReader.safeReferences(references))
                .concatMap(reference -> mediaSupport.resolveReferenceUrl(context.task().getUserId(), reference))
                .collectList();
    }

    /**
     * 判定视频生成模式：优先使用请求声明的模式，其次按参考图判定图生视频，否则文生视频。
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @return String 视频生成模式
     */
    private String resolveVideoMode(AiTaskExecutionContext context) {
        String mode = AiTaskParameterReader.firstNonEmpty(context.request().videoGenerationMode());
        if (StringUtils.hasText(mode)) {
            return mode;
        }
        if (!AiTaskParameterReader.safeReferences(context.request().references()).isEmpty()) {
            return VideoGenerationMode.IMAGE_TO_VIDEO;
        }
        return VideoGenerationMode.TEXT_TO_VIDEO;
    }

    /**
     * 读取当前能力或模式的自定义配置，缺失时抛错。
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @param mode    String 能力或模式
     * @return PersistenceDtos.CustomModelGroupConfig 分组配置
     */
    private PersistenceDtos.CustomModelGroupConfig requireGroup(AiTaskExecutionContext context, String mode) {
        Map<String, PersistenceDtos.CustomModelGroupConfig> configs = context.customModelConfig();
        PersistenceDtos.CustomModelGroupConfig group = configs == null ? null : configs.get(mode);
        if (group == null) {
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, "自定义模型未配置该能力或模式: " + mode);
        }
        return group;
    }

    /**
     * 组装占位符值，值经JSON编码后替换模板中的{{xxx}}占位符。
     *
     * @param context           AiTaskExecutionContext AI任务执行上下文
     * @param group             PersistenceDtos.CustomModelGroupConfig 当前分组配置
     * @param referenceUrls     List<String> 参考图片URL列表
     * @param videoReferenceUrls List<String> 参考视频URL列表
     * @param taskId            String 轮询任务ID，提交阶段为null
     * @return Map<String, Object> 占位符值表
     */
    private Map<String, Object> buildPlaceholders(AiTaskExecutionContext context, PersistenceDtos.CustomModelGroupConfig group,
                                                  List<String> referenceUrls, List<String> videoReferenceUrls, String taskId) {
        Map<String, Object> placeholders = new LinkedHashMap<>();
        placeholders.put("prompt", context.request().prompt());
        placeholders.put("model", group.requestModelName());
        if (referenceUrls != null && !referenceUrls.isEmpty()) {
            placeholders.put("references", referenceUrls);
        }
        if (videoReferenceUrls != null && !videoReferenceUrls.isEmpty()) {
            placeholders.put("videoReferences", videoReferenceUrls);
        }
        Map<String, Object> parameters = context.request().parameters() == null ? Map.of() : context.request().parameters();
        String size = AiTaskParameterReader.stringParameter(parameters, "size", "");
        if (StringUtils.hasText(size)) {
            placeholders.put("size", size);
        }
        String resolution = AiTaskParameterReader.stringParameter(parameters, "resolution", "");
        if (StringUtils.hasText(resolution)) {
            placeholders.put("resolution", resolution);
        }
        String seconds = AiTaskParameterReader.stringParameter(parameters, "seconds", "");
        if (StringUtils.hasText(seconds)) {
            placeholders.put("seconds", seconds);
        }
        placeholders.put("count", AiTaskParameterReader.intParameter(parameters, "count", 1, 1, 10));
        if (StringUtils.hasText(taskId)) {
            placeholders.put("taskId", taskId);
            // 兼容{{task_id}}占位符写法
            placeholders.put("task_id", taskId);
        }
        return placeholders;
    }

    /**
     * 规范化自定义模型请求方法，空值默认POST。
     *
     * @param method String 原始请求方法
     * @return String GET或POST
     */
    private static String normalizeMethod(String method) {
        String normalized = StringUtils.hasText(method) ? method.trim().toUpperCase() : "POST";
        return "GET".equals(normalized) ? "GET" : "POST";
    }

    /**
     * 渲染请求或查询路径，将{{taskId}}占位符替换为URL编码的任务ID。
     * <p>
     * 与请求体模板渲染（JSON编码）刻意分离：路径占位符值需URL编码，提交阶段无任务ID时替换为空串。
     *
     * @param path   String 请求或查询路径
     * @param taskId String 轮询任务ID，提交阶段为null
     * @return String 渲染后的路径
     */
    private static String renderUrlPath(String path, String taskId) {
        if (!StringUtils.hasText(path)) {
            return "";
        }
        String encoded = StringUtils.hasText(taskId) ? URLEncoder.encode(taskId, StandardCharsets.UTF_8).replace("+", "%20") : "";
        // 兼容{{taskId}}与{{task_id}}两种占位符写法
        return path.replace("{{taskId}}", encoded).replace("{{task_id}}", encoded);
    }

    /**
     * 严格解析渲染后的请求体模板，渲染结果不是合法JSON对象时显式报错。
     * <p>
     * 避免模板为空或含尾逗号/注释等错误时静默发送空请求体，导致第三方接口报"缺少必填参数"而难以定位。
     *
     * @param rendered  String 渲染后的JSON文本
     * @param fieldName String 配置项名称，用于错误提示
     * @return JSONObject 解析后的请求体
     */
    private static JSONObject parseRenderedBody(String rendered, String fieldName) {
        try {
            JSONObject parsed = JSON.parseObject(StringUtils.hasText(rendered) ? rendered : "");
            if (parsed == null) {
                throw new IllegalArgumentException("解析结果为空");
            }
            return parsed;
        } catch (Exception exception) {
            throw new BusinessException(ErrorCode.PARAM_INVALID,
                    "自定义模型" + fieldName + "渲染结果不是合法JSON: " + abbreviate(StringUtils.hasText(rendered) ? rendered : "")
                            + "（请检查占位符写法与引号，字段值需用占位符如{{prompt}}引用）");
        }
    }

    /**
     * 渲染请求模板，缺失占位符替换为JSON的null。
     * <p>
     * 占位符渲染为上下文感知：被JSON引号包裹时（如 "prompt": "{{prompt}}"）替换为转义后的裸字符串值；
     * 未包裹时（如 "image": {{references}}）替换为JSON编码值。两种写法均支持，避免双重引号。
     *
     * @param template     String 请求体JSON模板
     * @param placeholders Map<String, Object> 占位符值表
     * @return String 渲染后的JSON文本
     */
    private static String renderTemplate(String template, Map<String, Object> placeholders) {
        if (!StringUtils.hasText(template)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "自定义模型请求示例不能为空");
        }
        Matcher matcher = PLACEHOLDER_PATTERN.matcher(template);
        StringBuffer buffer = new StringBuffer();
        while (matcher.find()) {
            String key = matcher.group(1);
            Object value = placeholders.get(key);
            matcher.appendReplacement(buffer, Matcher.quoteReplacement(renderPlaceholder(template, matcher.start(), matcher.end(), value)));
        }
        matcher.appendTail(buffer);
        return buffer.toString();
    }

    /**
     * 按上下文渲染单个占位符。
     *
     * @param template String 完整模板
     * @param start    int 占位符起始位置
     * @param end      int 占位符结束位置
     * @param value    Object 占位符值
     * @return String 替换文本
     */
    private static String renderPlaceholder(String template, int start, int end, Object value) {
        if (value == null) {
            return "null";
        }
        if (isWrappedByQuotes(template, start, end)) {
            // 字符串上下文：替换为转义后的裸字符串值，避免与模板引号叠加成双重引号。
            return escapeJsonString(String.valueOf(value));
        }
        // 值上下文：替换为JSON编码值（字符串带引号、数组为JSON数组、数字为数字）。
        return JSON.toJSONString(value);
    }

    /**
     * 判断占位符是否被JSON引号包裹，即紧邻占位符两侧（允许空白）各有一个双引号。
     *
     * @param template String 完整模板
     * @param start    int 占位符起始位置
     * @param end      int 占位符结束位置
     * @return boolean 是否处于字符串上下文
     */
    private static boolean isWrappedByQuotes(String template, int start, int end) {
        int before = start - 1;
        while (before >= 0 && Character.isWhitespace(template.charAt(before))) {
            before--;
        }
        int after = end;
        while (after < template.length() && Character.isWhitespace(template.charAt(after))) {
            after++;
        }
        return before >= 0 && after < template.length()
                && template.charAt(before) == '"' && template.charAt(after) == '"';
    }

    /**
     * 将字符串转义为JSON字符串字面量内容（不含外层引号）。
     *
     * @param text String 原始文本
     * @return String 转义后的裸字符串内容
     */
    private static String escapeJsonString(String text) {
        if (text == null) {
            return "";
        }
        String encoded = JSON.toJSONString(text);
        if (encoded.length() >= 2 && encoded.startsWith("\"") && encoded.endsWith("\"")) {
            return encoded.substring(1, encoded.length() - 1);
        }
        return encoded;
    }

    /**
     * 从第三方响应中提取可展示的错误信息。
     * <p>
     * 兼容常见错误结构：顶层error对象/字符串，或非成功code搭配msg/message。
     * 成功响应（code为0/success/ok）不视为错误。
     *
     * @param response JSONObject 第三方响应
     * @return String 错误信息，无错误时返回空字符串
     */
    private static String providerErrorMessage(JSONObject response) {
        if (response == null) {
            return "";
        }
        Object error = response.get("error");
        if (error instanceof JSONObject errorObj) {
            String message = AiTaskParameterReader.firstNonEmpty(
                    errorObj.getString("message"), errorObj.getString("msg"), errorObj.getString("code"));
            if (StringUtils.hasText(message)) {
                return message;
            }
        }
        if (error instanceof String text && StringUtils.hasText(text)) {
            return text;
        }
        String code = response.getString("code");
        String message = AiTaskParameterReader.firstNonEmpty(response.getString("msg"), response.getString("message"));
        if (StringUtils.hasText(code) && !isSuccessfulCode(code) && StringUtils.hasText(message)) {
            return code + ": " + message;
        }
        return "";
    }

    /**
     * 判断第三方响应错误码是否为成功码。
     *
     * @param code String 响应code字段
     * @return boolean 是否为成功码
     */
    private static boolean isSuccessfulCode(String code) {
        String normalized = code.trim();
        return "0".equals(normalized) || "0.0".equals(normalized)
                || "success".equalsIgnoreCase(normalized) || "ok".equalsIgnoreCase(normalized);
    }

    /**
     * 按点分路径从响应中提取字符串值，支持数组索引如data.items[0].url，兼容code/data统一包装。
     *
     * @param response JSONObject 第三方响应
     * @param path     String 点分路径
     * @return String 提取的字符串值，未命中返回空字符串
     */
    private static String extractByPath(JSONObject response, String path) {
        if (response == null || !StringUtils.hasText(path)) {
            return "";
        }
        // 先按统一包装解包后的载荷解析；若配置路径带 code/data 前缀导致未命中，回退到原始响应再解析
        String result = resolvePath(AiJsonUtils.responsePayload(response), splitPath(path.trim()));
        return StringUtils.hasText(result) ? result : resolvePath(response, splitPath(path.trim()));
    }

    /** 按段列表从给定根节点逐层取值。 */
    private static String resolvePath(Object root, List<String> segments) {
        Object current = root;
        for (String segment : segments) {
            if (current instanceof JSONObject object) {
                current = object.get(segment);
            } else if (current instanceof JSONArray array) {
                int index = parseIndex(segment);
                current = index >= 0 && index < array.size() ? array.get(index) : null;
            } else {
                return "";
            }
            if (current == null) {
                return "";
            }
        }
        return current instanceof String text ? text : "";
    }

    /**
     * 拆分点分路径为段列表，data.items[0].url → [data, items, 0, url]。
     *
     * @param path String 点分路径
     * @return List<String> 段列表
     */
    private static List<String> splitPath(String path) {
        List<String> segments = new ArrayList<>();
        Matcher matcher = Pattern.compile("([^\\[\\].]+)|\\[(\\d+)]").matcher(path);
        while (matcher.find()) {
            segments.add(matcher.group(1) != null ? matcher.group(1) : matcher.group(2));
        }
        return segments;
    }

    /**
     * 解析数组索引段，非数字返回-1。
     *
     * @param segment String 段文本
     * @return int 索引值
     */
    private static int parseIndex(String segment) {
        try {
            return Integer.parseInt(segment);
        } catch (NumberFormatException exception) {
            return -1;
        }
    }

    /**
     * 判断提取结果是否为可访问的http(s)地址。
     *
     * @param value String 提取值
     * @return boolean 是否为http(s)地址
     */
    private static boolean isHttpUrl(String value) {
        return StringUtils.hasText(value) && (value.startsWith("http://") || value.startsWith("https://"));
    }

    /**
     * 判断是否为可重试的瞬态网络错误（GOAWAY、连接重置等IO异常），业务异常不在此列。
     *
     * @param throwable Throwable 异常
     * @return boolean 是否瞬态网络错误
     */
    private static boolean isTransientNetworkError(Throwable throwable) {
        return throwable instanceof IOException;
    }

    /**
     * 拼接模型流式响应的文本内容。
     *
     * @param response ChatResponse 模型响应
     * @return String 文本内容
     */
    private static String chatResponseText(ChatResponse response) {
        if (response == null || response.getContent() == null) {
            return "";
        }
        return response.getContent().stream()
                .filter(block -> block instanceof TextBlock)
                .map(block -> ((TextBlock) block).getText())
                .collect(Collectors.joining());
    }

    /**
     * 从LLM输出中提取首个媒体URL，优先解析JSON的url字段，其次正则匹配。
     *
     * @param text String LLM输出文本
     * @return String 媒体URL，未命中返回空字符串
     */
    private static String findFirstMediaUrl(String text) {
        if (!StringUtils.hasText(text)) {
            return "";
        }
        JSONObject json = AiJsonUtils.parseJson(text);
        String url = json.getString("url");
        if (StringUtils.hasText(url)) {
            return url;
        }
        Matcher matcher = MEDIA_URL_PATTERN.matcher(text);
        return matcher.find() ? matcher.group() : "";
    }

    /**
     * 从LLM输出中提取首个JSON对象，兼容纯JSON、Markdown代码块与前后附带说明文字。
     *
     * @param text String LLM输出文本
     * @return JSONObject 解析出的JSON对象
     * @throws BusinessException LLM输出不含合法JSON对象时抛出
     */
    private static JSONObject extractFirstJsonObject(String text) {
        if (StringUtils.hasText(text)) {
            String trimmed = text.trim();
            try {
                JSONObject direct = JSON.parseObject(trimmed);
                if (direct != null) {
                    return direct;
                }
            } catch (Exception ignored) {
                // 继续尝试其他提取方式
            }
            Matcher codeBlock = Pattern.compile("```(?:json)?\\s*([\\s\\S]*?)```").matcher(trimmed);
            if (codeBlock.find()) {
                try {
                    JSONObject fromCodeBlock = JSON.parseObject(codeBlock.group(1).trim());
                    if (fromCodeBlock != null) {
                        return fromCodeBlock;
                    }
                } catch (Exception ignored) {
                    // 继续尝试花括号提取
                }
            }
            int firstBrace = trimmed.indexOf('{');
            int lastBrace = trimmed.lastIndexOf('}');
            if (firstBrace >= 0 && lastBrace > firstBrace) {
                try {
                    JSONObject fromBraces = JSON.parseObject(trimmed.substring(firstBrace, lastBrace + 1));
                    if (fromBraces != null) {
                        return fromBraces;
                    }
                } catch (Exception ignored) {
                    // 返回下方错误
                }
            }
        }
        throw new BusinessException(ErrorCode.BUSINESS_ERROR, "AI返回内容不是合法JSON对象");
    }

    /**
     * 判断是否为可重试的请求体构造失败（LLM偶发返回空内容或非法JSON）。
     *
     * @param exception Throwable 异常
     * @return boolean 是否可重试
     */
    private static boolean isRetryableBodyError(Throwable exception) {
        return exception instanceof BusinessException
                && StringUtils.hasText(exception.getMessage())
                && exception.getMessage().contains("不是合法JSON对象");
    }

    /**
     * 截断日志中的请求体。
     *
     * @param body String 请求体JSON文本
     * @return String 截断后的文本
     */
    private static String abbreviate(String body) {
        if (body == null || body.length() <= 2000) {
            return body == null ? "" : body;
        }
        return body.substring(0, 2000) + "...(已截断)";
    }
}
