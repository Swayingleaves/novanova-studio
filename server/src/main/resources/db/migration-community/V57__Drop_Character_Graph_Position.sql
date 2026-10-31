-- 人物关系图谱功能已下线，删除仅供画布排版使用的坐标列。
-- 人物关系数据本身（script_character_relations）保留不动。
ALTER TABLE script_characters DROP COLUMN IF EXISTS graph_position_x;
ALTER TABLE script_characters DROP COLUMN IF EXISTS graph_position_y;
