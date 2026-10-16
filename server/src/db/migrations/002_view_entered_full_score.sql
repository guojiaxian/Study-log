-- ============================================================
-- 002 视图增强：新增"本次已录入且计入总分科目的满分之和"
-- 说明：总分满分固定为中考口径 730；entered_full_score 仅用于
--       "本次口径"展示（如某次月考仅覆盖 7 门文化课 = 600）
-- ============================================================

DROP VIEW IF EXISTS v_exam_summary;

CREATE VIEW v_exam_summary AS
SELECT
  e.id                                        AS exam_id,
  e.name                                      AS name,
  e.exam_type                                 AS exam_type,
  e.exam_date                                 AS exam_date,
  e.grade                                     AS grade,
  e.term                                      AS term,
  e.status                                    AS status,
  e.source                                    AS source,
  e.class_rank                                AS class_rank,
  e.class_size                                AS class_size,
  e.grade_rank                                AS grade_rank,
  e.grade_size                                AS grade_size,
  COUNT(s.id)                                 AS entered_subject_count,
  COALESCE(SUM(CASE WHEN sub.counts_to_total = 1 AND s.is_absent = 0
                    THEN s.score END), 0)     AS total_score,
  COALESCE(SUM(CASE WHEN sub.counts_to_total = 1 AND s.is_absent = 0
                    THEN sub.full_score END), 0) AS entered_full_score
FROM exam e
LEFT JOIN exam_score s   ON s.exam_id = e.id
LEFT JOIN subject    sub ON sub.id    = s.subject_id
GROUP BY e.id;

INSERT OR IGNORE INTO schema_version (version, description) VALUES (2, 'view: add entered_full_score');
