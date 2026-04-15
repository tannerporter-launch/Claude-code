CREATE TABLE IF NOT EXISTS client_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name TEXT,
    linkedin_industry_self_reported TEXT,
    employee_count INTEGER,
    has_director_of_sales BOOLEAN,
    decision_maker_titles JSONB DEFAULT '[]'::jsonb,
    linkedin_keywords JSONB DEFAULT '[]'::jsonb,
    is_best_client BOOLEAN DEFAULT false,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_profiles_company_name ON client_profiles (company_name);
CREATE INDEX IF NOT EXISTS idx_client_profiles_is_best_client ON client_profiles (is_best_client);
