package com.novanovastudio.repository;

import com.novanovastudio.dto.ScriptSourceDtos;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 剧本与小说原文的数据库访问。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-09-26 00:00
 */
@Repository
@RequiredArgsConstructor
public class ScriptSourceRepository {
    /** 响应式数据库客户端。 */
    private final DatabaseClient databaseClient;

    /** 原文记录。 */
    public record Document(String id, String projectId, long userId, String sourceType, String fileName,
                           String fileExtension, String textEncoding, String storageConfigId, String objectKey,
                           String fileSha256, long revision, Long confirmedRevision, String status, String warning) { }

    /**
     * 查询同一客户端请求的导入记录。
     * @param userId long 用户标识
     * @param clientRequestId String 请求标识
     * @return Mono<Document> 原文记录
     */
    public Mono<Document> findByRequest(long userId, String clientRequestId) {
        return databaseClient.sql("SELECT * FROM script_source_documents WHERE user_id=:userId AND client_request_id=:requestId")
                .bind("userId", userId).bind("requestId", clientRequestId).map((row, metadata) -> mapDocument(row)).one();
    }

    /**
     * 按用户与项目读取原文，排除软删除项目。
     * @param userId long 用户标识
     * @param projectId String 项目标识
     * @return Mono<Document> 原文记录
     */
    public Mono<Document> findByProject(long userId, String projectId) {
        return databaseClient.sql("SELECT document.* FROM script_source_documents document JOIN script_projects project ON project.id=document.project_id WHERE document.user_id=:userId AND document.project_id=:projectId AND project.status=1")
                .bind("userId", userId).bind("projectId", projectId).map((row, metadata) -> mapDocument(row)).one();
    }

    /**
     * 按任务标识读取原文。
     * @param taskId String 任务标识
     * @return Mono<Document> 原文记录
     */
    public Mono<Document> findByTask(String taskId) {
        return databaseClient.sql("SELECT document.* FROM script_source_documents document JOIN script_source_import_tasks task ON task.document_id=document.id WHERE task.id=:taskId")
                .bind("taskId", taskId).map((row, metadata) -> mapDocument(row)).one();
    }

