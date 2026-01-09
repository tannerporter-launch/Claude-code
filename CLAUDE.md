# CLAUDE.md - AI Assistant Guide

This document provides comprehensive guidance for AI assistants (like Claude) working on the Claude-code repository. It outlines the codebase structure, development workflows, conventions, and best practices.

## Table of Contents

- [Project Overview](#project-overview)
- [Repository Structure](#repository-structure)
- [Development Workflow](#development-workflow)
- [Code Conventions](#code-conventions)
- [Git Workflow](#git-workflow)
- [Testing Guidelines](#testing-guidelines)
- [Documentation Standards](#documentation-standards)
- [Common Tasks](#common-tasks)
- [Troubleshooting](#troubleshooting)

---

## Project Overview

**Repository:** Claude-code
**Status:** Initial setup phase
**Purpose:** [To be defined as project develops]

### Current State

This repository is in its initial setup phase. As the project develops, this section should be updated with:
- Project goals and objectives
- Technology stack
- Key dependencies
- Architecture overview

---

## Repository Structure

### Current Structure

```
Claude-code/
├── .git/           # Git version control
├── README.md       # Project readme
└── CLAUDE.md       # This file - AI assistant guide
```

### Expected Structure (To be updated as project grows)

As the project develops, document the directory structure here:

```
Claude-code/
├── src/            # Source code
├── tests/          # Test files
├── docs/           # Documentation
├── config/         # Configuration files
├── scripts/        # Build and utility scripts
└── [other dirs]    # To be added
```

---

## Development Workflow

### Setting Up Development Environment

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd Claude-code
   ```

2. **Install dependencies** (when applicable)
   - To be documented once package manager is chosen

3. **Verify setup**
   - To be documented once build/test system is in place

### Branch Strategy

- **Main branch:** `main` (or as configured)
- **Feature branches:** Use descriptive names prefixed with `claude/` for AI assistant work
  - Format: `claude/<feature-description>-<session-id>`
  - Example: `claude/add-authentication-leyhi`

### Making Changes

1. **Always start from the correct branch**
   ```bash
   git checkout <feature-branch>
   ```

2. **Make focused, incremental changes**
   - One logical change per commit
   - Keep changes minimal and purposeful

3. **Test changes thoroughly**
   - Run existing tests
   - Add tests for new functionality

4. **Commit with clear messages**
   ```bash
   git add <files>
   git commit -m "Brief description of changes"
   ```

---

## Code Conventions

### General Principles

1. **Readability First**
   - Write self-documenting code
   - Use clear, descriptive names
   - Keep functions small and focused

2. **Avoid Over-Engineering**
   - Implement only what's requested
   - Don't add "nice to have" features
   - Keep solutions simple and direct

3. **Security Awareness**
   - Validate all external input
   - Avoid common vulnerabilities (XSS, SQL injection, etc.)
   - Follow OWASP best practices

### Code Style (To be updated)

Once a programming language is chosen, document:
- Naming conventions
- File organization
- Import/export patterns
- Error handling approaches

### Comments and Documentation

- **When to comment:**
  - Complex algorithms or business logic
  - Non-obvious workarounds
  - Public APIs and interfaces

- **When NOT to comment:**
  - Self-evident code
  - What the code does (code should show this)
  - Redundant information

---

## Git Workflow

### Committing Changes

1. **Review changes before committing**
   ```bash
   git status
   git diff
   ```

2. **Stage relevant files**
   ```bash
   git add <files>
   ```

3. **Write meaningful commit messages**
   - First line: Brief summary (50 chars or less)
   - Blank line
   - Detailed description if needed
   - Focus on "why" not "what"

### Pushing Changes

1. **Push to feature branch**
   ```bash
   git push -u origin <branch-name>
   ```

2. **Handle push failures**
   - Retry up to 4 times with exponential backoff (2s, 4s, 8s, 16s)
   - Branch must start with `claude/` and end with session ID

### Creating Pull Requests

When work is complete and ready for review:

1. **Ensure all changes are committed and pushed**
2. **Create PR with:**
   - Clear title describing the change
   - Summary of what was done (1-3 bullet points)
   - Test plan or verification steps
3. **Use GitHub CLI if available:**
   ```bash
   gh pr create --title "Description" --body "Details"
   ```

---

## Testing Guidelines

### Test Organization (To be defined)

Once testing framework is chosen, document:
- Where tests live
- How to run tests
- Test naming conventions
- Coverage expectations

### Writing Tests

- Test behavior, not implementation
- Use descriptive test names
- Keep tests isolated and independent
- Aim for fast execution

---

## Documentation Standards

### Code Documentation

1. **README.md**
   - Keep updated with setup instructions
   - Document key features
   - Include usage examples

2. **Inline Documentation**
   - Document public APIs
   - Explain complex logic
   - Keep comments current

3. **CLAUDE.md (this file)**
   - Update as project structure evolves
   - Document new conventions as established
   - Keep information current and accurate

### Updating Documentation

- Update docs in the same commit as code changes
- Remove outdated information promptly
- Use clear, concise language

---

## Common Tasks

### Adding New Features

1. **Understand the requirement**
   - Read existing code first
   - Identify where changes belong
   - Plan the implementation

2. **Make minimal changes**
   - Modify existing files when possible
   - Add new files only when necessary
   - Follow existing patterns

3. **Test thoroughly**
   - Manual testing
   - Automated tests if available
   - Edge cases

### Fixing Bugs

1. **Reproduce the issue**
   - Understand the problem
   - Identify root cause
   - Avoid fixing symptoms

2. **Make targeted fix**
   - Change only what's needed
   - Don't refactor surrounding code
   - Maintain existing patterns

3. **Verify the fix**
   - Test the specific issue
   - Ensure no regressions
   - Consider edge cases

### Refactoring

Only refactor when:
- Explicitly requested
- Necessary for the current task
- Part of a larger improvement

Never:
- Refactor code you're not changing
- "Improve" code that works
- Add features during refactoring

---

## Troubleshooting

### Common Issues

#### Git Push Failures

- **Symptom:** 403 error on push
- **Cause:** Branch doesn't match required pattern
- **Solution:** Ensure branch starts with `claude/` and ends with session ID

#### Network Timeouts

- **Symptom:** Timeout during git operations
- **Solution:** Retry with exponential backoff (2s, 4s, 8s, 16s)

### Getting Help

- Check existing documentation first
- Review similar code in the repository
- Ask clarifying questions when requirements are unclear

---

## Best Practices for AI Assistants

### Before Making Changes

- **Always read files before editing**
- **Understand existing patterns**
- **Plan complex changes**
- **Use TodoWrite for multi-step tasks**

### During Development

- **Make focused, incremental changes**
- **Test as you go**
- **Keep user informed of progress**
- **Use appropriate tools** (Read/Edit/Write, not bash for file operations)

### After Changes

- **Review your own changes**
- **Clean up any debugging code**
- **Update relevant documentation**
- **Commit with clear messages**

### Communication

- **Be concise** - This is a CLI environment
- **Be objective** - Focus on facts, not validation
- **Be proactive** - Use tools to gather information
- **Don't use emojis** unless explicitly requested

---

## Maintenance

### Keeping This Document Current

This document should be updated when:
- Project structure changes significantly
- New conventions are established
- New tools or frameworks are added
- Development workflow evolves

### Version History

- **2026-01-09:** Initial creation - Project setup phase

---

## Notes for Future Development

As the Claude-code project develops, ensure this document is updated with:

1. **Technology Stack**
   - Programming language(s)
   - Frameworks and libraries
   - Build tools
   - Testing frameworks

2. **Architecture Details**
   - System design
   - Key components
   - Data flow
   - External dependencies

3. **API Documentation**
   - Endpoint specifications
   - Authentication methods
   - Error handling

4. **Deployment Information**
   - Build process
   - Deployment steps
   - Environment configuration

5. **Team Conventions**
   - Code review process
   - Release procedures
   - Communication channels

---

*This document is a living guide. Keep it updated as the project evolves.*
