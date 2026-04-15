#!/usr/bin/env python3
"""Ingest Fireflies.ai transcripts into Supabase with Claude-powered insight extraction."""

import argparse
import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import anthropic
import requests
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SUPABASE_URL: str = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY: str = os.environ["SUPABASE_SERVICE_KEY"]
FIREFLIES_API_KEY: str = os.environ["FIREFLIES_API_KEY"]
ANTHROPIC_API_KEY: str = os.environ["ANTHROPIC_API_KEY"]

FIREFLIES_GRAPHQL_URL = "https://api.fireflies.ai/graphql"

FREE_EMAIL_DOMAINS = {"gmail.com", "yahoo.com", "outlook.com", "hotmail.com"}

SINGLE_TRANSCRIPT_QUERY = """
query Transcript($transcriptId: String!) {
  transcript(id: $transcriptId) {
    id title date duration
    organizer_email
    meeting_attendees { displayName email }
    transcript_url
    summary { shorthand_bullet }
    sentences { text speaker_name start_time }
  }
}
"""

BATCH_TRANSCRIPTS_QUERY = """
query RecentTranscripts($limit: Int, $skip: Int) {
  transcripts(limit: $limit, skip: $skip) {
    id title date duration
    organizer_email
    meeting_attendees { displayName email }
    transcript_url
    summary { shorthand_bullet }
    sentences { text speaker_name start_time }
  }
}
"""

CLAUDE_SYSTEM_PROMPT = (
    "You are a sales intelligence analyst. Extract structured data from the following "
    "sales call transcript. Return ONLY valid JSON matching the schema below. Preserve "
    "verbatim language for objections and notable quotes. Use empty arrays [] for list "
    "fields with no data, and null for text fields with no data. Never hallucinate — if "
    "information is not present in the transcript, leave the field empty."
)

INSIGHT_SCHEMA = """{
  "objections_raised": ["string"],
  "objections_handled_well": ["string"],
  "objection_handles_that_failed": ["string"],
  "objection_categories": ["string"],
  "prospect_engagement_level": "low | medium | high",
  "pitch_moments_that_landed": ["string"],
  "key_turning_point": "string or null",
  "buying_signals": ["string"],
  "deal_breakers": ["string"],
  "risk_factors": ["string"],
  "decision_criteria": ["string"],
  "timeline": "string or null",
  "competitor_strengths": ["string"],
  "pricing_reaction": "string or null",
  "budget_range": "string or null",
  "pain_points": ["string"],
  "urgency_level": "low | medium | high",
  "non_priorities": ["string"],
  "goals": ["string"],
  "emotional_triggers": ["string"],
  "team_structure": "string or null",
  "notable_quotes": ["string"]
}"""

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)


def fireflies_request(query: str, variables: dict[str, Any]) -> dict[str, Any]:
    """Execute a GraphQL request against the Fireflies API."""
    resp = requests.post(
        FIREFLIES_GRAPHQL_URL,
        json={"query": query, "variables": variables},
        headers={
            "Authorization": f"Bearer {FIREFLIES_API_KEY}",
            "Content-Type": "application/json",
        },
        timeout=30,
    )
    resp.raise_for_status()
    body = resp.json()
    if "errors" in body:
        raise RuntimeError(f"Fireflies GraphQL errors: {body['errors']}")
    return body["data"]


def fetch_single_transcript(transcript_id: str) -> dict[str, Any]:
    """Fetch a single transcript by ID."""
    data = fireflies_request(SINGLE_TRANSCRIPT_QUERY, {"transcriptId": transcript_id})
    return data["transcript"]


def fetch_transcripts_page(limit: int = 50, skip: int = 0) -> list[dict[str, Any]]:
    """Fetch a page of transcripts."""
    data = fireflies_request(BATCH_TRANSCRIPTS_QUERY, {"limit": limit, "skip": skip})
    return data["transcripts"] or []


def already_ingested(fireflies_id: str) -> bool:
    """Check if a transcript with this fireflies_id already exists in the calls table."""
    result = (
        supabase.table("calls")
        .select("id")
        .eq("fireflies_id", fireflies_id)
        .limit(1)
        .execute()
    )
    return len(result.data) > 0


def parse_prospect_and_company(
    attendees: list[dict[str, Any]], organizer_email: Optional[str]
) -> tuple[Optional[str], Optional[str]]:
    """Extract prospect name and company from non-host attendees."""
    prospect_name: Optional[str] = None
    company_name: Optional[str] = None

    organizer_domain = None
    if organizer_email and "@" in organizer_email:
        organizer_domain = organizer_email.split("@")[1].lower()

    for att in attendees or []:
        email = (att.get("email") or "").lower()
        if email == (organizer_email or "").lower():
            continue

        if prospect_name is None:
            prospect_name = att.get("displayName")

        if company_name is None and "@" in email:
            domain = email.split("@")[1]
            if domain not in FREE_EMAIL_DOMAINS and domain != organizer_domain:
                company_name = domain.split(".")[0].capitalize()

        if prospect_name and company_name:
            break

    return prospect_name, company_name


def build_transcript_text(sentences: list[dict[str, Any]]) -> str:
    """Build full transcript text from sentences."""
    lines: list[str] = []
    for s in sentences or []:
        speaker = s.get("speaker_name") or "Unknown"
        text = s.get("text") or ""
        lines.append(f"{speaker}: {text}")
    return "\n".join(lines)


def extract_insights_with_claude(transcript_text: str) -> dict[str, Any]:
    """Send transcript to Claude and extract structured insights."""
    user_prompt = (
        f"Transcript:\n\n{transcript_text}\n\n"
        f"Return JSON matching this schema:\n{INSIGHT_SCHEMA}"
    )

    response = claude.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        system=CLAUDE_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )

    raw = response.content[0].text.strip()

    # Strip markdown code fences if present
    if raw.startswith("```"):
        lines = raw.split("\n")
        # Remove first line (```json or ```) and last line (```)
        lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        raw = "\n".join(lines)

    return json.loads(raw)


