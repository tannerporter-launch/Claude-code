#!/usr/bin/env python3
"""Analyze best client profiles to identify ICP patterns and correlations."""

import logging
import os
import sys
from typing import Any

from anthropic import Anthropic
from dotenv import find_dotenv, load_dotenv
from supabase import create_client, Client

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

PROFILE_FIELDS = [
    "company_name",
    "linkedin_industry_self_reported",
    "employee_count",
    "has_director_of_sales",
    "decision_maker_titles",
    "linkedin_keywords",
]


def fetch_best_clients(supabase: Client) -> list[dict[str, Any]]:
    """Fetch all client profiles where is_best_client is true."""
    response = (
        supabase.table("client_profiles")
        .select(",".join(PROFILE_FIELDS))
        .eq("is_best_client", True)
        .execute()
    )
    return response.data or []


def generate_icp_analysis(client: Anthropic, profiles: list[dict[str, Any]]) -> str:
    """Send best client profiles to Claude and return ICP analysis."""
    profile_text_parts: list[str] = []
    for i, profile in enumerate(profiles, 1):
        lines = [f"--- Client {i} ---"]
        for key, value in profile.items():
            lines.append(f"  {key}: {value}")
        profile_text_parts.append("\n".join(lines))

    profiles_text = "\n\n".join(profile_text_parts)

    prompt = (
        f"Here are {len(profiles)} best client profiles:\n\n"
        f"{profiles_text}\n\n"
        "Analyze these best client profiles and identify the 3-5 strongest "
        "patterns/correlations across industry, employee count, whether they "
        "have a director of sales, decision maker titles, and LinkedIn keywords. "
        "Output: (1) A refined ICP profile summary, (2) The top 3-5 correlations "
        "with supporting data, (3) A target list filter specification I can use "
        "for LinkedIn Sales Navigator or outbound prospecting tools."
    )

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text


def main() -> None:
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

    logger.info("Fetching best client profiles...")
    profiles = fetch_best_clients(supabase)

    if not profiles:
        print("No best client profiles found (is_best_client = true). Nothing to analyze.")
        sys.exit(0)

    logger.info("Found %d best client profile(s). Sending to Claude...", len(profiles))

    anthropic_client = Anthropic(api_key=anthropic_key)
    result = generate_icp_analysis(anthropic_client, profiles)

    print("\n" + "=" * 60)
    print("ICP PATTERN ANALYSIS")
    print("=" * 60 + "\n")
    print(result)
    print()


if __name__ == "__main__":
    main()
