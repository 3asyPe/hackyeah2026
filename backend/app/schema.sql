-- ERD v1 mirrored to SQLite. PG ENUM -> TEXT + CHECK, uuid/timestamptz -> TEXT, numeric -> REAL, bytea -> BLOB.

CREATE TABLE IF NOT EXISTS incident (
    id              TEXT PRIMARY KEY NOT NULL,
    state           TEXT NOT NULL CHECK (state IN ('provisional','active','merged')),
    merged_into_id  TEXT NULL REFERENCES incident(id),
    category        TEXT NULL CHECK (category IN ('fire_smoke','road_hazard','infrastructure_damage','waste_pollution','other')),
    latitude        REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude       REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    incident_time   TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    CHECK (state <> 'active' OR category IS NOT NULL),
    CHECK ((state = 'merged') = (merged_into_id IS NOT NULL)),
    CHECK (merged_into_id IS NULL OR merged_into_id <> id)
);

CREATE TABLE IF NOT EXISTS report (
    id                     TEXT PRIMARY KEY NOT NULL,
    submission_key         TEXT NOT NULL UNIQUE,
    submission_hash        BLOB NOT NULL CHECK (length(submission_hash) = 32),
    receipt_token_hash     BLOB NOT NULL CHECK (length(receipt_token_hash) = 32),
    incident_id            TEXT NOT NULL REFERENCES incident(id),
    current_assessment_id  TEXT NULL,
    current_review_id      TEXT NULL,
    status                 TEXT NOT NULL CHECK (status IN ('processing','in_review','published','critical','rejected','failed')),
    description            TEXT NULL,
    photo_path             TEXT NULL,
    photo_media_type       TEXT NULL CHECK (photo_media_type IN ('image/jpeg','image/png','image/webp')),
    photo_size_bytes       INTEGER NULL,
    latitude               REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude              REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    incident_time          TEXT NOT NULL,
    submitted_at           TEXT NOT NULL,
    updated_at             TEXT NOT NULL,
    processing_started_at  TEXT NULL,
    review_reason          TEXT NULL,
    CHECK (
        (photo_path IS NULL AND photo_media_type IS NULL AND photo_size_bytes IS NULL)
        OR (photo_path IS NOT NULL AND photo_media_type IS NOT NULL AND photo_size_bytes IS NOT NULL AND photo_size_bytes > 0)
    ),
    FOREIGN KEY (id, current_assessment_id) REFERENCES assessment(report_id, id),
    FOREIGN KEY (id, current_review_id) REFERENCES review_decision(report_id, id)
);

CREATE TABLE IF NOT EXISTS assessment (
    id                          TEXT PRIMARY KEY NOT NULL,
    report_id                   TEXT NOT NULL REFERENCES report(id),
    attempt_no                  INTEGER NOT NULL CHECK (attempt_no > 0),
    outcome                     TEXT NOT NULL CHECK (outcome IN ('succeeded','failed')),
    category                    TEXT NULL CHECK (category IN ('fire_smoke','road_hazard','infrastructure_damage','waste_pollution','other')),
    severity                    TEXT NULL CHECK (severity IN ('low','medium','high')),
    urgency                     TEXT NULL CHECK (urgency IN ('low','medium','high')),
    severity_low_confidence     REAL NULL CHECK (severity_low_confidence BETWEEN 0 AND 100),
    severity_medium_confidence  REAL NULL CHECK (severity_medium_confidence BETWEEN 0 AND 100),
    severity_high_confidence    REAL NULL CHECK (severity_high_confidence BETWEEN 0 AND 100),
    urgency_low_confidence      REAL NULL CHECK (urgency_low_confidence BETWEEN 0 AND 100),
    urgency_medium_confidence   REAL NULL CHECK (urgency_medium_confidence BETWEEN 0 AND 100),
    urgency_high_confidence     REAL NULL CHECK (urgency_high_confidence BETWEEN 0 AND 100),
    photo_description_match     TEXT NULL CHECK (photo_description_match IN ('matches','mismatches','inconclusive','not_applicable')),
    scene_plausibility          TEXT NULL CHECK (scene_plausibility IN ('no_obvious_concerns','suspicious','inconclusive','not_applicable')),
    time_consistency            TEXT NULL CHECK (time_consistency IN ('no_obvious_concerns','suspicious','inconclusive','not_applicable')),
    manipulation_concerns       TEXT NULL CHECK (manipulation_concerns IN ('no_obvious_concerns','suspicious','inconclusive','not_applicable')),
    explanation                 TEXT NULL,
    error_code                  TEXT NULL,
    error_message               TEXT NULL,
    model                       TEXT NOT NULL,
    prompt_version              TEXT NOT NULL,
    started_at                  TEXT NOT NULL,
    completed_at                TEXT NOT NULL,
    UNIQUE (report_id, attempt_no),
    UNIQUE (report_id, id),
    -- confidence triples: all set or all NULL
    CHECK ((severity_low_confidence IS NULL) = (severity_medium_confidence IS NULL)
       AND (severity_low_confidence IS NULL) = (severity_high_confidence IS NULL)),
    CHECK ((urgency_low_confidence IS NULL) = (urgency_medium_confidence IS NULL)
       AND (urgency_low_confidence IS NULL) = (urgency_high_confidence IS NULL)),
    -- failed: error required, results NULL
    CHECK (outcome <> 'failed' OR (
        error_code IS NOT NULL AND error_message IS NOT NULL
        AND category IS NULL AND severity IS NULL AND urgency IS NULL
        AND severity_low_confidence IS NULL AND urgency_low_confidence IS NULL
        AND photo_description_match IS NULL AND scene_plausibility IS NULL
        AND time_consistency IS NULL AND manipulation_concerns IS NULL AND explanation IS NULL)),
    -- succeeded: check applicability results + explanation required, no error
    CHECK (outcome <> 'succeeded' OR (
        photo_description_match IS NOT NULL AND scene_plausibility IS NOT NULL
        AND time_consistency IS NOT NULL AND manipulation_concerns IS NOT NULL
        AND explanation IS NOT NULL AND error_code IS NULL AND error_message IS NULL))
);

