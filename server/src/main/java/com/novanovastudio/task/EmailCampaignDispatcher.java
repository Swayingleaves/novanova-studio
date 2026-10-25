package com.novanovastudio.task;

import com.novanovastudio.config.EmailCampaignProperties;
import com.novanovastudio.entity.EmailCampaignRecords;
import com.novanovastudio.repository.EmailCampaignRepository;
import com.novanovastudio.service.EmailCampaignContentRenderer;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.NestedExceptionUtils;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.mail.MailAuthenticationException;
import org.springframework.mail.MailParseException;
import org.springframework.mail.MailSendException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * 持久化群发派发器，跨实例串行领取并遵守滚动限额，网络调用不占数据库事务。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-24 16:00
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class EmailCampaignDispatcher {
    /** 群发仓储。 */
    private final EmailCampaignRepository repository;
    /** 全局群发限额。 */
    private final EmailCampaignProperties properties;
    /** 沿用已有邮件发送器及连接超时配置。 */
    private final JavaMailSender mailSender;
    /** 只在领取与记录结果时使用短事务。 */
    private final TransactionalOperator transactionalOperator;
    /** 防止同一实例在慢邮件期间重复订阅调度，实际发送额度仍由数据库控制。 */
    private final AtomicBoolean dispatching = new AtomicBoolean();

    /**
     * 每轮最多处理一封邮件，慢邮件不会阻塞其他业务使用的定时调度线程。
     * @return 本轮派发完成信号
     */
    @Scheduled(fixedRate = 1000, initialDelay = 10000)
    public Mono<Void> dispatch() {
        return Mono.defer(() -> {
            if (!dispatching.compareAndSet(false, true)) return Mono.empty();
            return repository.lockControl(true).flatMap(ignored -> repository.recoverInterrupted()
                        .doOnNext(count -> { if (count > 0) log.error("发现中断的群发邮件，已标记结果不确定且不自动重发: count={}", count); })
                        .then(repository.completeCampaigns())
                        .then(repository.claimNext(properties.getMaximumPerMinute(), properties.getMaximumPerHour(), properties.getMinimumIntervalSeconds())))
                .as(transactionalOperator::transactional)
                .flatMap(this::sendClaimed)
                .onErrorResume(exception -> {
                    log.error("邮件群发调度失败，未完成的领取将在超时后标记为结果不确定", exception);
                    return Mono.empty();
                }).doFinally(signal -> dispatching.set(false));
        });
    }

    /**
     * 已领取邮件只尝试一次，发送成功后的数据库写入失败不能误报为发送失败或触发重发。
     * @param dispatch 已领取的邮件快照
     * @return 结果持久化完成信号
     */
    private Mono<Void> sendClaimed(EmailCampaignRecords.Dispatch dispatch) {
        return repository.listImages(dispatch.campaignId()).collectList()
                .flatMap(images -> Mono.fromCallable(() -> send(dispatch, images)).subscribeOn(Schedulers.boundedElastic()))
                .onErrorResume(exception -> {
                    log.error("群发邮件准备失败: campaignId={}, deliveryId={}", dispatch.campaignId(), dispatch.deliveryId(), exception);
                    return Mono.just(new SendResult("failed", "邮件图片读取失败，未开始发送", false));
                })
                .flatMap(result -> repository.lockControl(false)
                        .then(repository.finishDelivery(dispatch.deliveryId(), result.status(), result.errorMessage()))
                        // 认证失败影响整批发送；与单封失败结果在同一事务内取消剩余收件人，防止其他实例继续领取。
                        .then(result.authenticationFailed() ? repository.cancelCampaign(dispatch.campaignId())
                                .doOnNext(cancelled -> log.error("邮件服务器认证失败，已终止群发任务: campaignId={}, cancelled={}", dispatch.campaignId(), cancelled)).then() : Mono.empty())
                        .then(repository.delayNextSend(dispatch.intervalSeconds())).then(repository.completeCampaigns())
                        .as(transactionalOperator::transactional)
                        .doOnSuccess(ignored -> log.info("群发邮件处理完成: campaignId={}, deliveryId={}, status={}", dispatch.campaignId(), dispatch.deliveryId(), result.status())));
    }

    /**
     * 给单一收件人发送一封包含内嵌图片的邮件。
     * @param dispatch 邮件内容快照
     * @param images 图片快照
     * @return 发送状态，发送结果不明确时禁止自动重试
     */
    private SendResult send(EmailCampaignRecords.Dispatch dispatch, List<EmailCampaignRecords.Image> images) {
        try {
            var message = mailSender.createMimeMessage();
            var helper = new MimeMessageHelper(message, !images.isEmpty(), "UTF-8");
            helper.setFrom(dispatch.fromEmail());
            helper.setTo(dispatch.email());
            helper.setSubject(dispatch.subject());
            helper.setText(EmailCampaignContentRenderer.render(dispatch.bodyHtml()), true);
            for (var image : images) helper.addInline(image.contentId(), new ByteArrayResource(image.data()), image.mimeType());
            mailSender.send(message);
            return new SendResult("sent", null, false);
        } catch (Exception exception) {
            log.error("群发邮件发送异常: campaignId={}, deliveryId={}", dispatch.campaignId(), dispatch.deliveryId(), exception);
            if (exception instanceof MailAuthenticationException
                    || NestedExceptionUtils.getMostSpecificCause(exception) instanceof jakarta.mail.AuthenticationFailedException) {
                return new SendResult("failed", "邮件服务器认证失败，已终止该群发任务并取消剩余邮件，请检查发件账号状态、SMTP服务及授权码后重新创建任务", true);
            }
            // 服务器明确拒收记为失败；连接中断等可能发生于已接收后，必须保留不确定状态。
            if (exception instanceof MailParseException || exception instanceof jakarta.mail.MessagingException) {
                return new SendResult("failed", "邮件地址或内容无效，请检查邮件配置与收件地址", false);
            }
            if (exception instanceof MailSendException mailException && mailException.getFailedMessages().values().stream()
                    .anyMatch(failure -> failure instanceof org.eclipse.angus.mail.smtp.SMTPAddressFailedException
                            || failure instanceof org.eclipse.angus.mail.smtp.SMTPSendFailedException)) {
                return new SendResult("failed", "邮件服务器拒绝接收，请检查收件地址或服务商发送额度", false);
            }
            return new SendResult("unknown", "邮件连接异常，是否已被接收无法确认，请核对邮件服务器记录，系统不会自动重发", false);
        }
    }

    /**
     * @param status 发送结果
     * @param errorMessage 发送异常说明
     * @param authenticationFailed 是否因发件认证失败而需要终止整批任务
     */
    private record SendResult(String status, String errorMessage, boolean authenticationFailed) { }
}
