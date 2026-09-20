-- ============================================================
-- 寺院僧人挂单与常住管理平台 - PostgreSQL Schema
-- ============================================================

-- ---------- 寮房与床位 ----------
CREATE TABLE IF NOT EXISTS rooms (
  id          BIGSERIAL PRIMARY KEY,
  room_no     VARCHAR(32) NOT NULL UNIQUE,                 -- 房间号，如 东单-101
  building    VARCHAR(64),                                 -- 楼栋/方位，如 东单寮、西单寮
  remark      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS beds (
  id          BIGSERIAL PRIMARY KEY,
  room_id     BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  bed_no      VARCHAR(32) NOT NULL,                        -- 床位号，如 1 号床
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, bed_no)
);

-- ---------- 挂单登记（云游僧人） ----------
CREATE TABLE IF NOT EXISTS registrations (
  id                  BIGSERIAL PRIMARY KEY,
  dharma_name         VARCHAR(64)  NOT NULL,               -- 法名
  home_monastery      VARCHAR(128) NOT NULL,               -- 出家寺庙
  ordination_no       VARCHAR(64)  NOT NULL,               -- 戒牒编号
  arrival_date        DATE NOT NULL,                       -- 到寺日期
  planned_stay_days   INTEGER NOT NULL CHECK (planned_stay_days > 0), -- 预计住几天
  phone               VARCHAR(32),                         -- 联系电话（选填）
  bed_id              BIGINT REFERENCES beds(id),          -- 安排的床位
  status              VARCHAR(16) NOT NULL DEFAULT '挂单中'
                        CHECK (status IN ('挂单中','已退单','转常住')),
  check_in_date       DATE,                                -- 实际入住（安排床位）日期
  leave_date          DATE,                                -- 退单日期
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reg_status ON registrations(status);
-- 一张床位同一时间只能有一位在住僧人
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_bed
  ON registrations(bed_id) WHERE status = '挂单中';

-- ---------- 常住考察期 ----------
CREATE TABLE IF NOT EXISTS probation (
  id                  BIGSERIAL PRIMARY KEY,
  registration_id     BIGINT NOT NULL REFERENCES registrations(id),
  start_date          DATE NOT NULL,                       -- 考察开始日期
  end_date            DATE NOT NULL,                       -- 考察结束日期（3-6 个月）
  status              VARCHAR(16) NOT NULL DEFAULT '考察中'
                        CHECK (status IN ('考察中','通过','未通过')),
  result_note         TEXT,                                -- 考察评语
  decided_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prob_status ON probation(status);

-- ---------- 常住僧人档案 ----------
CREATE TABLE IF NOT EXISTS residents (
  id                BIGSERIAL PRIMARY KEY,
  registration_id   BIGINT REFERENCES registrations(id),
  dharma_name       VARCHAR(64) NOT NULL,                  -- 法名
  generation_name   VARCHAR(64),                           -- 字辈/派字，如 隆字辈、宗字辈
  tonsure_master    VARCHAR(64),                           -- 剃度师
  ordination_date   DATE,                                  -- 受戒时间
  ordination_place  VARCHAR(128),                          -- 戒场
  position          VARCHAR(32) NOT NULL DEFAULT '清众'
                      CHECK (position IN ('住持','知客','维那','典座','僧值','寮元','衣钵','书记','汤药','清众')),
  ordination_no     VARCHAR(64),                           -- 戒牒编号
  phone             VARCHAR(32),
  status            VARCHAR(16) NOT NULL DEFAULT '常住'
                      CHECK (status IN ('常住','外出','退住')),
  karma_date        DATE,                                  -- 羯磨仪式日期（成为常住）
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_res_status ON residents(status);

-- ---------- 早晚课考勤 ----------
-- session: morning=早课, evening=晚课
CREATE TABLE IF NOT EXISTS attendance (
  id          BIGSERIAL PRIMARY KEY,
  session     VARCHAR(8) NOT NULL CHECK (session IN ('morning','evening')),
  attend_date DATE NOT NULL,
  person_type VARCHAR(16) NOT NULL CHECK (person_type IN ('registration','resident')),
  reg_id      BIGINT REFERENCES registrations(id) ON DELETE CASCADE,
  resident_id BIGINT REFERENCES residents(id) ON DELETE CASCADE,
  status      VARCHAR(8) NOT NULL CHECK (status IN ('present','absent','leave')),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (person_type = 'registration' AND reg_id IS NOT NULL AND resident_id IS NULL) OR
    (person_type = 'resident' AND resident_id IS NOT NULL AND reg_id IS NULL)
  )
);
-- 同人同日同课只允许一条（reg_id 与 resident_id 互斥，NULL 互不相同不影响判重）
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance
  ON attendance (attend_date, session, person_type, reg_id, resident_id);
CREATE INDEX IF NOT EXISTS idx_att_date ON attendance(attend_date);

-- ---------- 视图：在寺人员（挂单中 + 常住）累计缺勤统计 ----------
CREATE OR REPLACE VIEW v_absence_summary AS
SELECT
  p.person_type,
  p.person_id,
  p.dharma_name,
  COUNT(a.id) FILTER (WHERE a.status = 'absent')::int AS absent_count,
  MAX(a.attend_date) FILTER (WHERE a.status = 'absent') AS last_absent_date
FROM (
  SELECT 'registration' AS person_type, id AS person_id, dharma_name
  FROM registrations WHERE status = '挂单中'
  UNION ALL
  SELECT 'resident', id, dharma_name
  FROM residents WHERE status = '常住'
) p
LEFT JOIN attendance a
  ON a.person_type = p.person_type
 AND ((a.person_type = 'registration' AND a.reg_id = p.person_id)
   OR (a.person_type = 'resident' AND a.resident_id = p.person_id))
GROUP BY p.person_type, p.person_id, p.dharma_name;

-- ---------- 视图：考勤提醒（缺勤累计 >= 3 次） ----------
CREATE OR REPLACE VIEW v_absence_alerts AS
SELECT * FROM v_absence_summary WHERE absent_count >= 3;

-- ---------- 视图：挂单超期（到寺日期 + 预计天数 < 今天，仍挂单中） ----------
CREATE OR REPLACE VIEW v_overdue_registrations AS
SELECT id, dharma_name, arrival_date, planned_stay_days,
       (arrival_date + (planned_stay_days || ' days')::interval)::date AS due_date,
       CURRENT_DATE - (arrival_date + (planned_stay_days || ' days')::interval)::date AS overdue_days
FROM registrations
WHERE status = '挂单中'
  AND arrival_date + (planned_stay_days || ' days')::interval < CURRENT_DATE;

-- ---------- 视图：考察即将到期（7 天内）或已逾期未羯磨 ----------
CREATE OR REPLACE VIEW v_probation_due AS
SELECT pr.id, pr.registration_id, r.dharma_name, pr.start_date, pr.end_date,
       pr.end_date - CURRENT_DATE AS days_left
FROM probation pr
JOIN registrations r ON r.id = pr.registration_id
WHERE pr.status = '考察中';
