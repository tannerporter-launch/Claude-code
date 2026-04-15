# Sales Call Intelligence System

AI-powered sales call analysis pipeline that ingests Fireflies.ai meeting transcripts, extracts structured insights via Claude, stores everything in Supabase, and automates processing through n8n.

## Architecture

```
Fireflies.ai → n8n (every 30 min) → Supabase (calls table)
                                        ↓
                                   Claude API → Supabase (call_insights table)
                                        ↓
                                   Slack #sales (digest notification)
```

## Setup

### 1. Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Required variables:

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL (e.g., `https://xxx.supabase.co`) |
| `SUPABASE_SERVICE_KEY` | Supabase service_role JWT (Settings → API) |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude |
| `FIREFLIES_API_KEY` | Fireflies.ai API key |
| `N8N_BASE_URL` | n8n instance URL (e.g., `https://xxx.app.n8n.cloud`) |
| `N8N_API_KEY` | n8n API key (Settings → API) |
| `SLACK_BOT_TOKEN` | Slack Bot User OAuth Token (`xoxb-...`) |
| `SLACK_CHANNEL` | Slack channel for notifications (e.g., `#sales`) |

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Run Database Migrations

**Option A: Via Supabase SQL Editor (recommended)**

```bash
python run_migrations.py --print-only
```

Copy the output and paste it into the Supabase SQL Editor (Dashboard → SQL Editor → New Query → Run).

**Option B: Via psql**

```bash
python run_migrations.py --connection-string "postgresql://postgres:PASSWORD@db.YOUR-PROJECT.supabase.co:5432/postgres"
```

### 4. Import the n8n Workflow

1. Open your n8n instance
2. Click **+** → **Import from File**
3. Upload `n8n_workflows/sales_call_intelligence_pipeline.json`
4. Set these environment variables in n8n (Settings → Variables):
   - `FIREFLIES_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `ANTHROPIC_API_KEY`
   - `SLACK_BOT_TOKEN`
5. Test the workflow with a manual execution
6. Activate the 30-minute schedule once confirmed working

**n8n Workflow Name:** Sales Call Intelligence Pipeline
**Trigger:** Schedule (every 30 minutes)

## Usage

### Adding Transcripts

**Automatic (n8n):** The workflow polls Fireflies every 30 minutes and processes new transcripts automatically.

**Manual (CLI):**

```bash
# Single transcript by Fireflies ID
python ingest_fireflies.py --id <fireflies_meeting_id>

# All transcripts from the last 24 hours
python ingest_fireflies.py --batch --hours 24

# Backfill all transcripts (oldest first, rate-limited)
python ingest_fireflies.py --backfill
```

### Query Helpers

**Content from Objections** — Generate LinkedIn post hooks from top sales objections:

```bash
python query_helpers/content_from_objections.py --top 10
```

If a `brand-voice.md` or `voice-guidelines.md` file exists in the project root, it will be used to inform tone and style.

**Deal Postmortem** — Get a CRM-ready summary for a specific prospect or company:

```bash
python query_helpers/deal_postmortem.py --prospect "John Smith"
python query_helpers/deal_postmortem.py --company "Acme"
```

**ICP Pattern Finder** — Analyze best client profiles for targeting patterns:

```bash
python query_helpers/icp_pattern_finder.py
```

Requires data in the `client_profiles` table with `is_best_client = true` for at least a few rows.

### Manually Retrying a Failed Call

```bash
# Re-process a specific transcript (will skip if already in DB)
python ingest_fireflies.py --id <fireflies_meeting_id>

