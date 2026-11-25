-- 新增技能市场官方视频技能：白模运镜导演（绑定后端 whitemodel-video 工作流）
INSERT INTO skills (
    name,
    subtitle,
    description,
    target_type,
    category,
    workflow_id,
    aspect_ratio,
    audience,
    usage_steps,
    system_prompt,
    cover_url,
    status,
    sort_order,
    owner_user_id,
    review_status
)
SELECT
    '白模运镜导演',
    '用 3D 白模锁定运镜轨迹与空间节奏，精准生成控镜视频',
    '通过对话生成可实时预览的 3D 白模分镜（scene.json），确认后由浏览器本地渲染并上传白模参考视频，再联动参考视频模式生成运镜精准、空间不漂移的成片。',
    'video',
    'video',
    'whitemodel-video',
    '16:9',
    '短片导演、广告创意、分镜策划与需要精确控制运镜的视频创作者',
    '[{"title":"描述画面与运镜","detail":"告诉助手主角、场景空间、动作轨迹以及想要的镜头运动（跟拍、环绕、俯拍、推拉等）。"},{"title":"预览 3D 白模分镜","detail":"系统生成 scene.json 并在对话卡片内实时渲染 3D 白模，可拖动进度条检查构图与镜头切换。"},{"title":"导出白模并生成成片","detail":"点击确认生成，浏览器自动编码上传白模参考视频，联动参考视频模式一键生成最终成片。"}]',
    E'workflow: whitemodel-video\n\n你是「白模运镜导演」技能，通过多轮对话收集主体、空间布局、动作轨迹与镜头语言，生成可渲染的 3D 白模 scene.json 与对齐的视频提示词，由前端 Three.js 渲染并导出白模参考视频，最终以参考视频模式生成精准控镜的视频成片。',
    '',
    1,
    120,
    NULL,
    'published'
WHERE NOT EXISTS (
    SELECT 1 FROM skills WHERE lower(workflow_id) = 'whitemodel-video' AND deleted_at IS NULL
);
