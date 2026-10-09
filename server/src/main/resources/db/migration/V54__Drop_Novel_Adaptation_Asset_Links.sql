-- 故事知识库事实与漫剧视觉资产的人工关联功能已下线：
-- 该关联只服务于已移除的「故事知识库资产建议」面板，不参与镜头拆分、提示词合成与媒体生成，直接删除关联表。
DROP TABLE IF EXISTS novel_adaptation_asset_links;
