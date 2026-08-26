-- Sprint 4: Evaluation and audit schema.
-- Adds DB-backed eval queries, immutable eval run metadata, and safe audit logs.

CREATE TABLE IF NOT EXISTS "qa_queries" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "expected_incident_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "expected_section_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "expected_graph_node_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "query_type" TEXT NOT NULL,
    "critical" BOOLEAN NOT NULL DEFAULT FALSE,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "query_set_version" TEXT NOT NULL,
    "metadata_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qa_queries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "qa_queries_query_type_check"
        CHECK ("query_type" IN ('search', 'graph', 'qa', 'mixed'))
);

CREATE INDEX IF NOT EXISTS "qa_queries_query_set_version_idx"
    ON "qa_queries" ("query_set_version");

CREATE INDEX IF NOT EXISTS "qa_queries_critical_idx"
    ON "qa_queries" ("critical");

CREATE INDEX IF NOT EXISTS "qa_queries_tags_idx"
    ON "qa_queries" USING GIN ("tags");

CREATE TABLE IF NOT EXISTS "eval_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "status" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "query_set_version" TEXT NOT NULL,
    "git_sha" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "retrieval_config_json" JSONB NOT NULL,
    "graph_config_json" JSONB NOT NULL,
    "prompt_version" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "model_version" TEXT,
    "model_config_json" JSONB,
    "thresholds_json" JSONB NOT NULL,
    "metrics_json" JSONB NOT NULL,
    "failures_json" JSONB NOT NULL,
    "artifact_path" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eval_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "eval_runs_status_check"
        CHECK ("status" IN ('passed', 'failed', 'error')),
    CONSTRAINT "eval_runs_mode_check"
        CHECK ("mode" IN ('fixture', 'live'))
);

CREATE INDEX IF NOT EXISTS "eval_runs_finished_at_idx"
    ON "eval_runs" ("finished_at");

CREATE INDEX IF NOT EXISTS "eval_runs_query_set_version_idx"
    ON "eval_runs" ("query_set_version");

CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "request_id" TEXT,
    "action" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_hash" TEXT,
    "ip_hash" TEXT,
    "route" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "latency_ms" INTEGER,
    "prompt_version" TEXT,
    "prompt_template_hash" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "model_version" TEXT,
    "model_config_json" JSONB,
    "input_hash" TEXT,
    "output_hash" TEXT,
    "retrieved_section_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "retrieved_incident_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "refusal_code" TEXT,
    "artifact_path" TEXT,
    "metadata_json" JSONB,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx"
    ON "audit_logs" ("created_at");

CREATE INDEX IF NOT EXISTS "audit_logs_action_created_at_idx"
    ON "audit_logs" ("action", "created_at");

CREATE INDEX IF NOT EXISTS "audit_logs_request_id_idx"
    ON "audit_logs" ("request_id");
