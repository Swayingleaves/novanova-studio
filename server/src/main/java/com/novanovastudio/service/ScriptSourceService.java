package com.novanovastudio.service;

import com.novanovastudio.service.TeamTaskScopeService;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.ScriptSourceDtos;
import com.novanovastudio.repository.ScriptSourceRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.storage.ObjectStorageService;
import com.novanovastudio.task.ScriptSourceImportQueue;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.core.io.buffer.DataBufferUtils;
import org.springframework.http.codec.multipart.FilePart;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import org.springframework.util.StringUtils;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * 剧本与小说原文导入、解析进度与人工校对业务服务。
 *
 * <p>原文与正式剧本数据分离保存：导入阶段只写原文层，校对只调整结构投影，
 * 原文件在对象存储中保持不可变。</p>
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-09-26 00:00
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ScriptSourceService {

    /** 持久化任务的团队作用域恢复。 */
    private final TeamTaskScopeService teamTaskScopeService;

    /** 原文实际存储计量。 */
    private final StorageBillingService storageBillingService;

    /** 沿用现有上传上限。 */
    private static final long MAX_FILE_BYTES = 50L * 1024 * 1024;

    /** 支持导入的文件扩展名。 */
    private static final Set<String> SUPPORTED_EXTENSIONS = Set.of("txt", "docx", "doc");

    /** 文本文件支持的明确编码。 */
    private static final Set<String> SUPPORTED_ENCODINGS = Set.of("UTF-8", "GB18030");

    /** 支持的内容形式。 */
    private static final Set<String> SUPPORTED_CONTENT_TYPES = Set.of(
            "comicDrama", "liveActionShort", "animation", "advertisement", "musicVideo", "storyShort");

    /** 项目名称最大字符数。 */
    private static final int MAX_TITLE_LENGTH = 120;

    /** 原始文件名最大字符数。 */
    private static final int MAX_FILE_NAME_LENGTH = 255;

    /** 结构段标题最大字符数。 */
    private static final int MAX_SECTION_TITLE_LENGTH = 255;

    /** 失败原因最大字符数。 */
    private static final int MAX_ERROR_LENGTH = 500;

    /** 导入任务执行租约秒数，执行中定期续期，过期后由恢复扫描重新抢占。 */
    public static final int TASK_LEASE_SECONDS = 180;

    /** 原文仓储。 */
    private final ScriptSourceRepository repository;

    /** 原文解析器。 */
    private final ScriptSourceParser parser;

    /** 对象存储与持久化服务。 */
    private final PersistenceService persistenceService;

    /** 对象存储服务。 */
    private final ObjectStorageService objectStorageService;

    /** 导入队列，延迟获取以避开服务与队列的构造期依赖环。 */
    private final ObjectProvider<ScriptSourceImportQueue> queueProvider;

    /** 当前用户提供器。 */
    private final CurrentUserProvider currentUserProvider;

    /** 响应式事务操作器。 */
    private final TransactionalOperator transactionalOperator;

    /**
     * 上传原文文件并创建空白剧本项目。
     *
     * @param file FilePart 上传文件
     * @param sourceType String 小说或剧本
     * @param contentType String 内容形式
     * @param title String 项目名称
     * @param encoding String TXT编码
     * @param clientRequestId String 客户端幂等请求标识
     * @return Mono&lt;UploadResult&gt; 项目、原文和任务标识
     */
    public Mono<ScriptSourceDtos.UploadResult> upload(FilePart file, String sourceType, String contentType,
                                                      String title, String encoding, String clientRequestId) {
        return currentUserProvider.currentUserId().flatMap(userId -> {
            String requestId = trimToNull(clientRequestId);
            if (requestId == null || requestId.length() > 64) {
                return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "客户端请求标识不合法"));
            }
            String fileName = trimToNull(file.filename());
            if (fileName == null) {
                return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "请选择要导入的文件"));
            }
            if (fileName.length() > MAX_FILE_NAME_LENGTH) {
                fileName = fileName.substring(fileName.length() - MAX_FILE_NAME_LENGTH);
            }
            String extension = extensionOf(fileName);
            if (!SUPPORTED_EXTENSIONS.contains(extension)) {
                return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "仅支持TXT、DOCX和DOC文件"));
            }
            String normalizedType = normalizeSourceType(sourceType);
            String normalizedEncoding = normalizeEncoding(extension, encoding);
            String projectTitle = projectTitle(title, fileName);
            String projectContentType = normalizeContentType(contentType);
            String importedFileName = fileName;
            // 同一客户端请求标识直接返回已创建的项目，避免重复创建剧本项目与重复上传。
            return repository.findByRequest(userId, requestId)
                    .flatMap(existing -> repository.findTaskId(existing.id())
                            .map(taskId -> new ScriptSourceDtos.UploadResult(existing.projectId(), existing.id(), taskId)))
                    .switchIfEmpty(Mono.defer(() -> createImport(file, userId, requestId, normalizedType, projectContentType,
                            extension, normalizedEncoding, projectTitle, importedFileName)));
        }).subscribeOn(Schedulers.boundedElastic());
    }

    /**
     * 查询原文导入进度。
     *
     * @param projectId String 项目标识
     * @return Mono&lt;ImportStatus&gt; 导入进度
     */
    public Mono<ScriptSourceDtos.ImportStatus> status(String projectId) {
        return document(projectId).flatMap(repository::status);
    }

    /**
     * 重新排队失败的导入任务，可在编码不匹配时重新指定TXT编码。
     *
     * @param request RetryRequest 重试请求
     * @return Mono&lt;ImportStatus&gt; 重试后的导入进度
     */
    public Mono<ScriptSourceDtos.ImportStatus> retry(ScriptSourceDtos.RetryRequest request) {
        return document(request.projectId()).flatMap(document -> {
            String encoding = trimToNull(request.encoding());
            // 先以失败状态抢占重试，再清理结构，避免已完成或执行中的原文被误删；编码更换需丢弃旧结构与检查点。
            Mono<Void> updateEncoding = encoding == null ? Mono.empty()
                    : repository.resetParsedStructure(document.id())
                            .then(repository.updateEncoding(document.id(), normalizeEncoding(document.fileExtension(), encoding)));
            return transactionalOperator.transactional(repository.retry(document.id())
                            .flatMap(retried -> retried ? updateEncoding.thenReturn(true) : Mono.just(false)))
                    .flatMap(retried -> retried
                            ? repository.findTaskId(document.id())
                                    .flatMap(taskId -> enqueue(taskId).then(document(request.projectId())).flatMap(repository::status))
                            : Mono.<ScriptSourceDtos.ImportStatus>error(new BusinessException(ErrorCode.BUSINESS_ERROR, "仅失败的导入任务可以重试")));
        });
    }

    /**
     * 确认当前原文结构修订，确认后才允许启动故事知识库分析。
     *
     * @param request ConfirmStructureRequest 确认请求
     * @return Mono&lt;ImportStatus&gt; 确认后的导入进度
     */
    public Mono<ScriptSourceDtos.ImportStatus> confirmStructure(ScriptSourceDtos.ConfirmStructureRequest request) {
        return document(request.projectId()).flatMap(document -> {
            if (!"completed".equals(document.status())) {
                return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "原文尚未解析完成，暂不能确认结构"));
            }
            return repository.confirmStructure(document.id(), request.expectedRevision())
                    .flatMap(confirmed -> confirmed
                            ? document(request.projectId()).flatMap(repository::status)
                            : Mono.<ScriptSourceDtos.ImportStatus>error(new BusinessException(ErrorCode.DATA_CONFLICT, "原文结构已被其他页面修改，请刷新后重新确认")));
        });
    }

    /**
     * 读取原文目录。
     *
     * @param projectId String 项目标识
     * @return Mono&lt;SourceTree&gt; 原文目录
     */
    public Mono<ScriptSourceDtos.SourceTree> tree(String projectId) {
        return document(projectId).flatMap(document -> repository.listSections(document.id()).collectList()
                .map(sections -> new ScriptSourceDtos.SourceTree(document.id(), document.sourceType(), document.fileName(),
                        document.revision(), document.confirmedRevision(), document.warning(), sections)));
    }

    /**
     * 按需读取结构段正文。
     *
     * @param request SectionRequest 结构段查询请求
     * @return Mono&lt;SectionDetail&gt; 结构段与正文
     */
    public Mono<ScriptSourceDtos.SectionDetail> section(ScriptSourceDtos.SectionRequest request) {
        return document(request.projectId()).flatMap(document -> requireSection(document.id(), request.sectionId())
                .flatMap(section -> repository.sectionText(document.id(), section)
                        .map(content -> new ScriptSourceDtos.SectionDetail(section, content, document.revision()))));
    }

    /**
     * 修改结构段标题。
     *
     * @param request RenameRequest 改名请求
     * @return Mono&lt;MutationResult&gt; 校对完成后的修订号
     */
    public Mono<ScriptSourceDtos.MutationResult> rename(ScriptSourceDtos.RenameRequest request) {
        String title = sectionTitle(request.title());
        return transactionalOperator.transactional(beginMutation(request.projectId(), request.expectedRevision(), false)
                .flatMap(mutation -> requireSection(mutation.document().id(), request.sectionId())
                        .flatMap(section -> repository.rename(section.id(), title))
                        .thenReturn(new ScriptSourceDtos.MutationResult(mutation.revision()))));
    }

    /**
     * 在段落边界把结构段拆成两段。
     *
     * @param request SplitRequest 拆分请求
     * @return Mono&lt;MutationResult&gt; 校对完成后的修订号
     */
    public Mono<ScriptSourceDtos.MutationResult> split(ScriptSourceDtos.SplitRequest request) {
        String title = sectionTitle(request.title());
        return transactionalOperator.transactional(beginMutation(request.projectId(), request.expectedRevision(), true)
                .flatMap(mutation -> requireSection(mutation.document().id(), request.sectionId())
                        .flatMap(section -> {
                            String documentId = mutation.document().id();
                            int boundary = alignParagraphBoundary(mutation.text(), section.startOffset(),
                                    request.splitOffset(), section.endOffset());
                            if (boundary <= section.startOffset() || boundary >= section.endOffset()) {
                                return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "拆分位置必须落在当前结构段内部"));
                            }
                            String createdId = UUID.randomUUID().toString();
                            ScriptSourceDtos.Section created = new ScriptSourceDtos.Section(createdId, section.parentId(),
                                    section.sectionType(), title, boundary, section.endOffset(), section.sortOrder() + 1, false);
                            // 片段只归属顶层章节或场次；拆分子场景不改变所在章节范围，无需重建片段。
                            Mono<Void> rebuild = section.parentId() == null
                                    ? writeChunks(documentId, mutation.text(), section.id(), section.startOffset(), boundary)
                                            .then(writeChunks(documentId, mutation.text(), createdId, boundary, section.endOffset()))
                                    : Mono.<Void>empty();
                            // 跨越拆分点的子场景同样在拆分点切开，保证子场景范围不超出所属章节。
                            Mono<Void> splitChild = repository.straddlingChild(section.id(), boundary)
                                    .flatMap(child -> repository.updateEnd(child.id(), boundary)
                                            .then(repository.insertSection(documentId, new ScriptSourceDtos.Section(
                                                    UUID.randomUUID().toString(), createdId, child.sectionType(), child.title(),
                                                    boundary, child.endOffset(), 0, child.needsReview()))));
                            return repository.updateEnd(section.id(), boundary)
                                    .then(repository.shiftSiblingOrders(documentId, section.parentId(), section.sortOrder() + 1, 1))
                                    .then(repository.insertSection(documentId, created))
                                    .then(repository.moveChildren(section.id(), createdId, boundary))
                                    .then(splitChild)
                                    .then(repository.renumberChildren(createdId))
                                    .then(rebuild);
                        })
                        .thenReturn(new ScriptSourceDtos.MutationResult(mutation.revision()))));
    }

    /**
     * 合并相邻同级结构段。
     *
     * @param request MergeRequest 合并请求
     * @return Mono&lt;MutationResult&gt; 校对完成后的修订号
     */
    public Mono<ScriptSourceDtos.MutationResult> merge(ScriptSourceDtos.MergeRequest request) {
        return transactionalOperator.transactional(beginMutation(request.projectId(), request.expectedRevision(), true)
                .flatMap(mutation -> {
                    String documentId = mutation.document().id();
                    return requireSection(documentId, request.firstSectionId())
                            .flatMap(first -> requireSection(documentId, request.secondSectionId())
                                    .flatMap(second -> mergeSections(documentId, mutation.text(), first, second)))
                            .thenReturn(new ScriptSourceDtos.MutationResult(mutation.revision()));
                }));
    }

    /**
     * 解析并持久化原文结构，可由队列重复投递。
     *
     * @param taskId String 导入任务标识
     * @return Mono&lt;Void&gt; 处理结果
     */
    public Mono<Void> process(String taskId) {
        return teamTaskScopeService.execute("script_source_import_tasks", taskId, () -> processInTeam(taskId));
    }

    /**
     * 在原任务空间内执行业务，保留现有错误收尾与退款。
     * @param taskId 任务标识
     * @return 执行完成信号
     */
    private Mono<Void> processInTeam(String taskId) {
        return repository.claim(taskId, TASK_LEASE_SECONDS)
                .flatMap(claimed -> {
                    if (!claimed) {
                        return Mono.<Void>empty();
                    }
                    // 执行期间持续续租，进程异常退出后租约过期即可被恢复扫描重新抢占。
                    Disposable renewal = Flux.interval(Duration.ofSeconds(TASK_LEASE_SECONDS / 3))
                            .concatMap(ignored -> repository.renewLease(taskId, TASK_LEASE_SECONDS))
                            .subscribe(ignored -> { }, error -> log.error("原文导入任务续租失败: taskId={}", taskId, error));
                    return repository.findByTask(taskId).flatMap(this::runImport).doFinally(signal -> renewal.dispose());
                })
                .subscribeOn(Schedulers.boundedElastic())
                .then();
    }

    /**
     * 创建原文记录、任务与空白剧本项目。
     *
     * @param file FilePart 上传文件
     * @param userId long 用户标识
     * @param requestId String 幂等请求标识
     * @param sourceType String 原文类型
     * @param contentType String 内容形式
     * @param extension String 扩展名
     * @param encoding String TXT编码
     * @param projectTitle String 项目名称
     * @param fileName String 原始文件名
     * @return Mono&lt;UploadResult&gt; 上传结果
     */
    private Mono<ScriptSourceDtos.UploadResult> createImport(FilePart file, long userId, String requestId, String sourceType,
                                                             String contentType, String extension, String encoding,
                                                             String projectTitle, String fileName) {
        String documentId = UUID.randomUUID().toString();
        String projectId = UUID.randomUUID().toString();
        String taskId = UUID.randomUUID().toString();
        Path staged;
        try {
            // 上传先落磁盘暂存，避免超限文件被聚合进内存。
            staged = Files.createTempFile("script-source-upload-", "." + extension);
        } catch (IOException exception) {
            return Mono.error(new BusinessException(ErrorCode.SYSTEM_ERROR, "无法暂存上传文件，请重试"));
        }
        return DataBufferUtils.write(file.content(), staged, StandardOpenOption.CREATE,
                        StandardOpenOption.WRITE, StandardOpenOption.TRUNCATE_EXISTING)
                .then(Mono.fromCallable(() -> stagedFileSize(staged)))
                .flatMap(bytes -> storeOriginal(userId, documentId, extension, staged, bytes))
                .flatMap(prepared -> transactionalOperator.transactional(
                                repository.createProject(projectId, userId, projectTitle, contentType)
                                        .then(repository.create(new ScriptSourceRepository.Document(documentId, projectId, userId,
                                                        sourceType, fileName, extension, encoding, prepared.storageId(),
                                                        prepared.objectKey(), "", 0, null, "queued", ""),
                                                requestId, prepared.sha256(), prepared.bytes(), taskId)))
                        // 数据库创建失败时清理已写入的对象存储文件，避免留下孤儿对象。
                        .onErrorResume(error -> deleteStoredObject(prepared).then(Mono.error(error)))
                        .then(enqueue(taskId))
                        .thenReturn(new ScriptSourceDtos.UploadResult(projectId, documentId, taskId)))
                .doFinally(signal -> deleteQuietly(staged));
    }

    /**
     * 校验私有存储并把暂存文件写入对象存储。
     *
     * @param userId long 用户标识
     * @param documentId String 原文标识
     * @param extension String 扩展名
     * @param staged Path 暂存文件
     * @param bytes long 文件字节数
     * @return Mono&lt;Prepared&gt; 私有存储结果
     */
    private Mono<Prepared> storeOriginal(long userId, String documentId, String extension, Path staged, long bytes) {
        return storageBillingService.requireWritable(userId).then(persistenceService.getPlatformObjectStorageConfig().flatMap(config -> Mono.fromCallable(() -> {
            // 假设默认桶保持私有；一旦匿名可读立即中止导入，避免原文泄漏。
            if (!objectStorageService.verifyPrivateBucket(config)) {
                throw new BusinessException(ErrorCode.BUSINESS_ERROR, "当前默认对象存储桶允许匿名读取，已停止导入原文，请联系管理员修正存储权限");
            }
            String objectKey = "script-source/" + userId + "/" + documentId + "/original." + extension;
            objectStorageService.putPrivateObject(config, objectKey, staged);
            return new Prepared(config.id(), objectKey, sha256(staged), bytes);
        }).flatMap(prepared -> storageBillingService.registerObject(config.id(), prepared.objectKey(), bytes).thenReturn(prepared))));
    }

    /**
     * 下载原文件并解析出规范化正文与结构。
     *
     * @param document Document 原文记录
     * @param temp Path 暂存路径
     * @return Mono&lt;ParsedSource&gt; 解析结果
     */
    private Mono<ScriptSourceParser.ParsedSource> downloadAndParse(ScriptSourceRepository.Document document, Path temp) {
        return persistenceService.getPlatformObjectStorageConfig(document.storageConfigId())
                .map(config -> {
                    objectStorageService.downloadPrivateObject(config, document.objectKey(), temp);
                    return parser.parse(temp, document.fileExtension(), document.textEncoding(), document.sourceType());
                });
    }

    /**
     * 执行一次导入并记录失败原因。
     *
     * @param document Document 原文记录
     * @return Mono&lt;Void&gt; 执行结果
     */
    private Mono<Void> runImport(ScriptSourceRepository.Document document) {
        Path temp = null;
        try {
            temp = Files.createTempFile("script-source-parse-", "." + document.fileExtension());
        } catch (IOException exception) {
            return repository.fail(document.id(), "无法创建解析暂存文件");
        }
        Path staged = temp;
        return teamTaskScopeService.requireCurrentActive().then(downloadAndParse(document, staged))
                .flatMap(parsed -> persist(document, parsed))
                .onErrorResume(error -> {
                    log.error("原文解析失败: documentId={}", document.id(), error);
                    return repository.fail(document.id(), errorMessage(error));
                })
                .doFinally(signal -> deleteQuietly(staged));
    }

    /**
     * 分批持久化结构段与片段，并按检查点续跑。
     *
     * @param document Document 原文记录
     * @param parsed ParsedSource 解析结果
     * @return Mono&lt;Void&gt; 持久化结果
     */
    private Mono<Void> persist(ScriptSourceRepository.Document document, ScriptSourceParser.ParsedSource parsed) {
        String documentId = document.id();
        List<ScriptSourceParser.ParsedSection> sections = parsed.sections();
        List<Integer> topLevelIndexes = new ArrayList<>();
        for (int index = 0; index < sections.size(); index++) {
            if (sections.get(index).parentIndex() < 0) {
                topLevelIndexes.add(index);
            }
        }
        List<ScriptSourceDtos.Section> inserts = sectionInserts(documentId, sections);
        return repository.processedSections(documentId).defaultIfEmpty(0).flatMap(processed ->
                (processed == 0
                        ? repository.saveParsedText(documentId, parsed.text(), parsed.warning(), topLevelIndexes.size())
                        : Mono.<Void>empty())
                        .thenMany(Flux.fromIterable(inserts))
                        .concatMap(section -> repository.insertSection(documentId, section))
                        .then(persistChunks(documentId, parsed.text(), sections, topLevelIndexes, processed))
                        .then(repository.complete(documentId)));
    }

    /**
     * 从检查点开始逐段写入片段，避免服务重启后重复解析全部内容。
     *
     * @param documentId String 原文标识
     * @param text String 规范化正文
     * @param sections List&lt;ParsedSection&gt; 解析出的结构段
     * @param topLevelIndexes List&lt;Integer&gt; 顶层结构段下标
     * @param processed int 已完成顶层结构段数
     * @return Mono&lt;Void&gt; 写入结果
     */
    private Mono<Void> persistChunks(String documentId, String text, List<ScriptSourceParser.ParsedSection> sections,
                                     List<Integer> topLevelIndexes, int processed) {
        int resumeFrom = Math.min(Math.max(processed, 0), topLevelIndexes.size());
        return Flux.range(resumeFrom, topLevelIndexes.size() - resumeFrom)
                .concatMap(position -> {
                    int sectionIndex = topLevelIndexes.get(position);
                    ScriptSourceParser.ParsedSection section = sections.get(sectionIndex);
                    // 片段按顶层章节或场次落库，子场景正文由范围查询覆盖。
                    return writeChunks(documentId, text, sectionIdOf(documentId, sectionIndex),
                            section.startOffset(), section.endOffset())
                            .then(repository.checkpoint(documentId, position + 1));
                })
                .then();
    }

    /**
     * 按段落边界重建指定范围的片段。
     *
     * @param documentId String 原文标识
     * @param text String 规范化正文
     * @param sectionId String 结构段标识
     * @param start int 起点，包含
     * @param end int 终点，不包含
     * @return Mono&lt;Void&gt; 写入结果
     */
    private Mono<Void> writeChunks(String documentId, String text, String sectionId, int start, int end) {
        List<ScriptSourceParser.ParsedChunk> chunks = parser.chunks(text, start, end);
        return repository.deleteChunks(sectionId)
                .thenMany(Flux.range(0, chunks.size()).concatMap(index -> {
                    ScriptSourceParser.ParsedChunk chunk = chunks.get(index);
                    return repository.insertChunk(documentId, sectionId, index, chunk.startOffset(), chunk.endOffset(),
                            text.substring(chunk.startOffset(), chunk.endOffset()));
                }))
                .then();
    }

    /**
     * 构造结构段写入对象，标识由原文标识和下标推导以保证重复解析幂等。
     *
     * @param documentId String 原文标识
     * @param sections List&lt;ParsedSection&gt; 解析出的结构段
     * @return List&lt;Section&gt; 待写入结构段
     */
    private List<ScriptSourceDtos.Section> sectionInserts(String documentId, List<ScriptSourceParser.ParsedSection> sections) {
        List<ScriptSourceDtos.Section> result = new ArrayList<>(sections.size());
        Map<Integer, Integer> siblingOrders = new HashMap<>();
        for (int index = 0; index < sections.size(); index++) {
            ScriptSourceParser.ParsedSection section = sections.get(index);
            int order = siblingOrders.merge(section.parentIndex(), 0, (current, ignored) -> current + 1);
            String parentId = section.parentIndex() < 0 ? null : sectionIdOf(documentId, section.parentIndex());
            result.add(new ScriptSourceDtos.Section(sectionIdOf(documentId, index), parentId, section.sectionType(),
                    section.title(), section.startOffset(), section.endOffset(), order, section.needsReview()));
        }
        return result;
    }

    /**
     * 合并两个相邻同级结构段。
     *
     * @param documentId String 原文标识
     * @param text String 规范化正文
     * @param first Section 第一个结构段
     * @param second Section 第二个结构段
     * @return Mono&lt;Void&gt; 合并结果
     */
    private Mono<Void> mergeSections(String documentId, String text, ScriptSourceDtos.Section first, ScriptSourceDtos.Section second) {
        ScriptSourceDtos.Section head = first.sortOrder() <= second.sortOrder() ? first : second;
        ScriptSourceDtos.Section tail = first.sortOrder() <= second.sortOrder() ? second : first;
        if (!Objects.equals(head.parentId(), tail.parentId()) || !head.sectionType().equals(tail.sectionType())) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "只能合并同级同类型的相邻结构段"));
        }
        if (tail.sortOrder() != head.sortOrder() + 1 || tail.startOffset() != head.endOffset()) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "只能合并位置相邻的结构段"));
        }
        // 片段只归属顶层章节或场次；合并子场景不改变所在章节范围，无需重建片段。
        Mono<Void> rebuild = head.parentId() == null
                ? writeChunks(documentId, text, head.id(), head.startOffset(), tail.endOffset())
                : Mono.<Void>empty();
        return repository.moveAllChildren(tail.id(), head.id())
                .then(repository.deleteSection(tail.id()))
                .then(repository.shiftSiblingOrders(documentId, head.parentId(), tail.sortOrder() + 1, -1))
                .then(repository.updateEnd(head.id(), tail.endOffset()))
                .then(rebuild);
    }

    /**
     * 获取原文并开始一次带修订号校验的校对操作。
     *
     * @param projectId String 项目标识
     * @param expectedRevision long 期望修订号
     * @param needText boolean 是否需要读取规范化正文
     * @return Mono&lt;Mutation&gt; 校对上下文
     */
    private Mono<Mutation> beginMutation(String projectId, long expectedRevision, boolean needText) {
        return document(projectId).flatMap(document -> {
            if (!"completed".equals(document.status())) {
                return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "原文尚未解析完成，暂不能校对结构"));
            }
            // 仅拆分与合并需要正文来重建片段，改名不读取超长正文。
            Mono<String> text = needText
                    ? repository.normalizedText(document.id())
                            .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.SYSTEM_ERROR, "原文正文缺失，请重新导入")))
                    : Mono.just("");
            return repository.advanceRevision(document.id(), expectedRevision)
                    .flatMap(advanced -> advanced
                            ? text.map(value -> new Mutation(document, value, expectedRevision + 1))
                            : Mono.<Mutation>error(new BusinessException(ErrorCode.DATA_CONFLICT, "原文结构已被其他页面修改，请刷新后重试")));
        });
    }

    /**
     * 按当前用户与项目读取原文。
     *
     * @param projectId String 项目标识
     * @return Mono&lt;Document&gt; 原文记录
     */
    private Mono<ScriptSourceRepository.Document> document(String projectId) {
        String normalizedProjectId = trimToNull(projectId);
        if (normalizedProjectId == null) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "缺少剧本项目标识"));
        }
        return currentUserProvider.currentUserId()
                .flatMap(userId -> repository.findByProject(userId, normalizedProjectId)
                        .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "该项目没有可校对的导入原文"))));
    }

    /**
     * 读取归属当前原文的结构段。
     *
     * @param documentId String 原文标识
     * @param sectionId String 结构段标识
     * @return Mono&lt;Section&gt; 结构段
     */
    private Mono<ScriptSourceDtos.Section> requireSection(String documentId, String sectionId) {
        String normalizedSectionId = trimToNull(sectionId);
        if (normalizedSectionId == null) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "缺少结构段标识"));
        }
        return repository.getSection(documentId, normalizedSectionId)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "原文结构段不存在")));
    }

    /**
     * 把请求标识写入导入队列，入队失败交由恢复扫描补发。
     *
     * @param taskId String 任务标识
     * @return Mono&lt;Void&gt; 入队结果
     */
    private Mono<Void> enqueue(String taskId) {
        return queueProvider.getObject().enqueue(taskId)
                .onErrorResume(error -> {
                    log.error("原文导入任务入队失败，等待恢复扫描补发: taskId={}", taskId, error);
                    return Mono.empty();
                });
    }

    /**
     * 清理已写入对象存储的原文件。
     *
     * @param prepared Prepared 私有存储结果
     * @return Mono&lt;Void&gt; 清理结果
     */
    private Mono<Void> deleteStoredObject(Prepared prepared) {
        return storageBillingService.requestObjectDeletion(prepared.storageId(), prepared.objectKey());
    }

    /**
     * 校验暂存文件大小并返回字节数。
     *
     * @param staged Path 暂存文件
     * @return long 文件字节数
     * @throws IOException 文件读取失败
     */
    private long stagedFileSize(Path staged) throws IOException {
        long bytes = Files.size(staged);
        if (bytes <= 0) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "上传文件为空，请重新选择");
        }
        if (bytes > MAX_FILE_BYTES) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "上传文件超过 50 MB 上限");
        }
        return bytes;
    }

    /**
     * 计算文件SHA-256摘要。
     *
     * @param file Path 文件路径
     * @return String 十六进制摘要
     * @throws IOException 文件读取失败
     */
    private String sha256(Path file) throws IOException {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream input = Files.newInputStream(file); DigestInputStream digestInput = new DigestInputStream(input, digest)) {
                digestInput.transferTo(OutputStream.nullOutputStream());
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException exception) {
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, "无法计算文件摘要，请重试");
        }
    }

    /**
     * 把拆分点回退到最近的段落边界。
     *
     * @param text String 规范化正文
     * @param start int 结构段起点
     * @param requested int 请求拆分点
     * @param end int 结构段终点
     * @return int 对齐后的拆分点
     */
    private int alignParagraphBoundary(String text, int start, int requested, int end) {
        if (requested <= start || requested >= end) {
            return requested;
        }
        int newline = text.lastIndexOf('\n', requested - 1);
        if (newline >= start) {
            return newline + 1;
        }
        // 无段落边界时退回到字符边界，避免把代理对拆开。
        return Character.isLowSurrogate(text.charAt(requested)) ? requested - 1 : requested;
    }

    /**
     * 推导原文结构段的稳定标识。
     *
     * @param documentId String 原文标识
     * @param index int 结构段下标
     * @return String 稳定标识
     */
    private String sectionIdOf(String documentId, int index) {
        return UUID.nameUUIDFromBytes(("script-source-section:" + documentId + ":" + index)
                .getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString();
    }

    /**
     * 把异常转换为可展示的失败原因。
     *
     * @param error Throwable 异常
     * @return String 失败原因
     */
    private String errorMessage(Throwable error) {
        String message = error instanceof BusinessException ? error.getMessage() : "原文解析失败，请检查文件内容后重试";
        if (!StringUtils.hasText(message)) {
            message = "原文解析失败，请检查文件内容后重试";
        }
        return message.length() > MAX_ERROR_LENGTH ? message.substring(0, MAX_ERROR_LENGTH) : message;
    }

    /**
     * 校验原文类型。
     *
     * @param sourceType String 原文类型
     * @return String 规范化原文类型
     */
    private String normalizeSourceType(String sourceType) {
        String value = trimToNull(sourceType);
        if ("novel".equals(value) || "script".equals(value)) {
            return value;
        }
        throw new BusinessException(ErrorCode.PARAM_INVALID, "请选择导入类型：小说或剧本");
    }

    /**
     * 校验内容形式。
     *
     * @param contentType String 内容形式
     * @return String 规范化内容形式
     */
    private String normalizeContentType(String contentType) {
        String value = trimToNull(contentType);
        if (value == null) {
            return "comicDrama";
        }
        if (!SUPPORTED_CONTENT_TYPES.contains(value)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "内容形式不受支持");
        }
        return value;
    }

    /**
     * 校验文本编码，非文本文件返回空编码。
     *
     * @param extension String 扩展名
     * @param encoding String 请求编码
     * @return String 规范化编码
     */
    private String normalizeEncoding(String extension, String encoding) {
        if (!"txt".equals(extension)) {
            return null;
        }
        String value = trimToNull(encoding) == null ? "UTF-8" : trimToNull(encoding).toUpperCase(Locale.ROOT);
        if (!SUPPORTED_ENCODINGS.contains(value)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "TXT编码只支持UTF-8或GB18030");
        }
        return value;
    }

    /**
     * 生成项目名称，缺省取文件名主体。
     *
     * @param title String 请求名称
     * @param fileName String 原始文件名
     * @return String 项目名称
     */
    private String projectTitle(String title, String fileName) {
        String value = trimToNull(title);
        if (value == null) {
            int dot = fileName.lastIndexOf('.');
            value = dot > 0 ? fileName.substring(0, dot) : fileName;
        }
        value = value.trim();
        if (value.isEmpty()) {
            value = "未命名原文";
        }
        return value.length() > MAX_TITLE_LENGTH ? value.substring(0, MAX_TITLE_LENGTH) : value;
    }

    /**
     * 校验结构段标题。
     *
     * @param title String 标题
     * @return String 规范化标题
     */
    private String sectionTitle(String title) {
        String value = trimToNull(title);
        if (value == null) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "结构段标题不能为空");
        }
        if (value.length() > MAX_SECTION_TITLE_LENGTH) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "结构段标题不能超过255个字符");
        }
        return value;
    }

    /**
     * 提取小写扩展名。
     *
     * @param fileName String 文件名
     * @return String 扩展名
     */
    private String extensionOf(String fileName) {
        int dot = fileName.lastIndexOf('.');
        return dot < 0 || dot == fileName.length() - 1 ? "" : fileName.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    /**
     * 去除首尾空白并按空串归一。
     *
     * @param value String 原始值
     * @return String 归一结果
     */
    private String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    /**
     * 安静删除暂存文件。
     *
     * @param file Path 待删除文件
     */
    private void deleteQuietly(Path file) {
        if (file == null) {
            return;
        }
        try {
            Files.deleteIfExists(file);
        } catch (IOException exception) {
            log.error("清理原文暂存文件失败: file={}", file, exception);
        }
    }

    /** 私有存储结果。 */
    private record Prepared(String storageId, String objectKey, String sha256, long bytes) { }

    /** 校对操作上下文。 */
    private record Mutation(ScriptSourceRepository.Document document, String text, long revision) { }
}
