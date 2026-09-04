-- W6-032: Q&A feedback loop — thumbs up/down stored against the audit log row.
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "feedback_helpful" BOOLEAN;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "feedback_at" TIMESTAMP(3);