    /**
     * 新增原文与任务。
     * @param document Document 原文记录
     * @param clientRequestId String 幂等请求标识
     * @param sha256 String 文件摘要
     * @param bytes long 文件大小
     * @param taskId String 任务标识
     * @return Mono<Void> 写入结果
     */
    public Mono<Void> create(Document document, String clientRequestId, String sha256, long bytes, String taskId) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("INSERT INTO script_source_documents(id,project_id,user_id,client_request_id,source_type,file_name,file_extension,text_encoding,storage_config_id,object_key,file_sha256,file_bytes) VALUES (:id,:projectId,:userId,:requestId,:sourceType,:fileName,:extension,:encoding,:storageId,:objectKey,:sha256,:bytes)")
                .bind("id", document.id()).bind("projectId", document.projectId()).bind("userId", document.userId())
                .bind("requestId", clientRequestId).bind("sourceType", document.sourceType()).bind("fileName", document.fileName())
                .bind("extension", document.fileExtension())
                .bind("storageId", document.storageConfigId()).bind("objectKey", document.objectKey())
                .bind("sha256", sha256).bind("bytes", bytes);
        spec = document.textEncoding() == null ? spec.bindNull("encoding", String.class) : spec.bind("encoding", document.textEncoding());
        return spec.fetch().rowsUpdated()
                .then(databaseClient.sql("INSERT INTO script_source_import_tasks(id,document_id) VALUES (:taskId,:documentId)")
                        .bind("taskId", taskId).bind("documentId", document.id()).fetch().rowsUpdated()).then();
    }

    /**
     * 查询原文对应的导入任务标识。
     * @param documentId String 原文标识
     * @return Mono<String> 任务标识
     */
    public Mono<String> findTaskId(String documentId) {
        return databaseClient.sql("SELECT id FROM script_source_import_tasks WHERE document_id=:documentId")
                .bind("documentId", documentId).map((row, metadata) -> row.get("id", String.class)).one();
    }

    /**
     * 读取规范化正文，用于重建受影响的片段。
     * @param documentId String 原文标识
     * @return Mono<String> 规范化正文
     */
    public Mono<String> normalizedText(String documentId) {
        return databaseClient.sql("SELECT normalized_text FROM script_source_documents WHERE id=:documentId")
                .bind("documentId", documentId)
                .map((row, metadata) -> java.util.Optional.ofNullable(row.get("normalized_text", String.class)))
                .all().filter(java.util.Optional::isPresent).map(java.util.Optional::get).next();
    }

    /**
     * 更新TXT编码后重新解析。
     * @param documentId String 原文标识
     * @param encoding String 新编码
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> updateEncoding(String documentId, String encoding) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("UPDATE script_source_documents SET text_encoding=:encoding,updated_at=CURRENT_TIMESTAMP WHERE id=:documentId")
                .bind("documentId", documentId);
        spec = encoding == null ? spec.bindNull("encoding", String.class) : spec.bind("encoding", encoding);
        return spec.fetch().rowsUpdated().then();
    }

    /**
     * 更换解码方式时清空旧结构与检查点，避免沿用不匹配的章节边界。
     * @param documentId String 原文标识
     * @return Mono<Void> 清理结果
     */
    public Mono<Void> resetParsedStructure(String documentId) {
        return databaseClient.sql("DELETE FROM script_source_sections WHERE document_id=:documentId")
                .bind("documentId", documentId).fetch().rowsUpdated()
                .then(databaseClient.sql("UPDATE script_source_import_tasks SET processed_sections=0,total_sections=0,stage='uploaded',updated_at=CURRENT_TIMESTAMP WHERE document_id=:documentId")
                        .bind("documentId", documentId).fetch().rowsUpdated()).then();
    }

    /**
     * 为导入原文创建空白剧本项目。
     * @param projectId String 项目标识
     * @param userId long 用户标识
     * @param title String 项目名称
     * @param contentType String 内容形式
     * @return Mono<Void> 创建结果
     */
    public Mono<Void> createProject(String projectId, long userId, String title, String contentType) {
        return databaseClient.sql("INSERT INTO script_projects(id,user_id,title,content_type) VALUES (:id,:userId,:title,:contentType)")
                .bind("id", projectId).bind("userId", userId).bind("title", title).bind("contentType", contentType)
                .fetch().rowsUpdated().then();
    }

    /**
     * 查询导入任务进度。
     * @param document Document 原文记录
     * @return Mono<ImportStatus> 任务进度
     */
    public Mono<ScriptSourceDtos.ImportStatus> status(Document document) {
        return databaseClient.sql("SELECT id,status,stage,processed_sections,total_sections,error_message FROM script_source_import_tasks WHERE document_id=:documentId")
                .bind("documentId", document.id()).map((row, metadata) -> new ScriptSourceDtos.ImportStatus(
                        document.projectId(), document.id(), row.get("id", String.class), row.get("status", String.class),
                        row.get("stage", String.class), row.get("processed_sections", Integer.class), row.get("total_sections", Integer.class),
                        row.get("error_message", String.class), document.warning(), document.fileName(),
                        document.textEncoding(), document.revision(), document.confirmedRevision())).one();
    }

    /**
     * 抢占等待中或租约已过期的任务，避免重复执行，同时回收异常中断的执行中任务。
     * @param taskId String 任务标识
     * @param leaseSeconds int 租约秒数
     * @return Mono<Boolean> 是否抢占成功
     */
    public Mono<Boolean> claim(String taskId, int leaseSeconds) {
        return databaseClient.sql("UPDATE script_source_import_tasks SET status='running',attempt_count=attempt_count+1,lease_until=CURRENT_TIMESTAMP+make_interval(secs=>:lease),updated_at=CURRENT_TIMESTAMP WHERE id=:taskId AND (status='queued' OR (status='running' AND lease_until<CURRENT_TIMESTAMP))")
                .bind("taskId", taskId).bind("lease", leaseSeconds).fetch().rowsUpdated().map(count -> count > 0);
    }

    /**
     * 续期执行中任务的租约。
     * @param taskId String 任务标识
     * @param leaseSeconds int 租约秒数
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> renewLease(String taskId, int leaseSeconds) {
        return databaseClient.sql("UPDATE script_source_import_tasks SET lease_until=CURRENT_TIMESTAMP+make_interval(secs=>:lease) WHERE id=:taskId AND status='running'")
                .bind("taskId", taskId).bind("lease", leaseSeconds).fetch().rowsUpdated().then();
    }

    /**
     * 保存规范化原文并初始化进度。
     * @param documentId String 原文标识
     * @param text String 规范化正文
     * @param warning String 解析提示
     * @param total int 顶层结构段数量
     * @return Mono<Void> 保存结果
     */
    public Mono<Void> saveParsedText(String documentId, String text, String warning, int total) {
        return databaseClient.sql("UPDATE script_source_documents SET normalized_text=:text,warning=:warning,status='parsing',updated_at=CURRENT_TIMESTAMP WHERE id=:documentId")
                .bind("text", text).bind("warning", warning).bind("documentId", documentId).fetch().rowsUpdated()
                .then(databaseClient.sql("UPDATE script_source_import_tasks SET stage='sections',total_sections=:total,updated_at=CURRENT_TIMESTAMP WHERE document_id=:documentId")
                        .bind("total", total).bind("documentId", documentId).fetch().rowsUpdated()).then();
    }

    /**
     * 读取断点进度。
     * @param documentId String 原文标识
     * @return Mono<Integer> 已完成顶层结构段数量
     */
    public Mono<Integer> processedSections(String documentId) {
        return databaseClient.sql("SELECT processed_sections FROM script_source_import_tasks WHERE document_id=:documentId")
                .bind("documentId", documentId).map((row, metadata) -> row.get("processed_sections", Integer.class)).one();
    }

    /**
     * 插入结构段，重复执行时保持同一标识。
     * @param documentId String 原文标识
     * @param section ScriptSourceDtos.Section 结构段
     * @return Mono<Void> 保存结果
     */
    public Mono<Void> insertSection(String documentId, ScriptSourceDtos.Section section) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("INSERT INTO script_source_sections(id,document_id,parent_id,section_type,title,start_offset,end_offset,sort_order,needs_review) VALUES (:id,:documentId,:parentId,:type,:title,:start,:end,:order,:review) ON CONFLICT (id) DO NOTHING")
                .bind("id", section.id()).bind("documentId", documentId).bind("type", section.sectionType())
                .bind("title", section.title()).bind("start", section.startOffset()).bind("end", section.endOffset())
                .bind("order", section.sortOrder()).bind("review", section.needsReview());
        spec = section.parentId() == null ? spec.bindNull("parentId", String.class) : spec.bind("parentId", section.parentId());
        return spec.fetch().rowsUpdated().then();
    }

    /**
     * 插入片段，重复执行时保持唯一顺序。
     * @param documentId String 原文标识
     * @param sectionId String 顶层结构段标识
     * @param index int 片段序号
     * @param start int 起点
     * @param end int 终点
     * @param content String 正文
     * @return Mono<Void> 写入结果
     */
    public Mono<Void> insertChunk(String documentId, String sectionId, int index, int start, int end, String content) {
        return databaseClient.sql("INSERT INTO script_source_chunks(id,document_id,section_id,chunk_index,start_offset,end_offset,content,character_count) VALUES (:id,:documentId,:sectionId,:index,:start,:end,:content,:count) ON CONFLICT (section_id,chunk_index) DO NOTHING")
                .bind("id", java.util.UUID.randomUUID().toString()).bind("documentId", documentId).bind("sectionId", sectionId)
                .bind("index", index).bind("start", start).bind("end", end).bind("content", content)
                .bind("count", end - start).fetch().rowsUpdated().then();
    }

    /**
     * 记录已完成的顶层结构段数。
     * @param documentId String 原文标识
     * @param processed int 已完成数量
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> checkpoint(String documentId, int processed) {
        return databaseClient.sql("UPDATE script_source_import_tasks SET processed_sections=GREATEST(processed_sections,:processed),updated_at=CURRENT_TIMESTAMP WHERE document_id=:documentId")
                .bind("processed", processed).bind("documentId", documentId).fetch().rowsUpdated().then();
    }

    /**
     * 标记导入完成。
     * @param documentId String 原文标识
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> complete(String documentId) {
        return databaseClient.sql("UPDATE script_source_documents SET status='completed',updated_at=CURRENT_TIMESTAMP WHERE id=:documentId")
                .bind("documentId", documentId).fetch().rowsUpdated()
                .then(databaseClient.sql("UPDATE script_source_import_tasks SET status='completed',stage='completed',error_message='',updated_at=CURRENT_TIMESTAMP WHERE document_id=:documentId")
                        .bind("documentId", documentId).fetch().rowsUpdated()).then();
    }

    /**
     * 标记导入失败。
     * @param documentId String 原文标识
     * @param message String 错误信息
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> fail(String documentId, String message) {
        return databaseClient.sql("UPDATE script_source_documents SET status='failed',updated_at=CURRENT_TIMESTAMP WHERE id=:documentId")
                .bind("documentId", documentId).fetch().rowsUpdated()
                .then(databaseClient.sql("UPDATE script_source_import_tasks SET status='failed',error_message=:message,updated_at=CURRENT_TIMESTAMP WHERE document_id=:documentId")
                        .bind("documentId", documentId).bind("message", message).fetch().rowsUpdated()).then();
    }

    /**
     * 将失败任务重新排队。
     * @param documentId String 原文标识
     * @return Mono<Boolean> 是否更新成功
     */
    public Mono<Boolean> retry(String documentId) {
        return databaseClient.sql("UPDATE script_source_import_tasks SET status='queued',stage='uploaded',error_message='',updated_at=CURRENT_TIMESTAMP WHERE document_id=:documentId AND status='failed'")
                .bind("documentId", documentId).fetch().rowsUpdated().map(count -> count > 0)
                .flatMap(updated -> updated ? databaseClient.sql("UPDATE script_source_documents SET status='queued',updated_at=CURRENT_TIMESTAMP WHERE id=:documentId")
                        .bind("documentId", documentId).fetch().rowsUpdated().thenReturn(true) : Mono.just(false));
    }

    /**
     * 列出等待中或执行租约已过期的导入任务。
     * @return Flux<String> 任务标识
     */
    public Flux<String> recoverableTaskIds() {
        return databaseClient.sql("SELECT id FROM script_source_import_tasks WHERE status='queued' OR (status='running' AND lease_until<CURRENT_TIMESTAMP) ORDER BY updated_at")
                .map((row, metadata) -> row.get("id", String.class)).all();
    }

    /**
     * 查询原文目录。
     * @param documentId String 原文标识
     * @return Flux<Section> 结构段列表
     */
    public Flux<ScriptSourceDtos.Section> listSections(String documentId) {
        return databaseClient.sql("SELECT * FROM script_source_sections WHERE document_id=:documentId ORDER BY start_offset,sort_order")
                .bind("documentId", documentId).map((row, metadata) -> mapSection(row)).all();
    }

    /**
     * 查询单个结构段。
     * @param documentId String 原文标识
     * @param sectionId String 结构段标识
     * @return Mono<Section> 结构段
     */
    public Mono<ScriptSourceDtos.Section> getSection(String documentId, String sectionId) {
        return databaseClient.sql("SELECT * FROM script_source_sections WHERE document_id=:documentId AND id=:sectionId")
                .bind("documentId", documentId).bind("sectionId", sectionId).map((row, metadata) -> mapSection(row)).one();
    }

    /**
     * 仅读取请求结构段的正文，片段只取顶层章节或场次，避免子场景片段重复拼接。
     * @param documentId String 原文标识
     * @param section ScriptSourceDtos.Section 结构段
     * @return Mono<String> 正文
     */
    public Mono<String> sectionText(String documentId, ScriptSourceDtos.Section section) {
        return databaseClient.sql("SELECT chunk.start_offset,chunk.end_offset,chunk.content FROM script_source_chunks chunk JOIN script_source_sections owner ON owner.id=chunk.section_id WHERE chunk.document_id=:documentId AND owner.parent_id IS NULL AND chunk.start_offset < :end AND chunk.end_offset > :start ORDER BY chunk.start_offset")
                .bind("documentId", documentId).bind("start", section.startOffset()).bind("end", section.endOffset())
                .map((row, metadata) -> {
                    int chunkStart = row.get("start_offset", Integer.class);
                    int chunkEnd = row.get("end_offset", Integer.class);
                    String content = row.get("content", String.class);
                    return content.substring(Math.max(0, section.startOffset() - chunkStart),
                            Math.min(chunkEnd, section.endOffset()) - chunkStart);
                }).all().collectList().map(parts -> String.join("", parts));
    }

    /**
     * 更新标题。
     * @param sectionId String 结构段标识
     * @param title String 新标题
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> rename(String sectionId, String title) {
        return databaseClient.sql("UPDATE script_source_sections SET title=:title,needs_review=FALSE WHERE id=:id")
                .bind("id", sectionId).bind("title", title).fetch().rowsUpdated().then();
    }

    /**
     * 更新结构段边界。
     * @param sectionId String 结构段标识
     * @param end int 新终点
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> updateEnd(String sectionId, int end) {
        return databaseClient.sql("UPDATE script_source_sections SET end_offset=:end WHERE id=:id")
                .bind("id", sectionId).bind("end", end).fetch().rowsUpdated().then();
    }

    /**
     * 更新结构段起点。
     * @param sectionId String 结构段标识
     * @param start int 新起点
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> updateStart(String sectionId, int start) {
        return databaseClient.sql("UPDATE script_source_sections SET start_offset=:start WHERE id=:id")
                .bind("id", sectionId).bind("start", start).fetch().rowsUpdated().then();
    }

    /**
     * 平移同级结构段排序序号，为拆分或合并腾出位置。
     * @param documentId String 原文标识
     * @param parentId String 父结构段标识，顶层结构段为空
     * @param fromOrder int 起始排序序号，包含
     * @param delta int 平移量
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> shiftSiblingOrders(String documentId, String parentId, int fromOrder, int delta) {
        String parentCondition = parentId == null ? "parent_id IS NULL" : "parent_id=:parentId";
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("UPDATE script_source_sections SET sort_order=sort_order+:delta WHERE document_id=:documentId AND " + parentCondition + " AND sort_order>=:fromOrder")
                .bind("documentId", documentId).bind("delta", delta).bind("fromOrder", fromOrder);
        if (parentId != null) {
            spec = spec.bind("parentId", parentId);
        }
        return spec.fetch().rowsUpdated().then();
    }

    /**
     * 删除结构段及其片段。
     * @param sectionId String 结构段标识
     * @return Mono<Void> 删除结果
     */
    public Mono<Void> deleteSection(String sectionId) {
        return databaseClient.sql("DELETE FROM script_source_sections WHERE id=:id")
                .bind("id", sectionId).fetch().rowsUpdated().then();
    }

    /**
     * 删除结构段的旧片段。
     * @param sectionId String 结构段标识
     * @return Mono<Void> 删除结果
     */
    public Mono<Void> deleteChunks(String sectionId) {
        return databaseClient.sql("DELETE FROM script_source_chunks WHERE section_id=:id")
                .bind("id", sectionId).fetch().rowsUpdated().then();
    }

    /**
     * 查询某结构段是否包含子场景。
     * @param sectionId String 结构段标识
     * @return Mono<Boolean> 是否存在子结构段
     */
    public Mono<Boolean> hasChildren(String sectionId) {
        return databaseClient.sql("SELECT EXISTS(SELECT 1 FROM script_source_sections WHERE parent_id=:id) AS found")
                .bind("id", sectionId).map((row, metadata) -> Boolean.TRUE.equals(row.get("found", Boolean.class))).one();
    }

    /**
     * 查询跨越拆分点的子场景。
     * @param parentId String 父章节标识
     * @param offset int 拆分偏移
     * @return Mono<Section> 跨界子场景
     */
    public Mono<ScriptSourceDtos.Section> straddlingChild(String parentId, int offset) {
        return databaseClient.sql("SELECT * FROM script_source_sections WHERE parent_id=:parentId AND start_offset<:offset AND end_offset>:offset")
                .bind("parentId", parentId).bind("offset", offset).map((row, metadata) -> mapSection(row)).one();
    }

    /**
     * 按起点重排子场景序号。
     * @param parentId String 父章节标识
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> renumberChildren(String parentId) {
        return databaseClient.sql("UPDATE script_source_sections section SET sort_order=ordered.position FROM (SELECT id,ROW_NUMBER() OVER (ORDER BY start_offset)-1 AS position FROM script_source_sections WHERE parent_id=:parentId) ordered WHERE section.id=ordered.id")
                .bind("parentId", parentId).fetch().rowsUpdated().then();
    }

    /**
     * 将分割点之后的子场景转移到新章节。
     * @param parentId String 原章节标识
     * @param newParentId String 新章节标识
     * @param offset int 分割偏移
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> moveChildren(String parentId, String newParentId, int offset) {
        return databaseClient.sql("UPDATE script_source_sections SET parent_id=:newParentId WHERE parent_id=:parentId AND start_offset>=:offset")
                .bind("newParentId", newParentId).bind("parentId", parentId).bind("offset", offset).fetch().rowsUpdated().then();
    }

    /**
     * 将下一章节的子场景追加到上一章节子场景末尾。
     * @param nextId String 下一章节标识
     * @param previousId String 上一章节标识
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> moveAllChildren(String nextId, String previousId) {
        // 追加需要偏移排序序号，否则两个章节的子场景序号会重复，破坏同级相邻判定。
        return databaseClient.sql("SELECT COALESCE(MAX(sort_order)+1,0) AS next_order FROM script_source_sections WHERE parent_id=:previousId")
                .bind("previousId", previousId).map((row, metadata) -> row.get("next_order", Integer.class)).one()
                .flatMap(offset -> databaseClient.sql("UPDATE script_source_sections SET parent_id=:previousId,sort_order=sort_order+:offset WHERE parent_id=:nextId")
                        .bind("previousId", previousId).bind("offset", offset).bind("nextId", nextId).fetch().rowsUpdated().then());
    }

    /**
     * 以乐观锁更新原文结构修订号。
     * @param documentId String 原文标识
     * @param revision long 当前修订号
     * @return Mono<Boolean> 是否更新成功
     */
    public Mono<Boolean> advanceRevision(String documentId, long revision) {
        return databaseClient.sql("UPDATE script_source_documents SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=:id AND revision=:revision AND status='completed'")
                .bind("id", documentId).bind("revision", revision).fetch().rowsUpdated().map(count -> count > 0);
    }

    /**
     * 确认当前结构修订，修订号不一致时不更新。
     * @param documentId String 原文标识
     * @param revision long 期望修订号
     * @return Mono<Boolean> 是否确认成功
     */
    public Mono<Boolean> confirmStructure(String documentId, long revision) {
        return databaseClient.sql("UPDATE script_source_documents SET confirmed_revision=revision,updated_at=CURRENT_TIMESTAMP WHERE id=:id AND revision=:revision AND status='completed'")
                .bind("id", documentId).bind("revision", revision).fetch().rowsUpdated().map(count -> count > 0);
    }

    /**
     * 转换原文数据库行。
     * @param row Row 数据库行
     * @return Document 原文记录
     */
    private Document mapDocument(io.r2dbc.spi.Row row) {
        return new Document(row.get("id", String.class), row.get("project_id", String.class), row.get("user_id", Long.class),
                row.get("source_type", String.class), row.get("file_name", String.class), row.get("file_extension", String.class),
                row.get("text_encoding", String.class), row.get("storage_config_id", String.class), row.get("object_key", String.class),
                row.get("file_sha256", String.class), row.get("revision", Long.class), row.get("confirmed_revision", Long.class), row.get("status", String.class), row.get("warning", String.class));
    }

    /**
     * 转换结构段数据库行。
     * @param row Row 数据库行
     * @return Section 结构段
     */
    private ScriptSourceDtos.Section mapSection(io.r2dbc.spi.Row row) {
        return new ScriptSourceDtos.Section(row.get("id", String.class), row.get("parent_id", String.class),
                row.get("section_type", String.class), row.get("title", String.class), row.get("start_offset", Integer.class),
                row.get("end_offset", Integer.class), row.get("sort_order", Integer.class), Boolean.TRUE.equals(row.get("needs_review", Boolean.class)));
    }
}
