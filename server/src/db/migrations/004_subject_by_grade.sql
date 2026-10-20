-- ============================================================
-- 004 按学段（初二/初三）区分的科目字典
--
-- 背景：初一/初二/初三的考试科目与科目满分并不相同。例如郑州：
--   初二：语文/数学/英语各 120 + 物理 70 + 道德与法治 70 + 历史 70 = 570
--   初三：语文/数学/英语各 120 + 物理 70 + 化学 50 + 道德与法治 70
--         + 历史 50 + 体育 100 + 理化生实验操作 30 = 730（中考口径）
-- 因此把「科目满分 / 是否计入总分 / 是否启用」下沉到 subject_grade 表，
-- 按 (科目, 学段) 维护；subject 表保持"科目身份"（code/name/score_mode）。
--
-- 读取约定：存在 subject_grade 行时以其为准，缺失时回退 subject 的旧列值。
-- ============================================================

CREATE TABLE IF NOT EXISTS subject_grade (
  subject_id      INTEGER NOT NULL REFERENCES subject(id) ON DELETE CASCADE,
  grade           INTEGER NOT NULL CHECK (grade IN (8,9)),
  full_score      REAL    NOT NULL CHECK (full_score > 0),
  counts_to_total INTEGER NOT NULL DEFAULT 1 CHECK (counts_to_total IN (0,1)),
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (subject_id, grade)
);
CREATE INDEX IF NOT EXISTS idx_subject_grade_grade ON subject_grade(grade, sort_order);

-- ---------- 初二字典（计入总分合计 570） ----------
INSERT OR IGNORE INTO subject_grade (subject_id, grade, full_score, counts_to_total, is_active, sort_order)
SELECT id, 8, 120, 1, 1,  10 FROM subject WHERE code = 'chinese';
INSERT OR IGNORE INTO subject_grade (subject_id, grade, full_score, counts_to_total, is_active, sort_order)
SELECT id, 8, 120, 1, 1,  20 FROM subject WHERE code = 'math';
INSERT OR IGNORE INTO subject_grade (subject_id, grade, full_score, counts_to_total, is_active, sort_order)
SELECT id, 8, 120, 1, 1,  30 FROM subject WHERE code = 'english';
INSERT OR IGNORE INTO subject_grade (subject_id, grade, full_score, counts_to_total, is_active, sort_order)
SELECT id, 8,  70, 1, 1,  40 FROM subject WHERE code = 'physics';
INSERT OR IGNORE INTO subject_grade (subject_id, grade, full_score, counts_to_total, is_active, sort_order)
SELECT id, 8,  70, 1, 1,  60 FROM subject WHERE code = 'politics';
-- 初二历史满分 70（初三为 50），这是两学段差异最大的科目之一
INSERT OR IGNORE INTO subject_grade (subject_id, grade, full_score, counts_to_total, is_active, sort_order)
SELECT id, 8,  70, 1, 1,  70 FROM subject WHERE code = 'history';
-- 生物/地理为等级制，不计入总分
INSERT OR IGNORE INTO subject_grade (subject_id, grade, full_score, counts_to_total, is_active, sort_order)
SELECT id, 8, 100, 0, 1, 100 FROM subject WHERE code = 'biology';
INSERT OR IGNORE INTO subject_grade (subject_id, grade, full_score, counts_to_total, is_active, sort_order)
SELECT id, 8, 100, 0, 1, 110 FROM subject WHERE code = 'geography';

-- ---------- 初三字典（中考口径合计 730） ----------
INSERT OR IGNORE INTO subject_grade (subject_id, grade, full_score, counts_to_total, is_active, sort_order)
SELECT id, 9, 120, 1, 1,  10 FROM subject WHERE code = 'chinese';
INSERT OR IGNORE INTO subject_grade (subject_id, grade, full_score, counts_to_total, is_active, sort_order)
SELECT id, 9, 120, 1, 1,  20 FROM subject WHERE code = 'math';
INSERT OR IGNORE INTO subject_grade (subject_id, grade, full_score, counts_to_total, is_active, sort_order)
SELECT id, 9, 120, 1, 1,  30 FROM subject WHERE code = 'english';
INSERT OR IGNORE INTO subject_grade (subject_id, grade, full_score, counts_to_total, is_active, sort_order)
SELECT id, 9,  70, 1, 1,  40 FROM subject WHERE code = 'physics';
-- 化学为初三新增科目
INSERT OR IGNORE INTO subject_grade (subject_id, grade, full_score, counts_to_total, is_active, sort_order)
SELECT id, 9,  50, 1, 1,  45 FROM subject WHERE code = 'chemistry';
INSERT OR IGNORE INTO subject_grade (subject_id, grade, full_score, counts_to_total, is_active, sort_order)
SELECT id, 9,  70, 1, 1,  60 FROM subject WHERE code = 'politics';
INSERT OR IGNORE INTO subject_grade (subject_id, grade, full_score, counts_to_total, is_active, sort_order)
SELECT id, 9,  50, 1, 1,  70 FROM subject WHERE code = 'history';
INSERT OR IGNORE INTO subject_grade (subject_id, grade, full_score, counts_to_total, is_active, sort_order)
SELECT id, 9, 100, 1, 1,  80 FROM subject WHERE code = 'pe';
INSERT OR IGNORE INTO subject_grade (subject_id, grade, full_score, counts_to_total, is_active, sort_order)
SELECT id, 9,  30, 1, 1,  90 FROM subject WHERE code = 'lab_op';

-- ---------- 视图改为按学段取满分 ----------
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
  COALESCE(SUM(CASE WHEN COALESCE(sg.counts_to_total, sub.counts_to_total) = 1 AND s.is_absent = 0
                    THEN s.score END), 0)     AS total_score,
  COALESCE(SUM(CASE WHEN COALESCE(sg.counts_to_total, sub.counts_to_total) = 1 AND s.is_absent = 0
                    THEN COALESCE(sg.full_score, sub.full_score) END), 0) AS entered_full_score
FROM exam e
LEFT JOIN exam_score s   ON s.exam_id   = e.id
LEFT JOIN subject    sub ON sub.id      = s.subject_id
LEFT JOIN subject_grade sg ON sg.subject_id = s.subject_id AND sg.grade = e.grade
GROUP BY e.id;

INSERT OR IGNORE INTO schema_version (version, description) VALUES (4, 'subject_grade: 按学段的科目字典 + 视图按学段取满分');
