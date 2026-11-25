-- 将白模技能更名为「白膜制作」，调整为上传视频反解制作 3D 白膜流程
UPDATE skills
SET name = '白膜制作',
    subtitle = '上传参考视频，自动解析运镜轨迹与空间布局并制作可导出的 3D 白膜视频',
    description = '上传一段参考视频，自动抽取关键帧分析主体运动轨迹、空间结构与镜头运动，实时生成 3D 白膜预览，并支持一键在浏览器导出白膜 MP4。',
    usage_steps = '[{"title":"上传参考视频","detail":"上传想要制作成白膜的参考视频，可选补充镜头或主体调整说明。"},{"title":"解析并预览 3D 白膜","detail":"系统自动抽取视频关键帧分析运镜与空间轨迹，在卡片中实时播放 3D 白膜并可继续对话微调。"},{"title":"一键导出白膜 MP4","detail":"确认效果后直接在浏览器编码下载或保存白膜 MP4，后续可直接作为参考视频驱动成片。"}]',
    system_prompt = E'workflow: whitemodel-video\n\n你是「白膜制作」技能：引导用户上传一段参考视频，分析视频关键帧中的主体运动轨迹、空间布局与镜头运动，生成可渲染的 3D 白膜 scene.json 供前端 Three.js 实时预览并一键导出白膜 MP4。',
    updated_at = CURRENT_TIMESTAMP
WHERE lower(workflow_id) = 'whitemodel-video'
  AND deleted_at IS NULL;
