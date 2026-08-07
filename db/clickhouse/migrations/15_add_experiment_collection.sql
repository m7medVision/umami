-- Experiment assignment facts. Readers select argMin(variation, (assigned_at, assignment_id))
-- so the first persisted assignment is authoritative.
CREATE TABLE umami.experiment_assignment
(
    assignment_id UUID,
    website_id UUID,
    experiment_run_id UUID,
    mutual_exclusion_group_id Nullable(UUID),
    unit_type LowCardinality(String),
    unit_key String,
    variation UInt16,
    assignment_version LowCardinality(String),
    is_binding UInt8,
    assigned_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
    PARTITION BY toYYYYMM(assigned_at)
    ORDER BY (website_id, experiment_run_id, unit_type, unit_key, assigned_at, assignment_id)
    SETTINGS index_granularity = 8192;

-- Privacy-safe continuity between an anonymous assignment key and the Visitor
-- digest established when that same tab identifies. Readers use the first
-- binding so identity changes cannot rewrite intention-to-treat history.
CREATE TABLE umami.experiment_assignment_binding
(
    binding_id UUID,
    website_id UUID,
    experiment_run_id UUID,
    session_assignment_key String,
    visitor_digest String,
    bound_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
    PARTITION BY toYYYYMM(bound_at)
    ORDER BY (
        website_id,
        experiment_run_id,
        session_assignment_key,
        bound_at,
        binding_id
    )
    SETTINGS index_granularity = 8192;

-- Exposure delivery is idempotent at the Run/Unit/Variation boundary. For a
-- Visitor Unit dedup_session_id is the zero UUID; for a Session Unit it is the
-- authoritative session_id.
CREATE TABLE umami.experiment_exposure
(
    exposure_id UUID,
    website_id UUID,
    experiment_run_id UUID,
    feature_flag_key String,
    variation UInt16,
    session_id UUID,
    unit_type LowCardinality(String),
    unit_key String,
    dedup_session_id UUID,
    idempotency_key String,
    source LowCardinality(String),
    sdk_version String,
    exposed_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(recorded_at)
    PARTITION BY toYYYYMM(exposed_at)
    ORDER BY (
        website_id,
        experiment_run_id,
        unit_type,
        unit_key,
        variation,
        dedup_session_id
    )
    SETTINGS index_granularity = 8192;

-- One replaceable aggregate per Experimental Unit is the sufficient input for
-- Beta-Binomial, Gamma-Poisson, and Bayesian-bootstrap computations.
CREATE TABLE umami.experiment_outcome_unit
(
    website_id UUID,
    experiment_run_id UUID,
    experiment_outcome_id UUID,
    variation UInt16,
    attribution_scope LowCardinality(String),
    unit_type LowCardinality(String),
    unit_key String,
    converted UInt8,
    event_count UInt64,
    value_sum Decimal(22, 4),
    first_exposure_at DateTime64(3, 'UTC'),
    first_outcome_at Nullable(DateTime64(3, 'UTC')),
    last_outcome_at Nullable(DateTime64(3, 'UTC')),
    source_data_through_at DateTime64(3, 'UTC'),
    aggregation_version UInt64,
    computed_at DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(aggregation_version)
    PARTITION BY toYYYYMM(first_exposure_at)
    ORDER BY (
        website_id,
        experiment_run_id,
        experiment_outcome_id,
        attribution_scope,
        unit_type,
        unit_key,
        variation
    )
    SETTINGS index_granularity = 8192;

-- Append-only diagnostic counters. Diagnostic rows intentionally contain no
-- Unit key or Visitor digest.
CREATE TABLE umami.experiment_diagnostic
(
    diagnostic_id UUID,
    website_id UUID,
    experiment_run_id UUID,
    diagnostic_type LowCardinality(String),
    reason LowCardinality(String),
    count UInt64,
    occurred_at DateTime64(3, 'UTC')
)
ENGINE = MergeTree
    PARTITION BY toYYYYMM(occurred_at)
    ORDER BY (
        website_id,
        experiment_run_id,
        diagnostic_type,
        toStartOfDay(occurred_at),
        occurred_at,
        diagnostic_id
    )
    SETTINGS index_granularity = 8192;

-- A tombstone immediately suppresses reads while synchronous mutations remove
-- matching Visitor facts and anonymous Session facts linked by a binding.
CREATE TABLE umami.experiment_privacy_tombstone
(
    tombstone_id UUID,
    website_id UUID,
    visitor_digest String,
    identity_key_version LowCardinality(String),
    identity_era LowCardinality(String),
    deleted_at DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(deleted_at)
    PARTITION BY toYYYYMM(deleted_at)
    ORDER BY (website_id, visitor_digest, identity_key_version, identity_era)
    SETTINGS index_granularity = 8192;