CREATE TABLE IF NOT EXISTS review_decision (
    id              TEXT PRIMARY KEY NOT NULL,
    report_id       TEXT NOT NULL REFERENCES report(id),
    assessment_id   TEXT NULL,
    action          TEXT NOT NULL CHECK (action IN ('approve','reject')),
    final_category  TEXT NULL CHECK (final_category IN ('fire_smoke','road_hazard','infrastructure_damage','waste_pollution','other')),
    final_severity  TEXT NULL CHECK (final_severity IN ('low','medium','high')),
    final_urgency   TEXT NULL CHECK (final_urgency IN ('low','medium','high')),
    operator_label  TEXT NOT NULL CHECK (length(trim(operator_label)) > 0),
    comment         TEXT NULL,
    decided_at      TEXT NOT NULL,
    UNIQUE (report_id, id),
    FOREIGN KEY (report_id, assessment_id) REFERENCES assessment(report_id, id),
    CHECK (action <> 'approve' OR (final_category IS NOT NULL AND final_severity IS NOT NULL AND final_urgency IS NOT NULL)),
    CHECK (action <> 'reject' OR (final_category IS NULL AND final_severity IS NULL AND final_urgency IS NULL))
);

CREATE TABLE IF NOT EXISTS notification_simulation (
    report_id        TEXT PRIMARY KEY NOT NULL REFERENCES report(id),
    incident_id      TEXT NOT NULL REFERENCES incident(id),
    radius_m         INTEGER NOT NULL CHECK (radius_m > 0),
    recipient_count  INTEGER NOT NULL CHECK (recipient_count >= 0),
    simulated_at     TEXT NOT NULL
);

-- §10 indexes
CREATE INDEX IF NOT EXISTS ix_report_incident_status ON report(incident_id, status);
CREATE INDEX IF NOT EXISTS ix_report_status_submitted ON report(status, submitted_at);
CREATE INDEX IF NOT EXISTS ix_incident_active_cat_time ON incident(category, incident_time) WHERE state = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS ux_assessment_report_attempt ON assessment(report_id, attempt_no);
CREATE INDEX IF NOT EXISTS ix_review_report_decided ON review_decision(report_id, decided_at);

-- §8.3 evidence immutability
CREATE TRIGGER IF NOT EXISTS trg_report_evidence_immutable
BEFORE UPDATE OF submission_key, submission_hash, receipt_token_hash, description, photo_path,
                 photo_media_type, photo_size_bytes, latitude, longitude, incident_time, submitted_at ON report
WHEN OLD.submission_key IS NOT NEW.submission_key OR OLD.submission_hash IS NOT NEW.submission_hash
  OR OLD.receipt_token_hash IS NOT NEW.receipt_token_hash OR OLD.description IS NOT NEW.description
  OR OLD.photo_path IS NOT NEW.photo_path OR OLD.photo_media_type IS NOT NEW.photo_media_type
  OR OLD.photo_size_bytes IS NOT NEW.photo_size_bytes OR OLD.latitude IS NOT NEW.latitude
  OR OLD.longitude IS NOT NEW.longitude OR OLD.incident_time IS NOT NEW.incident_time
  OR OLD.submitted_at IS NOT NEW.submitted_at
BEGIN
    SELECT RAISE(ABORT, 'report evidence is immutable');
END;

-- Incident anchor (coordinates/time) is preserved
CREATE TRIGGER IF NOT EXISTS trg_incident_anchor_immutable
BEFORE UPDATE OF latitude, longitude, incident_time, created_at ON incident
WHEN OLD.latitude IS NOT NEW.latitude OR OLD.longitude IS NOT NEW.longitude
  OR OLD.incident_time IS NOT NEW.incident_time OR OLD.created_at IS NOT NEW.created_at
BEGIN
    SELECT RAISE(ABORT, 'incident anchor is immutable');
END;
