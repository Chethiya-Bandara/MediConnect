-- Migration: create anomaly_flags table (NFR-1.9)
-- Run this once in your Supabase SQL editor before deploying the anomaly detector.

CREATE TABLE IF NOT EXISTS anomaly_flags (
    id             BIGSERIAL    PRIMARY KEY,
    event_type     TEXT         NOT NULL,
    source_ip      TEXT,
    event_count    INTEGER      NOT NULL,
    window_seconds INTEGER      NOT NULL,
    threshold      INTEGER      NOT NULL,
    flagged_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    resolved_at    TIMESTAMPTZ,
    resolved_by    TEXT,
    status         TEXT         NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'resolved', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS idx_anomaly_flags_status     ON anomaly_flags (status);
CREATE INDEX IF NOT EXISTS idx_anomaly_flags_flagged_at ON anomaly_flags (flagged_at DESC);
CREATE INDEX IF NOT EXISTS idx_anomaly_flags_source_ip  ON anomaly_flags (source_ip);
