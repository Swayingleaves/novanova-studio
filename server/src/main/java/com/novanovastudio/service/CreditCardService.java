package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.common.SensitiveDataCrypto;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.CreditCardDtos;
import com.novanovastudio.repository.CreditCardRepository;
import com.novanovastudio.repository.CreditRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.task.AiTaskEventPublisher;
import java.security.SecureRandom;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 积分卡密生成、兑换和查询服务。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-02 12:50
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class CreditCardService {

    /** 卡密字符集，排除容易混淆的字符。 */
    static final String CARD_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    /** 卡密长度。 */
    static final int CARD_CODE_LENGTH = 20;

    /** 卡密格式。 */
    static final Pattern CARD_CODE_PATTERN = Pattern.compile("[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{20}");

    /** 卡密末四位格式。 */
    private static final Pattern CARD_SUFFIX_PATTERN = Pattern.compile("[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}");

    /** 积分查询业务时区。 */
    private static final ZoneId CREDIT_TIME_ZONE = ZoneId.of("Asia/Shanghai");

    /** 时间输出格式。 */
    private static final DateTimeFormatter TIME_FORMATTER = DateTimeFormatter.ISO_OFFSET_DATE_TIME;

    /** 安全随机数。 */
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    /** 卡密仓储。 */
    private final CreditCardRepository creditCardRepository;

    /** 积分仓储。 */
    private final CreditRepository creditRepository;

    /** 当前用户提供器。 */
    private final CurrentUserProvider currentUserProvider;

    /** 响应式事务操作器。 */
    private final TransactionalOperator transactionalOperator;

    /** 用户余额事件发布器。 */
    private final AiTaskEventPublisher eventPublisher;

    /** 应用配置，按需读取稳定的APP_SECRET_KEY。 */
    private final com.novanovastudio.config.NovanovaProperties properties;

    /**
     * 兑换当前用户提交的卡密。
     *
     * @param cardCode String 卡密明文
     * @return Mono<RedeemCreditsResponse> 兑换结果
     */
    public Mono<CreditCardDtos.RedeemCreditsResponse> redeemCredits(String cardCode) {
        String normalizedCode = normalizeCardCode(cardCode);
        validateFullCardCode(normalizedCode);
        String codeHash = SensitiveDataCrypto.sha256Hex(normalizedCode);
        return currentUserProvider.currentUserId().flatMap(userId -> redeemForUser(userId, codeHash));
    }

    /**
     * 查询当前用户的卡密兑换记录。
     *
     * @param startDate LocalDate 起始日期，可为空
     * @param endDate LocalDate 结束日期，可为空
     * @param cardCode String 卡密完整值或末四位，可为空
     * @param page int 页码
     * @param pageSize int 每页数量
     * @return Mono<RedemptionRecordListResponse> 兑换记录
     */
    public Mono<CreditCardDtos.RedemptionRecordListResponse> listRedemptionRecords(LocalDate startDate, LocalDate endDate,
                                                                                    String cardCode, int page, int pageSize) {
        validatePage(page, pageSize);
        DateRange dateRange = dateRange(startDate, endDate);
        CodeFilter codeFilter = codeFilter(cardCode);
        return currentUserProvider.currentUserId().flatMap(userId -> {
            CreditCardRepository.RedemptionQuery query = new CreditCardRepository.RedemptionQuery(userId, dateRange.startAt(), dateRange.endAt(), codeFilter.hash(), codeFilter.suffix());
            return Mono.zip(creditCardRepository.listRedemptions(query, page, pageSize).concatMap(this::redemptionRecord).collectList(), creditCardRepository.countRedemptions(query))
                    .map(result -> new CreditCardDtos.RedemptionRecordListResponse(result.getT1(), result.getT2()));
        });
    }

    /**
     * 管理员批量生成卡密。
     *
     * @param request GenerateCreditCardsRequest 生成参数
     * @return Mono<GenerateCreditCardsResponse> 生成结果
     */
    public Mono<CreditCardDtos.GenerateCreditCardsResponse> generateCreditCards(CreditCardDtos.GenerateCreditCardsRequest request) {
        int quantity = request.quantity() == null ? CreditCardDtos.DEFAULT_QUANTITY : request.quantity();
        int creditsPerCard = request.creditsPerCard() == null ? 0 : request.creditsPerCard();
        validateGeneration(quantity, creditsPerCard);
        List<String> cardCodes = generateUniqueCodes(quantity);
        return currentUserProvider.currentUserId().flatMap(adminUserId -> transactionalOperator.transactional(
                        creditCardRepository.createBatch(quantity, creditsPerCard, adminUserId)
                                .flatMap(batchId -> Flux.fromIterable(cardCodes)
                                        .concatMap(code -> createEncryptedCard(batchId, code, creditsPerCard))
                                        .then(Mono.fromSupplier(() -> new CreditCardDtos.GenerateCreditCardsResponse(batchId, quantity, creditsPerCard, cardCodes, formatTime(OffsetDateTime.now())))))))
                .doOnSuccess(result -> log.info("管理员生成积分卡密批次成功: batchId={}, quantity={}, creditsPerCard={}", result.batchId(), result.quantity(), result.creditsPerCard()));
    }

    /**
     * 查询卡密批次列表。
     *
     * @param page int 页码
     * @param pageSize int 每页数量
     * @return Mono<CreditCardBatchListResponse> 批次列表
     */
    public Mono<CreditCardDtos.CreditCardBatchListResponse> listCreditCardBatches(int page, int pageSize) {
        validatePage(page, pageSize);
        return Mono.zip(creditCardRepository.listBatches(page, pageSize).map(this::batch).collectList(), creditCardRepository.countBatches())
                .map(result -> new CreditCardDtos.CreditCardBatchListResponse(result.getT1(), result.getT2()));
    }

    /**
     * 查询管理员卡密库存。
     *
     * @param batchId Long 批次筛选
     * @param status String 状态筛选
     * @param cardCode String 卡密完整值或末四位
     * @param redeemedUserKeyword String 兑换用户关键词
     * @param includeCode boolean 是否返回卡密明文
     * @param page int 页码
     * @param pageSize int 每页数量
     * @return Mono<CreditCardListResponse> 卡密列表
     */
    public Mono<CreditCardDtos.CreditCardListResponse> listCreditCards(Long batchId, String status, String cardCode,
                                                                       String redeemedUserKeyword, boolean includeCode, int page, int pageSize) {
        validatePage(page, pageSize);
        if (status != null && !Set.of("available", "redeemed").contains(status)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "卡密状态仅支持available或redeemed");
        }
        CodeFilter codeFilter = codeFilter(cardCode);
        String normalizedUserKeyword = StringUtils.hasText(redeemedUserKeyword) ? redeemedUserKeyword.trim().toLowerCase(Locale.ROOT) : null;
        CreditCardRepository.CardListQuery query = new CreditCardRepository.CardListQuery(batchId, status, codeFilter.hash(), codeFilter.suffix(), normalizedUserKeyword);
        return Mono.zip(creditCardRepository.listCards(query, page, pageSize).flatMap(record -> card(record, includeCode)).collectList(), creditCardRepository.countCards(query))
                .map(result -> new CreditCardDtos.CreditCardListResponse(result.getT1(), result.getT2()));
    }

    /**
     * 在事务内完成卡密抢占、余额更新和流水写入。
     *
     * @param userId Long 兑换用户ID
     * @param codeHash String 卡密摘要
     * @return Mono<RedeemCreditsResponse> 兑换结果
     */
    private Mono<CreditCardDtos.RedeemCreditsResponse> redeemForUser(Long userId, String codeHash) {
        return transactionalOperator.transactional(
                        creditCardRepository.claimUnredeemedCard(codeHash, userId)
                                .switchIfEmpty(Mono.defer(() -> creditCardRepository.findCardStatus(codeHash)
                                        .flatMap(status -> Mono.<CreditCardRepository.ClaimedCard>error(new BusinessException(ErrorCode.BUSINESS_ERROR, "卡密已兑换")))
                                        .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "卡密不存在或格式不正确")))))
                                .flatMap(card -> creditRepository.changeBalance(userId, card.credits())
                                        .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "积分账户不存在，无法兑换卡密")))
                                        .flatMap(balance -> creditRepository.createCardRedeemTransaction(userId, card.id(), card.credits(), balance, "兑换积分卡密")
                                                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.SYSTEM_ERROR, "积分兑换流水写入失败")))
                                                .map(transactionId -> new CreditCardDtos.RedeemCreditsResponse(card.id(), card.codeMasked(), card.credits(), balance, formatTime(card.redeemedAt()))))))
                .flatMap(response -> eventPublisher.publish(userId, new AiTaskDtos.AiTaskEvent("credit-balance", null, null, response.creditBalance()))
                        .thenReturn(response))
                .doOnSuccess(response -> log.info("用户兑换积分卡密成功: userId={}, cardId={}, credits={}", userId, response.cardId(), response.credits()));
    }

    /**
     * 加密并写入单张卡密。
     *
     * @param batchId Long 批次ID
     * @param code String 卡密明文
     * @param credits int 单卡积分
     * @return Mono<Void> 写入结果
     */
    private Mono<Void> createEncryptedCard(Long batchId, String code, int credits) {
        return Mono.fromCallable(() -> SensitiveDataCrypto.encrypt(code, properties.getApp().getSecretKey()))
                .flatMap(encrypted -> creditCardRepository.createCard(batchId, SensitiveDataCrypto.sha256Hex(code), encrypted, maskCardCode(code), code.substring(code.length() - 4), credits));
    }

    /**
     * 生成指定数量的唯一卡密。
     *
     * @param quantity int 生成数量
     * @return List<String> 卡密明文列表
     */
    static List<String> generateUniqueCodes(int quantity) {
        Set<String> uniqueCodes = new HashSet<>(quantity * 2);
        while (uniqueCodes.size() < quantity) {
            StringBuilder code = new StringBuilder(CARD_CODE_LENGTH);
            for (int index = 0; index < CARD_CODE_LENGTH; index++) {
                code.append(CARD_CODE_ALPHABET.charAt(SECURE_RANDOM.nextInt(CARD_CODE_ALPHABET.length())));
            }
            uniqueCodes.add(code.toString());
        }
        return new ArrayList<>(uniqueCodes);
    }

    /**
     * 校验卡密生成参数。
     *
     * @param quantity int 生成数量
     * @param creditsPerCard int 单卡积分
     */
    static void validateGeneration(int quantity, int creditsPerCard) {
        if (quantity < 1 || quantity > CreditCardDtos.MAX_QUANTITY) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "生成数量必须在1到1000之间");
        }
        if (creditsPerCard < 1) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "单卡积分必须为正整数");
        }
    }

    /**
     * 规范化卡密输入。
     *
     * @param cardCode String 原始卡密
     * @return String 去除空白和分隔符后的大写卡密
     */
    static String normalizeCardCode(String cardCode) {
        if (!StringUtils.hasText(cardCode)) {
            throw new BusinessException(ErrorCode.PARAM_MISSING, "卡密不能为空");
        }
        return cardCode.replaceAll("[\\s-]", "").toUpperCase(Locale.ROOT);
    }

    /**
     * 校验完整卡密格式。
     *
     * @param cardCode String 规范化卡密
     */
    static void validateFullCardCode(String cardCode) {
        if (!CARD_CODE_PATTERN.matcher(cardCode).matches()) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "卡密必须为20位大写字符或数字");
        }
    }

    /**
     * 将卡密转换为脱敏展示值。
     *
     * @param cardCode String 规范化卡密
     * @return String 脱敏卡密
     */
    static String maskCardCode(String cardCode) {
        validateFullCardCode(cardCode);
        return "****-****-****-****-" + cardCode.substring(cardCode.length() - 4);
    }

    /**
     * 解析卡密查询条件。
     *
     * @param cardCode String 完整卡密或末四位
     * @return CodeFilter 查询摘要
     */
    private CodeFilter codeFilter(String cardCode) {
        if (!StringUtils.hasText(cardCode)) return new CodeFilter(null, null);
        String normalized = normalizeCardCode(cardCode);
        if (normalized.length() == CARD_CODE_LENGTH) {
            validateFullCardCode(normalized);
            return new CodeFilter(SensitiveDataCrypto.sha256Hex(normalized), null);
        }
        if (normalized.length() == 4 && CARD_SUFFIX_PATTERN.matcher(normalized).matches()) {
            return new CodeFilter(null, normalized);
        }
        throw new BusinessException(ErrorCode.PARAM_INVALID, "卡密查询请输入完整卡密或末四位");
    }

    /**
     * 校验分页参数。
     *
     * @param page int 页码
     * @param pageSize int 每页数量
     */
    private void validatePage(int page, int pageSize) {
        if (page < 1 || pageSize < 1 || pageSize > 100) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "分页参数不合法");
        }
    }

    /**
     * 构造日期范围，结束日期按上海时区次日零点处理。
     *
     * @param startDate LocalDate 起始日期
     * @param endDate LocalDate 结束日期
     * @return DateRange 时间范围
     */
    private DateRange dateRange(LocalDate startDate, LocalDate endDate) {
        LocalDate resolvedEndDate = endDate == null ? LocalDate.now(CREDIT_TIME_ZONE) : endDate;
        LocalDate resolvedStartDate = startDate == null ? resolvedEndDate.minusDays(29) : startDate;
        if (resolvedStartDate.isAfter(resolvedEndDate)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "兑换记录筛选日期不合法");
        }
        return new DateRange(resolvedStartDate.atStartOfDay(CREDIT_TIME_ZONE).toOffsetDateTime(), resolvedEndDate.plusDays(1).atStartOfDay(CREDIT_TIME_ZONE).toOffsetDateTime());
    }

    /**
     * 转换批次响应。
     *
     * @param record BatchRecord 批次记录
     * @return CreditCardBatch 批次响应
     */
    private CreditCardDtos.CreditCardBatch batch(CreditCardRepository.BatchRecord record) {
        int redeemedCount = record.redeemedCount() == null ? 0 : record.redeemedCount().intValue();
        return new CreditCardDtos.CreditCardBatch(record.id(), record.quantity(), record.creditsPerCard(), redeemedCount,
                record.quantity() - redeemedCount, record.createdByUserId(), firstNonEmpty(record.createdByNickname(), record.createdByUsername()), record.createdByEmail(), formatTime(record.createdAt()));
    }

    /**
     * 转换管理员卡密响应，并按需解密明文。
     *
     * @param record CardRecord 卡密记录
     * @param includeCode 是否返回明文
     * @return Mono<CreditCard> 卡密响应
     */
    private Mono<CreditCardDtos.CreditCard> card(CreditCardRepository.CardRecord record, boolean includeCode) {
        Mono<String> code = includeCode
                ? Mono.fromCallable(() -> SensitiveDataCrypto.decrypt(record.codeEncrypted(), properties.getApp().getSecretKey()))
                : Mono.justOrEmpty((String) null);
        return code.map(value -> cardResponse(record, value)).switchIfEmpty(Mono.fromSupplier(() -> cardResponse(record, null)));
    }

    /**
     * 构造管理员卡密响应。
     *
     * @param record CardRecord 卡密记录
     * @param code String 明文卡密
     * @return CreditCard 卡密响应
     */
    private CreditCardDtos.CreditCard cardResponse(CreditCardRepository.CardRecord record, String code) {
        String status = record.redeemedAt() == null ? "available" : "redeemed";
        return new CreditCardDtos.CreditCard(record.id(), record.batchId(), code, record.codeMasked(), record.codeSuffix(), record.credits(), status,
                record.redeemedByUserId(), record.redeemedByUsername(), record.redeemedByNickname(), record.redeemedByEmail(), formatTime(record.redeemedAt()),
                formatTime(record.createdAt()), record.transactionId(), record.balanceAfter());
    }

    /**
     * 转换用户兑换记录。
     *
     * @param record RedemptionRecord 记录
     * @return Mono<RedemptionRecord> 解密卡密后的记录响应
     */
    private Mono<CreditCardDtos.RedemptionRecord> redemptionRecord(CreditCardRepository.RedemptionRecord record) {
        return Mono.fromCallable(() -> SensitiveDataCrypto.decrypt(record.codeEncrypted(), properties.getApp().getSecretKey()))
                .map(cardCode -> new CreditCardDtos.RedemptionRecord(record.id(), record.transactionId(), cardCode, record.codeMasked(), record.codeSuffix(), record.credits(), record.balanceAfter(), formatTime(record.redeemedAt())));
    }

    /**
     * 格式化时间。
     *
     * @param value OffsetDateTime 时间
     * @return String ISO时间
     */
    private String formatTime(OffsetDateTime value) {
        return value == null ? "" : value.format(TIME_FORMATTER);
    }

    /**
     * 返回第一个有内容的名称。
     *
     * @param values String[] 候选名称
     * @return String 名称
     */
    private String firstNonEmpty(String... values) {
        for (String value : values) {
            if (StringUtils.hasText(value)) return value;
        }
        return "未命名管理员";
    }

    /** 卡密摘要筛选。 */
    private record CodeFilter(String hash, String suffix) {
    }

    /** 日期筛选范围。 */
    private record DateRange(OffsetDateTime startAt, OffsetDateTime endAt) {
    }
}
