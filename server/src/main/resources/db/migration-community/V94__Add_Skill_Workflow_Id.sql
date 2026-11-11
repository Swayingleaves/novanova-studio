ALTER TABLE skills
    ADD COLUMN workflow_id VARCHAR(64);

COMMENT ON COLUMN skills.workflow_id IS '技能工作流标识。新增时必填，未删除技能之间唯一；服务端和 Agent 都用它确认工作流';

UPDATE skills
SET workflow_id = lower((regexp_match(system_prompt, '(?m)^\s*workflow\s*:\s*([A-Za-z0-9][A-Za-z0-9_-]*)\s*$'))[1])
WHERE deleted_at IS NULL
  AND workflow_id IS NULL
  AND system_prompt ~ '(?m)^\s*workflow\s*:\s*[A-Za-z0-9][A-Za-z0-9_-]*\s*$';

WITH ranked AS (
    SELECT id,
           row_number() OVER (PARTITION BY lower(workflow_id) ORDER BY id) AS rn
    FROM skills
    WHERE deleted_at IS NULL AND workflow_id IS NOT NULL AND workflow_id <> ''
)
UPDATE skills AS skill
SET workflow_id = left(skill.workflow_id, 50) || '-' || skill.id::text
FROM ranked
WHERE skill.id = ranked.id AND ranked.rn > 1;

CREATE UNIQUE INDEX uk_skills_workflow_id
    ON skills (lower(workflow_id))
    WHERE deleted_at IS NULL AND workflow_id IS NOT NULL AND workflow_id <> '';
