-- 003: 目标院校采用线支持自定义
-- line_mode: avg3y=近三年均值（默认，保持原行为）| latest=最近一年 | custom=自定义固定值
-- custom_line: 自定义采用线（按 730 中考口径填写）；仅 line_mode='custom' 时使用
ALTER TABLE target_school ADD COLUMN line_mode TEXT NOT NULL DEFAULT 'avg3y';
ALTER TABLE target_school ADD COLUMN custom_line REAL;

INSERT OR IGNORE INTO schema_version (version, description) VALUES (3, 'target_school: line_mode + custom_line');
