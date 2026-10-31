package com.novanovastudio.payment;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/**
 * 支付提供方注册表，根据支付方式选择具体实现。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-10-27 14:30
 */
@Component
public class PaymentProviderRegistry {

    /** 支付方式到提供方的映射。 */
    private final Map<String, PaymentProvider> providers;

    /**
     * 创建支付提供方注册表。
     *
     * @param providers List<PaymentProvider> 已注册的支付提供方
     */
    public PaymentProviderRegistry(List<PaymentProvider> providers) {
        this.providers = providers.stream().collect(Collectors.toUnmodifiableMap(PaymentProvider::method, Function.identity()));
    }

    /**
     * 获取指定支付方式的提供方。
     *
     * @param method String 支付方式
     * @return PaymentProvider 支付提供方
     */
    public PaymentProvider require(String method) {
        PaymentProvider provider = providers.get(method);
        if (provider == null) throw new BusinessException(ErrorCode.PARAM_INVALID, "暂不支持该支付方式");
        return provider;
    }
}
