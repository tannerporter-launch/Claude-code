# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current State

This repository is currently a fresh, near-empty project. As of this writing it contains only:

- `README.md` — a placeholder titled `# Claude-code`
- `CLAUDE.md` — this file

There is **no source code, dependency manifest, build configuration, or test suite yet**. The sections below are intentionally left as a scaffold. As the codebase grows, update this file with concrete details rather than generic advice.

## Repository

- Default branch: `main`
- Remote: GitHub (`tannerporter-launch/claude-code`)

## Setup / Build / Test / Run

_No build system, package manager, or test framework is present yet._

When the project gains a stack, document the real, verified commands here, for example:

- Install dependencies
- Build the project
- Run the full test suite
- Run a single test (the exact invocation — this is the most useful thing to capture)
- Lint / format
- Start the application locally

Only add commands once they exist and have been run successfully. Do not add aspirational or guessed commands.

## Architecture

_Nothing to document yet._

Once there is code, capture the "big picture" here — the things that require reading several files to understand:

- The major modules/packages and how they depend on one another
- Where the entry point(s) live and how a request/command flows through the system
- Cross-cutting conventions (config loading, error handling, data access) that aren't obvious from a single file

Keep this focused on structure that isn't discoverable at a glance; avoid restating the directory listing.

## Conventions for Updating This File

- Replace each scaffold section with concrete information as it becomes real.
- Prefer commands and facts you have verified over assumptions.
- Keep it concise and skip generic software-engineering advice.
