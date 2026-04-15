#!/usr/bin/env python3
"""Generate a deal postmortem summary for a prospect or company."""

import argparse
import logging
import os
import sys
from typing import Any

from anthropic import Anthropic
from dotenv import find_dotenv, load_dotenv
from supabase import create_client, Client

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

INSIGHT_FIELDS = [
    "call_id",
    "key_turning_point",
    "objections_raised",
    "objections_handled_well",
    "objection_handles_that_failed",
    "buying_signals",
    "deal_breakers",
]

CALL_FIELDS = ["id", "meeting_title", "meeting_date"]


def fetch_calls(supabase: Client, prospect: str | None, company: str | None) -> list[dict[str, Any]]:
    """Fetch matching calls by prospect name or company name."""
    query = supabase.table("calls").select(",".join(CALL_FIELDS))

    if prospect:
        query = query.ilike("prospect_name", f"%{prospect}%")
    elif company:
        query = query.ilike("company_name", f"%{company}%")

    response = query.execute()
    return response.data or []


def fetch_insights(supabase: Client, call_ids: list[str]) -> list[dict[str, Any]]:
    """Fetch call_insights for the given call IDs."""
    if not call_ids:
        return []

    response = (
        supabase.table("call_insights")
        .select(",".join(INSIGHT_FIELDS))
        .in_("call_id", call_ids)
        .execute()
    )
    return response.data or []


def build_deal_data(
    calls: list[dict[str, Any]], insights: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Merge call metadata with insights into a unified list."""
    insights_by_call: dict[str, dict[str, Any]] = {}
    for insight in insights:
        insights_by_call[insight.get("call_id", "")] = insight

    merged: list[dict[str, Any]] = []
    for call in calls:
        call_id = call.get("id", "")
        entry: dict[str, Any] = {
            "meeting_title": call.get("meeting_title"),
            "meeting_date": call.get("meeting_date"),
        }
        insight = insights_by_call.get(call_id, {})
        for field in INSIGHT_FIELDS:
            if field != "call_id":
                entry[field] = insight.get(field)
        merged.append(entry)
    return merged


def generate_postmortem(client: Anthropic, deal_data: list[dict[str, Any]]) -> str:
    """Send deal data to Claude and return the postmortem summary."""
    data_text_parts: list[str] = []
    for i, entry in enumerate(deal_data, 1):
        lines = [f"--- Call {i} ---"]
        for key, value in entry.items():
            lines.append(f"  {key}: {value}")
        data_text_parts.append("\n".join(lines))

    data_text = "\n\n".join(data_text_parts)

    prompt = (
        "Below is data from one or more sales calls with a prospect.\n\n"
        f"{data_text}\n\n"
        "Generate a clean prose deal postmortem summary suitable for a CRM note. "
        "Include: overview of the engagement, key turning point, objections "
        "(what handled well vs failed), buying signals observed, deal breakers, "
        "and a recommended next action. Be concise and professional."
    )

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate a deal postmortem summary from call data."
    )
    parser.add_argument(
        "--prospect",
        type=str,
        default=None,
        help="Prospect name to search for (case-insensitive partial match)",
    )
    parser.add_argument(
        "--company",
        type=str,
        default=None,
        help="Company name to search for (case-insensitive partial match)",
    )
    args = parser.parse_args()

    if not args.prospect and not args.company:
        parser.error("At least one of --prospect or --company is required.")

    load_dotenv(find_dotenv())

    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_KEY")
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")

    if not supabase_url or not supabase_key:
        logger.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env")
        sys.exit(1)
    if not anthropic_key:
        logger.error("ANTHROPIC_API_KEY must be set in .env")
        sys.exit(1)

    supabase: Client = create_client(supabase_url, supabase_key)

    search_desc = args.prospect or args.company
    logger.info("Searching for calls matching: %s", search_desc)

    calls = fetch_calls(supabase, args.prospect, args.company)
    if not calls:
        print(f"No calls found matching '{search_desc}'. Check spelling or try a broader search.")
        sys.exit(0)

    call_ids = [call["id"] for call in calls]
    logger.info("Found %d matching call(s). Fetching insights...", len(calls))

    insights = fetch_insights(supabase, call_ids)
    if not insights:
        print("Calls found but no insights data available for those calls.")
        sys.exit(0)

    deal_data = build_deal_data(calls, insights)

    logger.info("Generating postmortem with Claude...")
    anthropic_client = Anthropic(api_key=anthropic_key)
    result = generate_postmortem(anthropic_client, deal_data)

    print("\n" + "=" * 60)
    print("DEAL POSTMORTEM")
    print("=" * 60 + "\n")
    print(result)
    print()


if __name__ == "__main__":
    main()
