-- ============================================================
-- StudyLog v1.1 初始化迁移
-- 覆盖《02-开发手册.md》4.3 节 DDL 与 4.5 节种子数据
-- ============================================================

-- 000 迁移版本表
CREATE TABLE IF NOT EXISTS schema_version (
  version     INTEGER PRIMARY KEY,
  description TEXT    NOT NULL DEFAULT '',
  applied_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 001 科目字典（full_score 固定为中考口径满分）
CREATE TABLE subject (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT    NOT NULL UNIQUE,
  name            TEXT    NOT NULL,
  full_score      REAL    NOT NULL DEFAULT 100,
  score_mode      TEXT    NOT NULL DEFAULT 'score'
                          CHECK (score_mode IN ('score','grade')),
  counts_to_total INTEGER NOT NULL DEFAULT 1
                          CHECK (counts_to_total IN (0,1)),
  start_grade     INTEGER NOT NULL DEFAULT 7
                          CHECK (start_grade IN (7,8,9)),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1
                          CHECK (is_active IN (0,1)),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_subject_active_sort ON subject(is_active, sort_order);

-- 002 考试（含总分班级/年级排名与人数）
CREATE TABLE exam (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  exam_type  TEXT    NOT NULL,
  exam_date  TEXT    NOT NULL,
  grade      INTEGER NOT NULL DEFAULT 9 CHECK (grade IN (7,8,9)),
  term       TEXT,
  status     TEXT    NOT NULL DEFAULT 'confirmed'
                     CHECK (status IN ('draft','confirmed')),
  source     TEXT    NOT NULL DEFAULT 'manual'
                     CHECK (source IN ('manual','ai_import')),
  remark     TEXT,
  class_rank  INTEGER CHECK (class_rank  IS NULL OR class_rank  >= 1),
  class_size  INTEGER CHECK (class_size  IS NULL OR class_size  >= 1),
  grade_rank  INTEGER CHECK (grade_rank  IS NULL OR grade_rank  >= 1),
  grade_size  INTEGER CHECK (grade_size  IS NULL OR grade_size  >= 1),
  created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  CONSTRAINT ck_class_rank CHECK (class_rank IS NULL OR class_size IS NULL OR class_rank <= class_size),
  CONSTRAINT ck_grade_rank CHECK (grade_rank IS NULL OR grade_size IS NULL OR grade_rank <= grade_size)
);
CREATE INDEX idx_exam_date        ON exam(exam_date DESC);
CREATE INDEX idx_exam_type_date   ON exam(exam_type, exam_date DESC);
CREATE INDEX idx_exam_status_date ON exam(status, exam_date DESC);

-- 003 考试成绩（满分固定，不存快照；单科排名可选）
CREATE TABLE exam_score (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id     INTEGER NOT NULL REFERENCES exam(id)    ON DELETE CASCADE,
  subject_id  INTEGER NOT NULL REFERENCES subject(id) ON DELETE RESTRICT,
  score       REAL,
  grade_level TEXT    CHECK (grade_level IN ('A','B','C','D') OR grade_level IS NULL),
  is_absent   INTEGER NOT NULL DEFAULT 0 CHECK (is_absent IN (0,1)),
  class_rank  INTEGER CHECK (class_rank IS NULL OR class_rank >= 1),
  grade_rank  INTEGER CHECK (grade_rank IS NULL OR grade_rank >= 1),
  remark      TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  CONSTRAINT uq_score_exam_subject UNIQUE (exam_id, subject_id),
  CONSTRAINT ck_score_shape CHECK (
    is_absent = 1
    OR (score IS NULL AND grade_level IS NOT NULL)
    OR (score IS NOT NULL AND score >= 0)
  )
);
CREATE INDEX idx_score_exam    ON exam_score(exam_id);
CREATE INDEX idx_score_subject ON exam_score(subject_id, exam_id);

-- 004 考试类型字典
CREATE TABLE exam_type_dict (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT    NOT NULL UNIQUE,
  name       TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
);

-- 005 系统配置
CREATE TABLE app_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 006 AI 解析任务留痕
CREATE TABLE ai_parse_task (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_text    TEXT    NOT NULL,
  parsed_json TEXT,
  status      TEXT    NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','parsed','confirmed','failed')),
  error_msg   TEXT,
  model       TEXT,
  duration_ms INTEGER,
  token_usage INTEGER,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_parse_task_status_created ON ai_parse_task(status, created_at DESC);

-- 007 学情分析报告
CREATE TABLE analysis_report (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_type  TEXT    NOT NULL CHECK (scope_type IN ('exam','range')),
  scope_ref   TEXT    NOT NULL,
  exam_id     INTEGER REFERENCES exam(id) ON DELETE SET NULL,
  model       TEXT,
  data_digest TEXT,
  is_fallback INTEGER NOT NULL DEFAULT 0 CHECK (is_fallback IN (0,1)),
  content_md  TEXT    NOT NULL,
  strengths   TEXT,
  weaknesses  TEXT,
  suggestions TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_report_created ON analysis_report(created_at DESC);
CREATE INDEX idx_report_digest  ON analysis_report(data_digest);

-- 008 审计日志
CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  action     TEXT NOT NULL,
  target     TEXT,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);

-- 009 目标院校
CREATE TABLE target_school (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  short_name TEXT,
  is_target  INTEGER NOT NULL DEFAULT 1 CHECK (is_target IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  remark     TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 010 目标院校录取分数线
CREATE TABLE school_admission_score (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id        INTEGER NOT NULL REFERENCES target_school(id) ON DELETE CASCADE,
  year             INTEGER NOT NULL,
  admission_type   TEXT    NOT NULL DEFAULT '统招'
                           CHECK (admission_type IN ('统招','分配生')),
  min_score        REAL    NOT NULL CHECK (min_score >= 0),
  total_full_score REAL    NOT NULL DEFAULT 730 CHECK (total_full_score > 0),
  batch            TEXT,
  remark           TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  CONSTRAINT uq_school_year_type UNIQUE (school_id, year, admission_type)
);
CREATE INDEX idx_adm_school_year ON school_admission_score(school_id, year DESC);

-- 视图：考试汇总
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
                    THEN s.score END), 0)     AS total_score
FROM exam e
LEFT JOIN exam_score s   ON s.exam_id = e.id
LEFT JOIN subject    sub ON sub.id    = s.subject_id
GROUP BY e.id;

-- ============================================================
-- 种子数据
-- ============================================================

INSERT OR IGNORE INTO subject (code, name, full_score, score_mode, counts_to_total, start_grade, sort_order, is_active) VALUES
  ('chinese',   '语文',           120, 'score', 1, 7,  10, 1),
  ('math',      '数学',           120, 'score', 1, 7,  20, 1),
  ('english',   '英语',           120, 'score', 1, 7,  30, 1),
  ('physics',   '物理',            70, 'score', 1, 8,  40, 1),
  ('chemistry', '化学',            50, 'score', 1, 9,  50, 1),
  ('politics',  '道德与法治',       70, 'score', 1, 7,  60, 1),
  ('history',   '历史',            50, 'score', 1, 7,  70, 1),
  ('pe',        '体育',           100, 'score', 1, 7,  80, 1),
  ('lab_op',    '理化生实验操作',    30, 'score', 1, 9,  90, 1),
  ('biology',   '生物',           100, 'grade', 0, 7, 100, 1),
  ('geography', '地理',           100, 'grade', 0, 7, 110, 1);

INSERT OR IGNORE INTO exam_type_dict (code, name, sort_order, is_active) VALUES
  ('unit',    '单元测',       10, 1),
  ('week',    '周测',         20, 1),
  ('month',   '月考',         30, 1),
  ('midterm', '期中考试',     40, 1),
  ('final',   '期末考试',     50, 1),
  ('mock',    '模拟考',       60, 1),
  ('sport',   '体育测试',     70, 1),
  ('lab',     '实验操作测试', 80, 1),
  ('other',   '其他',         90, 1);

INSERT OR IGNORE INTO target_school (name, short_name, is_target, sort_order, remark) VALUES
  ('郑州外国语学校', '郑外',    1, 10, '省级示范性高中'),
  ('郑州市第一中学', '郑州一中', 1, 20, '省级示范性高中'),
  ('河南省实验中学', '省实验',   1, 30, '省级示范性高中');

INSERT OR IGNORE INTO school_admission_score (school_id, year, admission_type, min_score, total_full_score, batch)
SELECT id, y.year, '统招', y.score, 730, '第一批次'
FROM target_school t
JOIN (
  SELECT '郑州外国语学校' AS sname, 2024 AS year, 707 AS score UNION ALL
  SELECT '郑州外国语学校', 2025, 699 UNION ALL
  SELECT '郑州外国语学校', 2026, 699 UNION ALL
  SELECT '郑州市第一中学', 2024, 702 UNION ALL
  SELECT '郑州市第一中学', 2025, 694 UNION ALL
  SELECT '郑州市第一中学', 2026, 697 UNION ALL
  SELECT '河南省实验中学', 2024, 702 UNION ALL
  SELECT '河南省实验中学', 2025, 694 UNION ALL
  SELECT '河南省实验中学', 2026, 695
) y ON y.sname = t.name;

INSERT OR IGNORE INTO app_config (key, value) VALUES
  ('stats.avgWindow', '8'),
  ('stats.declineThreshold', '3'),
  ('stats.gradeEquivalentChart', 'false'),
  ('export.defaultFormat', 'xlsx'),
  ('subject_alias', '{"chinese":["语文","语","语文科"],"math":["数学","数","数学科"],"english":["英语","英","外语","英语科"],"physics":["物理","物"],"chemistry":["化学","化"],"politics":["道德与法治","道法","政治","思想品德","道德法治"],"history":["历史","史"],"biology":["生物","生物学"],"geography":["地理","地"],"pe":["体育","体育与健康","体"],"lab_op":["理化生实验操作","实验操作","实验","理化生实验"]}');

INSERT OR IGNORE INTO schema_version (version, description) VALUES (1, 'init schema + seed');