def process_transcript(t: dict[str, Any]) -> None:
    """Process a single transcript: dedupe, insert call, extract insights, insert insights."""
    fireflies_id: str = t["id"]
    title: str = t.get("title") or "Untitled"

    if already_ingested(fireflies_id):
        logger.info("Skipping already-ingested transcript: %s (%s)", title, fireflies_id)
        return

    attendees = t.get("meeting_attendees") or []
    organizer_email = t.get("organizer_email")
    prospect_name, company_name = parse_prospect_and_company(attendees, organizer_email)

    sentences = t.get("sentences") or []
    transcript_text = build_transcript_text(sentences)

    summary = t.get("summary") or {}
    shorthand_bullet = summary.get("shorthand_bullet")

    # Convert Fireflies date (Unix timestamp) to ISO format
    raw_date = t.get("date")
    meeting_date = None
    if raw_date is not None:
        try:
            ts = int(raw_date)
            # Fireflies uses milliseconds if the value is very large
            if ts > 1e12:
                ts = ts // 1000
            meeting_date = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
        except (ValueError, TypeError, OSError):
            meeting_date = None

    # Convert duration from seconds to minutes
    raw_duration = t.get("duration")
    duration_minutes = None
    if raw_duration is not None:
        try:
            duration_minutes = int(float(raw_duration) / 60)
        except (ValueError, TypeError):
            duration_minutes = None

    call_record = {
        "fireflies_id": fireflies_id,
        "fireflies_url": t.get("transcript_url"),
        "meeting_title": title,
        "meeting_date": meeting_date,
        "duration_minutes": duration_minutes,
        "host_email": organizer_email,
        "attendee_emails": attendees,
        "prospect_name": prospect_name,
        "company_name": company_name,
        "transcript_full": transcript_text,
        "transcript_sentences": sentences,
        "summary_fireflies": shorthand_bullet,
    }

    insert_result = supabase.table("calls").insert(call_record).execute()
    call_id = insert_result.data[0]["id"]

    logger.info("Inserted call: %s (%s) -> call_id=%s", title, fireflies_id, call_id)

    # Extract insights via Claude
    insights = extract_insights_with_claude(transcript_text)
    insights["call_id"] = call_id
    supabase.table("call_insights").insert(insights).execute()

    logger.info("Inserted insights for call_id=%s", call_id)

    # Mark call as processed
    supabase.table("calls").update(
        {"processed_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", call_id).execute()


def mode_single(transcript_id: str) -> None:
    """Ingest a single transcript by Fireflies ID."""
    logger.info("Fetching single transcript: %s", transcript_id)
    t = fetch_single_transcript(transcript_id)
    if t is None:
        logger.error("Transcript not found: %s", transcript_id)
        return
    try:
        process_transcript(t)
    except Exception:
        logger.exception("Failed to process transcript %s", transcript_id)


def mode_batch(hours: int) -> None:
    """Ingest recent transcripts from the last N hours."""
    logger.info("Batch mode: fetching transcripts from last %d hours", hours)
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    cutoff_ts = int(cutoff.timestamp())

    transcripts = fetch_transcripts_page(limit=50, skip=0)
    count = 0

    for t in transcripts:
        t_date = t.get("date")
        if t_date is None:
            continue
        # Fireflies date can be a Unix timestamp (int or string)
        try:
            ts = int(t_date)
        except (ValueError, TypeError):
            continue
        if ts < cutoff_ts:
            continue
        try:
            process_transcript(t)
            count += 1
        except Exception:
            logger.exception("Failed to process transcript %s (%s)", t.get("title"), t.get("id"))

    logger.info("Batch complete: processed %d transcripts", count)


def mode_backfill() -> None:
    """Ingest all transcripts, oldest first, with rate limiting."""
    logger.info("Backfill mode: paginating through all transcripts")

    # First, collect all transcripts
    all_transcripts: list[dict[str, Any]] = []
    skip = 0
    page_size = 50

    while True:
        logger.info("Fetching page at skip=%d", skip)
        page = fetch_transcripts_page(limit=page_size, skip=skip)
        if not page:
            break
        all_transcripts.extend(page)
        skip += page_size
        time.sleep(1)  # rate limit between pages

    # Sort oldest first by date
    def sort_key(t: dict[str, Any]) -> int:
        try:
            return int(t.get("date") or 0)
        except (ValueError, TypeError):
            return 0

    all_transcripts.sort(key=sort_key)

    logger.info("Backfill: found %d total transcripts", len(all_transcripts))

    count = 0
    for t in all_transcripts:
        try:
            process_transcript(t)
            count += 1
        except Exception:
            logger.exception("Failed to process transcript %s (%s)", t.get("title"), t.get("id"))
        time.sleep(1)  # rate limit between calls

    logger.info("Backfill complete: processed %d transcripts", count)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Ingest Fireflies.ai transcripts into Supabase with Claude-powered insights."
    )
    parser.add_argument("--id", type=str, help="Ingest a single transcript by Fireflies ID")
    parser.add_argument("--batch", action="store_true", help="Ingest recent transcripts")
    parser.add_argument(
        "--hours", type=int, default=24, help="Hours to look back in batch mode (default: 24)"
    )
    parser.add_argument("--backfill", action="store_true", help="Ingest all transcripts (oldest first)")

    args = parser.parse_args()

    if args.id:
        mode_single(args.id)
    elif args.batch:
        mode_batch(args.hours)
    elif args.backfill:
        mode_backfill()
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
