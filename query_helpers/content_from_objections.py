#!/usr/bin/env python3
"""Generate LinkedIn post hooks from sales objections grouped by theme."""

import argparse
import logging
import os
import sys
from pathlib import Path

from anthropic import Anthropic
from dotenv import find_dotenv, load_dotenv
from supabase import create_client, Client

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parent.parent
BRAND_VOICE_FILES = ["brand-voice.md", "voice-guidelines.md", "brand_voice.md"]


def load_brand_voice() -> str | None:
    """Load brand voice content from the repo root if a matching file exists."""
    for filename in BRAND_VOICE_FILES:
        filepath = REPO_ROOT / filename
        if filepath.is_file():
            logger.info("Found brand voice file: %s", filepath)
            return filepath.read_text(encoding="utf-8")
    return None


def fetch_objections(supabase: Client) -> list[str]:
    """Fetch and flatten all objections_raised from call_insights."""
    response = supabase.table("call_insights").select("objections_raised").execute()
    rows = response.data or []

    objections: list[str] = []
    for row in rows:
        value = row.get("objections_raised")
        if isinstance(value, list):
            objections.extend(value)
        elif isinstance(value, str) and value:
            objections.append(value)
    return objections


def generate_content(client: Anthropic, objections: list[str], top_n: int) -> str:
    """Send objections to Claude and return grouped analysis with post hooks."""
    brand_voice = load_brand_voice()

    prompt_parts: list[str] = []
    if brand_voice:
        prompt_parts.append(
            f"<brand_voice>\n{brand_voice}\n</brand_voice>\n\n"
            "Use the brand voice above to inform the tone and style of the LinkedIn post hooks.\n\n"
        )

    prompt_parts.append(
        f"Here are {len(objections)} sales objections collected from prospect calls:\n\n"
    )
    for i, obj in enumerate(objections, 1):
        prompt_parts.append(f"{i}. {obj}")

    prompt_parts.append(
        f"\n\nGroup these sales objections by theme/similarity. "
        f"Rank groups by frequency. Output only the top {top_n} groups. "
        f"For each group, generate a LinkedIn post hook (1-2 sentences) that "
        f"addresses the objection head-on, plus a one-sentence angle explainer."
    )

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        messages=[{"role": "user", "content": "\n".join(prompt_parts)}],
    )
    return message.content[0].text


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate LinkedIn post hooks from sales objections."
    )
    parser.add_argument(
        "--top",
        type=int,
        default=10,
        help="Number of objection groups to output (default: 10)",
    )
    args = parser.parse_args()

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
    objections = fetch_objections(supabase)

    if not objections:
        print("No objections found in call_insights table. Nothing to analyze.")
        sys.exit(0)

    logger.info("Collected %d total objections. Sending to Claude...", len(objections))

    anthropic_client = Anthropic(api_key=anthropic_key)
    result = generate_content(anthropic_client, objections, args.top)

    print("\n" + "=" * 60)
    print("OBJECTION-BASED CONTENT IDEAS")
    print("=" * 60 + "\n")
    print(result)
    print()


if __name__ == "__main__":
    main()
