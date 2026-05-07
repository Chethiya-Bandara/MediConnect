-- NFR-7.5 investigation mode: add organisation_id to audit_logs
-- Run once in the Supabase SQL editor.

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS organisation_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_audit_logs_organisation_id
  ON audit_logs (organisation_id);
