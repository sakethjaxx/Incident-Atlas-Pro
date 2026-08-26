-- Sprint 3: Knowledge Graph schema
-- Adds graph_nodes and graph_edges tables.
--
-- Design decisions:
--   - graph_nodes UNIQUE(node_type, name) deduplicates entities across incidents.
--   - graph_edges.incident_id CASCADE DELETE: removing an incident removes its edges.
--   - graph_edges.from_node_id / to_node_id RESTRICT: node rows cannot be deleted
--     while edges reference them — callers must remove edges first.
--   - graph_edges.evidence_section_id RESTRICT: mandatory per DATA_MODEL.md (Sprint 4
--     Q&A citations); prevents edges from landing without an evidence anchor.
--   - All statements use IF NOT EXISTS so the migration is safely re-runnable.

-- ── graph_nodes ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "graph_nodes" (
    "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
    "node_type"   TEXT        NOT NULL,
    "name"        TEXT        NOT NULL,
    "attrs_json"  JSONB,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "graph_nodes_pkey" PRIMARY KEY ("id"),

    -- Sprint 3 node_type whitelist check (checked at DB layer for safety)
    CONSTRAINT "graph_nodes_node_type_check"
        CHECK ("node_type" IN ('service', 'symptom', 'root_cause', 'fix')),

    -- Deduplication: same entity type + name is one node
    CONSTRAINT "graph_nodes_node_type_name_key"
        UNIQUE ("node_type", "name")
);

-- Index for fast lookup by type (used by GET /graph/patterns)
CREATE INDEX IF NOT EXISTS "graph_nodes_node_type_idx"
    ON "graph_nodes" ("node_type");

-- ── graph_edges ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "graph_edges" (
    "id"                  UUID        NOT NULL DEFAULT gen_random_uuid(),
    "from_node_id"        UUID        NOT NULL,
    "to_node_id"          UUID        NOT NULL,
    "rel_type"            TEXT        NOT NULL,
    "incident_id"         UUID        NOT NULL,
    "evidence_section_id" UUID        NOT NULL,
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "graph_edges_pkey" PRIMARY KEY ("id"),

    -- Sprint 3 rel_type whitelist
    CONSTRAINT "graph_edges_rel_type_check"
        CHECK ("rel_type" IN ('AFFECTS', 'HAS_SYMPTOM', 'CAUSED_BY', 'RESOLVED_BY')),

    -- FK: nodes must exist; RESTRICT prevents node deletion while edges reference them
    CONSTRAINT "graph_edges_from_node_id_fkey"
        FOREIGN KEY ("from_node_id")
        REFERENCES "graph_nodes" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,

    CONSTRAINT "graph_edges_to_node_id_fkey"
        FOREIGN KEY ("to_node_id")
        REFERENCES "graph_nodes" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,

    -- FK: incident CASCADE — remove incident → remove its edges
    CONSTRAINT "graph_edges_incident_id_fkey"
        FOREIGN KEY ("incident_id")
        REFERENCES "incidents" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE,

    -- FK: evidence section RESTRICT — mandatory citation anchor; cannot be lost silently
    CONSTRAINT "graph_edges_evidence_section_id_fkey"
        FOREIGN KEY ("evidence_section_id")
        REFERENCES "sections" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Index for traversal lookups (GET /graph/neighbors from_node_id)
CREATE INDEX IF NOT EXISTS "graph_edges_from_node_id_idx"
    ON "graph_edges" ("from_node_id");

-- Index for reverse traversal (incoming edges to a node)
CREATE INDEX IF NOT EXISTS "graph_edges_to_node_id_idx"
    ON "graph_edges" ("to_node_id");

-- Index for incident-scoped edge queries (backfill, reindex by incident)
CREATE INDEX IF NOT EXISTS "graph_edges_incident_id_idx"
    ON "graph_edges" ("incident_id");
