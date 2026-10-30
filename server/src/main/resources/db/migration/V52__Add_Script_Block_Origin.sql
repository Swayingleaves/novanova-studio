-- 正文块来源：original 表示内容来自原著事实，adapted 表示 AI 新增的改编创作。
-- 此前由提示词要求在正文里写「【改编创作】」，标记于是混进了剧本正文（会随分集工作台、
-- 后续配音与成片链路一起带出去），且实测一半以上的块都被标注，失去区分度。
-- 改为结构化字段承载：正文只放剧本内容，来源信息由本字段表达。
ALTER TABLE script_blocks ADD COLUMN origin VARCHAR(16) NOT NULL DEFAULT 'original';

ALTER TABLE script_blocks ADD CONSTRAINT ck_script_blocks_origin CHECK (origin IN ('original', 'adapted'));

COMMENT ON COLUMN script_blocks.origin IS '正文块来源：original 原著事实，adapted AI 改编创作';

-- 存量清理：把写在正文里的标记摘掉，来源记为 adapted。
-- 标记本身不携带内容，摘除只影响标记与其两侧空白，不会让任何正文块变空（执行前已按库核验）。
UPDATE script_blocks
SET origin = 'adapted',
    content = btrim(regexp_replace(content, '【改编创作[^】]*】', '', 'g'))
WHERE content LIKE '%【改编创作%';
