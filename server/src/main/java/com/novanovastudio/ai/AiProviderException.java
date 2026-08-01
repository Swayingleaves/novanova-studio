package com.novanovastudio.ai;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;

/**
 * 携带供应商结构化错误详情的业务异常。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-01 00:00
 */
public class AiProviderException extends BusinessException {

    /** 结构化错误详情 */
    private final AiErrorDetails details;

    /**
     * 创建AI供应商异常。
     *
     * @param details AiErrorDetails 结构化错误详情
     */
    public AiProviderException(AiErrorDetails details) {
        super(ErrorCode.THIRD_PARTY_CALL_ERROR, details.message());
        this.details = details;
    }

    /**
     * 获取结构化错误详情。
     *
     * @return AiErrorDetails 错误详情
     */
    public AiErrorDetails getDetails() {
        return details;
    }
}