# Or re-execute the n8n workflow manually from the n8n UI
```

If a call was partially ingested (in `calls` but no insights), delete the row from `calls` first, then re-run.

## Database Schema

### `calls` — Raw call metadata from Fireflies

| Column | Type | Description |
|---|---|---|
| `id` | UUID (PK) | Auto-generated |
| `fireflies_id` | TEXT (unique) | Fireflies meeting ID, used for deduplication |
| `fireflies_url` | TEXT | Full Fireflies /view/ link |
| `call_type` | TEXT | sales, client, discovery, demo, internal, etc. |
| `meeting_title` | TEXT | Meeting title from Fireflies |
| `meeting_date` | TIMESTAMPTZ | When the meeting occurred |
| `duration_minutes` | INTEGER | Call length in minutes |
| `host_email` | TEXT | Organizer's email |
| `attendee_emails` | JSONB | Array of attendee objects |
| `prospect_name` | TEXT | Inferred from non-host attendees |
| `company_name` | TEXT | Inferred from email domains |
| `transcript_full` | TEXT | Full transcript text |
| `transcript_sentences` | JSONB | Structured sentences with speaker + timestamp |
| `summary_fireflies` | TEXT | Fireflies' own summary |
| `created_at` | TIMESTAMPTZ | Row creation time |
| `processed_at` | TIMESTAMPTZ | NULL until insights extracted |

### `call_insights` — Extracted structured insights (one row per call)

| Column | Type | Description |
|---|---|---|
| `id` | UUID (PK) | Auto-generated |
| `call_id` | UUID (FK → calls) | Links to the parent call |
| `objections_raised` | JSONB | Array of objections from the prospect |
| `objections_handled_well` | JSONB | Objections the seller addressed effectively |
| `objection_handles_that_failed` | JSONB | Objections that weren't addressed well |
| `objection_categories` | JSONB | Thematic groupings of objections |
| `prospect_engagement_level` | TEXT | low, medium, or high |
| `pitch_moments_that_landed` | JSONB | Moments where the pitch resonated |
| `key_turning_point` | TEXT | The pivotal moment in the call |
| `buying_signals` | JSONB | Positive intent signals from the prospect |
| `deal_breakers` | JSONB | Issues that could kill the deal |
| `risk_factors` | JSONB | Risks to closing |
| `decision_criteria` | JSONB | What the prospect evaluates on |
| `timeline` | TEXT | Expected decision timeline |
| `competitor_strengths` | JSONB | Competitor advantages mentioned |
| `pricing_reaction` | TEXT | How the prospect reacted to pricing |
| `budget_range` | TEXT | Stated or implied budget |
| `pain_points` | JSONB | Prospect's pain points |
| `urgency_level` | TEXT | low, medium, or high |
| `non_priorities` | JSONB | Things the prospect explicitly deprioritized |
| `goals` | JSONB | Prospect's stated goals |
| `emotional_triggers` | JSONB | Emotional drivers in the conversation |
| `team_structure` | TEXT | Prospect's team/org structure |
| `notable_quotes` | JSONB | Verbatim quotes worth preserving |

### `client_profiles` — ICP reverse-engineering data

| Column | Type | Description |
|---|---|---|
| `id` | UUID (PK) | Auto-generated |
| `company_name` | TEXT | Company name |
| `linkedin_industry_self_reported` | TEXT | Industry from LinkedIn |
| `employee_count` | INTEGER | Company size |
| `has_director_of_sales` | BOOLEAN | Whether they have a sales director |
| `decision_maker_titles` | JSONB | Array of DM titles |
| `linkedin_keywords` | JSONB | Array of relevant LinkedIn keywords |
| `is_best_client` | BOOLEAN | Flag for ICP analysis |
| `notes` | TEXT | Free-form notes |

## Brand Voice

To influence the tone of generated LinkedIn content, create a file named `brand-voice.md` (or `voice-guidelines.md`) in the project root. The `content_from_objections` helper will automatically include it in prompts to Claude.

## Project Structure

```
├── README.md
├── .env.example
├── .env                          # Your credentials (gitignored)
├── .gitignore
├── requirements.txt
├── run_migrations.py             # Database setup helper
├── ingest_fireflies.py           # Main ingestion script (CLI)
├── migrations/
│   ├── 001_create_calls_table.sql
│   ├── 002_create_call_insights_table.sql
│   └── 003_create_client_profiles_table.sql
├── query_helpers/
│   ├── content_from_objections.py
│   ├── deal_postmortem.py
│   └── icp_pattern_finder.py
└── n8n_workflows/
    └── sales_call_intelligence_pipeline.json
```
