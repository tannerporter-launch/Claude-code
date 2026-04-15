CREATE TABLE IF NOT EXISTS call_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    objections_raised JSONB DEFAULT '[]'::jsonb,
    objections_handled_well JSONB DEFAULT '[]'::jsonb,
    objection_handles_that_failed JSONB DEFAULT '[]'::jsonb,
    objection_categories JSONB DEFAULT '[]'::jsonb,
    prospect_engagement_level TEXT,
    pitch_moments_that_landed JSONB DEFAULT '[]'::jsonb,
    key_turning_point TEXT,
    buying_signals JSONB DEFAULT '[]'::jsonb,
    deal_breakers JSONB DEFAULT '[]'::jsonb,
    risk_factors JSONB DEFAULT '[]'::jsonb,
    decision_criteria JSONB DEFAULT '[]'::jsonb,
    timeline TEXT,
    competitor_strengths JSONB DEFAULT '[]'::jsonb,
    pricing_reaction TEXT,
    budget_range TEXT,
    pain_points JSONB DEFAULT '[]'::jsonb,
    urgency_level TEXT,
    non_priorities JSONB DEFAULT '[]'::jsonb,
    goals JSONB DEFAULT '[]'::jsonb,
    emotional_triggers JSONB DEFAULT '[]'::jsonb,
    team_structure TEXT,
    notable_quotes JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_insights_call_id ON call_insights (call_id);
