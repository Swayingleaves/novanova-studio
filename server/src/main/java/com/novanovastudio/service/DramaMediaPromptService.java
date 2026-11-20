package com.novanovastudio.service;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.agent.AgentScopeAgentFactory;
import com.novanovastudio.agent.AgentScopeModelFactory;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.DramaContracts;
import io.agentscope.core.ReActAgent;
import io.agentscope.core.agent.RuntimeContext;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * 调用短剧提示词 Agent，为一次出图或出视频写出提示词和参考图顺序。
 * <p>服务端只提供阶段产物和可用参考图，不再拼装任何提示词文案。</p>
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-15 16:20
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class DramaMediaPromptService {

    /** Agent工厂。 */
    private final AgentScopeAgentFactory agentFactory;

    /** 模型工厂。 */
    private final AgentScopeModelFactory modelFactory;

    /** 超时配置。 */
    private final NovanovaProperties properties;

    /**
     * 一次提示词请求。
     *
     * @param targetKey 生成目标
     * @param mediaType image 或 video
     * @param seconds 视频秒数，图片为 0
     * @param storyboard 最新分镜
     * @param cast 角色与场景
     * @param plan 制作方案
     * @param production 镜头制作
     * @param availableReferences 已有成功参考图的目标
     * @param aspectRatio 项目画幅
     * @param textModel 文本模型
     * @param userId 当前用户
     */
    public record Request(String targetKey, String mediaType, int seconds, JSONObject storyboard, JSONObject cast,
                          JSONObject plan, JSONObject production, List<String> availableReferences, String aspectRatio,
                          String textModel, long userId) {
    }

    /**
     * 让短剧提示词 Agent 写一个生成目标的提示词。
     *
     * @param request 一次提示词请求
     * @return 带目标、提示词和参考图顺序的提交内容
     */
    public Mono<DramaContracts.MediaItem> write(Request request) {
        JSONObject input = input(request);
        return modelFactory.resolveTextModel(request.textModel())
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "没有可用的文本模型")))
                .flatMap(model -> Mono.defer(() -> {
                    ReActAgent agent = agentFactory.dramaMediaAgent(model.agentModel());
                    log.info("短剧提示词Agent请求: targetKey={}, model={}, input={}", request.targetKey(), model.modelValue(), input.toJSONString());
                    return agent.call(input.toJSONString(), DramaContracts.MediaPrompt.class, RuntimeContext.builder()
                                    .sessionId("drama-media:" + request.targetKey() + ":" + UUID.randomUUID())
                                    .userId(String.valueOf(request.userId())).build())
                            .timeout(Duration.ofSeconds(properties.timeoutSettings().scriptAgentTimeoutSeconds()))
                            .map(message -> {
                                DramaContracts.MediaPrompt result = message.getStructuredData(DramaContracts.MediaPrompt.class);
                                return result == null ? new DramaContracts.MediaPrompt("", List.of()) : result;
                            })
                            .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "短剧提示词Agent未返回结构化结果")))
                            .doFinally(signal -> agent.close());
                }))
                .map(result -> item(request.targetKey(), result))
                .onErrorMap(error -> error instanceof BusinessException ? error
                        : new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "短剧提示词Agent调用失败：" + error.getMessage()))
                .subscribeOn(Schedulers.boundedElastic());
    }

    private DramaContracts.MediaItem item(String targetKey, DramaContracts.MediaPrompt result) {
        if (result == null || !StringUtils.hasText(result.prompt())) {
            throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "短剧提示词Agent没有写出提示词");
        }
        List<String> keys = new ArrayList<>();
        if (result.referenceKeys() != null) {
            for (String key : result.referenceKeys()) {
                if (StringUtils.hasText(key) && !keys.contains(key.trim())) {
                    keys.add(key.trim());
                }
            }
        }
        return new DramaContracts.MediaItem(targetKey, result.prompt().trim(), keys);
    }

    private JSONObject input(Request request) {
        JSONObject input = new JSONObject();
        input.put("targetKey", request.targetKey());
        input.put("mediaType", request.mediaType());
        input.put("seconds", request.seconds());
        input.put("aspectRatio", request.aspectRatio());
        input.put("style", text(request.plan(), "style"));
        JSONObject shot = find(request.storyboard(), "shots", DramaMediaTargets.ref(request.targetKey()));
        if (shot != null) {
            input.put("shot", shot);
        }
        if ("sheet".equals(DramaMediaTargets.kind(request.targetKey()))) {
            JSONObject previous = previousShot(request);
            if (previous != null) {
                input.put("previousShot", previous);
            }
        }
        if (request.cast() != null) {
            input.put("cast", request.cast());
        }
        JSONObject directed = find(request.production(), "shots", DramaMediaTargets.ref(request.targetKey()));
        if (directed != null) {
            input.put("production", directed);
        }
        JSONArray references = new JSONArray();
        references.addAll(request.availableReferences());
        input.put("availableReferences", references);
        return input;
    }

    private JSONObject previousShot(Request request) {
        String previous = DramaMediaTargets.previousRef(request.storyboard(), DramaMediaTargets.ref(request.targetKey()));
        if (!StringUtils.hasText(previous)) {
            return null;
        }
        JSONObject shot = find(request.storyboard(), "shots", previous);
        if (shot == null) {
            return null;
        }
        JSONObject summary = new JSONObject();
        summary.put("ref", previous);
        summary.put("picture", shot.getString("picture"));
        summary.put("dialogue", shot.getString("dialogue"));
        summary.put("lastFrameKey", "cut:last:" + previous);
        summary.put("lastFrameReady", request.availableReferences().contains("cut:last:" + previous));
        return summary;
    }

    private JSONObject find(JSONObject content, String arrayName, String ref) {
        JSONArray array = content == null ? null : content.getJSONArray(arrayName);
        if (array == null) {
            return null;
        }
        for (int index = 0; index < array.size(); index++) {
            JSONObject item = array.getJSONObject(index);
            if (item != null && ref.equals(item.getString("ref"))) {
                return item;
            }
        }
        return null;
    }

    private String text(JSONObject item, String key) {
        if (item == null) {
            return "";
        }
        String value = item.getString(key);
        return value == null ? "" : value.trim();
    }
}
