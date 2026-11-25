-- 移除对改编流程无作用的人工故事时间排序字段。
ALTER TABLE story_bible_items DROP COLUMN IF EXISTS story_order;
