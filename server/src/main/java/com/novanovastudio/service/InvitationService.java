package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.InvitationDtos;
import com.novanovastudio.repository.InvitationRepository;
import com.novanovastudio.security.CurrentUserProvider;
import java.security.SecureRandom;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;

/**
 * 邀请码校验与邀请信息服务。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-09 00:00
 */
@Service
@RequiredArgsConstructor
public class InvitationService {

    /** 邀请码字符表，排除易混淆字符 */
    private static final char[] INVITATION_CODE_CHARACTERS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ".toCharArray();

    /** 邀请码长度 */
    private static final int INVITATION_CODE_LENGTH = 16;

    /** 安全随机数生成器 */
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    /** 邀请仓储 */
    private final InvitationRepository invitationRepository;

    /** 当前用户提供器 */
    private final CurrentUserProvider currentUserProvider;

    /**
     * 生成不包含用户身份信息的安全随机邀请码。
     *
     * @return 十六位邀请码
     */
    public String generateInvitationCode() {
        char[] code = new char[INVITATION_CODE_LENGTH];
        for (int index = 0; index < code.length; index++) {
            code[index] = INVITATION_CODE_CHARACTERS[SECURE_RANDOM.nextInt(INVITATION_CODE_CHARACTERS.length)];
        }
        return new String(code);
    }

    /**
     * 校验邀请码并返回邀请人用户ID。
     *
     * @param invitationCode 可选邀请码
     * @return 邀请人用户ID，未提供邀请码时为空
     * @throws BusinessException 邀请码无效时抛出
     */
    public Mono<Long> resolveInviterUserId(String invitationCode) {
        if (!StringUtils.hasText(invitationCode)) {
            return Mono.empty();
        }
        String normalizedCode = invitationCode.trim().toUpperCase();
        return invitationRepository.findInviterUserId(normalizedCode)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "邀请码无效")));
    }

    /**
     * 查询当前用户的邀请码。
     *
     * @return 当前用户邀请信息
     */
    public Mono<InvitationDtos.InvitationInfoResponse> getInvitationInfo() {
        return currentUserProvider.currentUserId()
                .flatMap(invitationRepository::findInvitationCode)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "用户不存在")))
                .map(InvitationDtos.InvitationInfoResponse::new);
    }
}

