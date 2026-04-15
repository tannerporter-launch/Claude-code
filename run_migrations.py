#!/usr/bin/env python3
"""Run SQL migrations against Supabase.

Supports two methods:
  1. psql (default) — direct PostgreSQL connection
  2. Supabase SQL Editor — paste the SQL manually

Usage:
  python run_migrations.py                           # uses psql with DATABASE_URL from .env
  python run_migrations.py --connection-string "..."  # explicit connection string
  python run_migrations.py --print-only              # just print the SQL to run manually
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

MIGRATION_DIR = Path(__file__).parent / "migrations"
MIGRATION_FILES = sorted(MIGRATION_DIR.glob("*.sql"))


def run_with_psql(connection_string: str) -> None:
    """Execute migrations via psql."""
    for path in MIGRATION_FILES:
        print(f"\n--- {path.name} ---")
        result = subprocess.run(
            ["psql", connection_string, "-f", str(path)],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0:
            print(f"  OK")
            if result.stdout.strip():
                print(f"  {result.stdout.strip()}")
        else:
            print(f"  FAILED: {result.stderr.strip()}")
            sys.exit(1)
    print("\nAll migrations complete.")


def print_combined_sql() -> None:
    """Print all migration SQL for manual execution in the Supabase SQL Editor."""
    print("-- Copy everything below and paste into Supabase SQL Editor")
    print("-- (Dashboard → SQL Editor → New Query → paste → Run)")
    print()
    for path in MIGRATION_FILES:
        print(f"-- ========== {path.name} ==========")
        print(path.read_text())
        print()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run database migrations.")
    parser.add_argument(
        "--connection-string",
        type=str,
        default=None,
        help="PostgreSQL connection string (default: DATABASE_URL from .env)",
    )
    parser.add_argument(
        "--print-only",
        action="store_true",
        help="Print combined SQL instead of executing (for manual use in SQL Editor)",
    )
    args = parser.parse_args()

    if args.print_only:
        print_combined_sql()
        return

    conn = args.connection_string or os.environ.get("DATABASE_URL")
    if not conn:
        print("ERROR: No connection string provided.")
        print("Either:")
        print("  1. Set DATABASE_URL in .env")
        print("  2. Pass --connection-string '...'")
        print("  3. Use --print-only to get SQL for the Supabase SQL Editor")
        sys.exit(1)

    run_with_psql(conn)


if __name__ == "__main__":
    main()
