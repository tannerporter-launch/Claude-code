CREATE TABLE IF NOT EXISTS calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fireflies_id TEXT UNIQUE NOT NULL,
    fireflies_url TEXT,
    call_type TEXT,
    meeting_title TEXT,
    meeting_date TIMESTAMPTZ,
    duration_minutes INTEGER,
    host_email TEXT,
    attendee_emails JSONB DEFAULT '[]'::jsonb,
    prospect_name TEXT,
    company_name TEXT,
    transcript_full TEXT,
    transcript_sentences JSONB DEFAULT '[]'::jsonb,
    summary_fireflies TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_calls_fireflies_id ON calls (fireflies_id);
CREATE INDEX IF NOT EXISTS idx_calls_meeting_date ON calls (meeting_date);
CREATE INDEX IF NOT EXISTS idx_calls_company_name ON calls (company_name);
