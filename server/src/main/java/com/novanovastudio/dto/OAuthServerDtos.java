package com.novanovastudio.dto;

import com.novanovastudio.common.SystemMessage;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 对外 OAuth2 授权协议中由本站前端调用的数据结构。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-09 18:40
 */
public final class OAuthServerDtos {

    /**
     * 禁止实例化。
     */
    private OAuthServerDtos() {
    }

    /**
     * 授权确认页展示的应用信息。
     *
     * @param displayName 应用名称
     * @param scope 已接受的授权范围
     * @param logoUrl 应用图标读地址，未配置时为空
     * @param displayContent 授权页展示文字，未配置时为空
     */
    public record AuthorizationRequestView(String displayName, String scope, String logoUrl, String displayContent) {
    }

    /**
     * 同意或拒绝后交给浏览器跳转的地址。
     *
     * @param redirectUrl 外部回调地址
     */
    public record AuthorizationDecision(String redirectUrl) {
    }

    /**
     * 浏览器授权入口的处理结果。有跳转地址时重定向，否则展示错误页。
     *
     * @param redirectLocation 绝对跳转地址，错误页时为空
     * @param errorMessage 错误页消息，跳转时为空
     */
    public record AuthorizeOutcome(String redirectLocation, SystemMessage errorMessage) {
    }

    /**
     * 同意或拒绝授权的请求。
     *
     * @param requestId 授权请求标识
     */
    public record AuthorizationActionRequest(@NotBlank(message = "business.oauthAuthorizationRequestIsRequired")
                                             @Size(max = 128, message = "business.oauthAuthorizationRequestIsTooLong") String requestId) {
    }
}
