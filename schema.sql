-- ═══════════════════════════════════════════════════════════════════════════════
-- Kumon Check-In — Database Schema
-- Run this in your Supabase project → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════════════════════

-- One row per Kumon franchise location (the "tenant")
CREATE TABLE IF NOT EXISTS centers (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT        NOT NULL,
  owner_name      TEXT        NOT NULL,
  email           TEXT        UNIQUE NOT NULL,
  password_hash   TEXT        NOT NULL,
  alert_emails    TEXT[]      NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Students enrolled at a center
CREATE TABLE IF NOT EXISTS students (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id       UUID        NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  default_subject TEXT        CHECK (default_subject IN ('Math', 'Reading', 'Both')),
  parent_email    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(center_id, name)
);

-- Per-center time limit configuration
CREATE TABLE IF NOT EXISTS settings (
  center_id           UUID    PRIMARY KEY REFERENCES centers(id) ON DELETE CASCADE,
  math_limit_min      INTEGER NOT NULL DEFAULT 35,
  reading_limit_min   INTEGER NOT NULL DEFAULT 35,
  both_limit_min      INTEGER NOT NULL DEFAULT 70
);

-- Currently checked-in students (live state)
CREATE TABLE IF NOT EXISTS active_checkins (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  center_id     UUID        NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  subject       TEXT        NOT NULL CHECK (subject IN ('Math', 'Reading', 'Both')),
  check_in_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  alerted       BOOLEAN     NOT NULL DEFAULT FALSE,
  UNIQUE(student_id)  -- a student can only be checked in once at a time
);

-- Full session history log
CREATE TABLE IF NOT EXISTS sessions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      UUID        REFERENCES students(id) ON DELETE SET NULL,
  center_id       UUID        NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  student_name    TEXT        NOT NULL,
  subject         TEXT        NOT NULL,
  check_in_time   TIMESTAMPTZ NOT NULL,
  check_out_time  TIMESTAMPTZ,
  elapsed_min     INTEGER
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_students_center    ON students(center_id);
CREATE INDEX IF NOT EXISTS idx_checkins_center    ON active_checkins(center_id);
CREATE INDEX IF NOT EXISTS idx_sessions_center    ON sessions(center_id);
CREATE INDEX IF NOT EXISTS idx_sessions_checkin   ON sessions(check_in_time);
