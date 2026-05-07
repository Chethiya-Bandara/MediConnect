-- Performance indexes — NFR-4.1
-- Run this once in your Supabase SQL editor.
-- These indexes support the most frequent filter patterns in common dashboard queries.

-- Appointments: patient and doctor lookups, time ordering
CREATE INDEX IF NOT EXISTS idx_appointments_patient_id   ON appointments (patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor_id    ON appointments (doctor_id);
CREATE INDEX IF NOT EXISTS idx_appointments_start_time   ON appointments (start_time);
CREATE INDEX IF NOT EXISTS idx_appointments_status       ON appointments (status);

-- Encounters: patient and doctor lookups, recency ordering
CREATE INDEX IF NOT EXISTS idx_encounters_patient_id     ON encounters (patient_id);
CREATE INDEX IF NOT EXISTS idx_encounters_doctor_id      ON encounters (doctor_id);
CREATE INDEX IF NOT EXISTS idx_encounters_created_at     ON encounters (created_at DESC);

-- Prescriptions: patient lookups, recency ordering
CREATE INDEX IF NOT EXISTS idx_prescriptions_patient_id  ON prescriptions (patient_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_doctor_id   ON prescriptions (doctor_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_created_at  ON prescriptions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prescriptions_status      ON prescriptions (status);

-- Audit logs: timestamp ordering and entity filtering
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp      ON audit_logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity         ON audit_logs (entity);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id        ON audit_logs (user_id);

-- Anomaly flags: already indexed via create_anomaly_flags.sql
