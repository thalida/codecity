# CodeCity

3D city visualization of codebases where files become buildings, folders become streets, and code metrics determine visual properties.


## CRITICAL: Always Use uv

**NEVER run Python commands directly.** Always use `uv run` or `just` commands.

- ❌ `python script.py` / `python -m pytest` / `pip install`
- ✅ `uv run python script.py` / `uv run pytest` / `uv add package`

This ensures the correct virtual environment and dependencies are always used.

## Quick Reference

```bash
# Run CLI commands with uv (ALWAYS use uv run, never python directly)
uv run codecity serve .     # Start dev server
uv run codecity build .     # Build static site
uv run codecity config list # Show config

# Development tasks (these use uv internally)
just test                   # Run pytest
just lint                   # Check ruff + format
just typecheck              # Run mypy
just lint-fix               # Auto-fix lint issues
just serve                  # Alias for uv run codecity serve .
```

## Before Completing Work

Always run all three checks:
```bash
just test && just lint && just typecheck
```

## Project Structure

```
src/codecity/
├── config/      # Settings (Pydantic), defaults (colors, editors)
├── analysis/    # Core engine: models, metrics, git, cache, layout, diff
├── api/         # FastAPI server, file watcher, WebSocket
├── app/         # Frontend: HTML/JS/CSS, Babylon.js renderer
└── cli/         # Click commands: serve, build, config
```

## Plans & Design Documents

Plans live in `docs/plans/` with naming convention `YYYY-MM-DD-<topic>-{design,plan}.md`.

Existing plans are frozen historical records. New work should create new plan files.

**Current plans:**
- `2026-01-17-codecity-architecture-design.md` - Technical specification
- `2026-01-17-codecity-implementation-plan.md` - Phase-based implementation with TDD specs

## Development Approach

- **Hybrid TDD**: Test-first for core logic (analysis, API), rapid iteration for UI/polish
- **Standard Python**: Follow existing patterns - Pydantic models, pytest, type hints
- **Code quality**: ruff for linting/formatting, mypy for types

## Tech Stack

| Layer | Technology |
|-------|-----------|
| CLI | Click + rich-click |
| Config | Pydantic Settings + TOML |
| Backend | FastAPI + uvicorn + WebSocket |
| Frontend | Vanilla JS + Babylon.js |
| Testing | pytest + pytest-asyncio + httpx |
| Package Mgmt | uv |

## City Visualization Model

- **Building height** = lines of code
- **Building width** = average line length
- **Building color** = language (hue), age (saturation), last modified (lightness)
- **Streets** = folder hierarchy

## Key Patterns

**Config hierarchy** (lowest to highest priority):
1. Default values in Settings class
2. User config file (~/.config/codecity/config.toml)
3. Environment variables (CODECITY_* prefix)
4. CLI arguments

**Live reload flow**:
1. FileWatcher detects changes
2. Diff calculator compares state
3. WebSocket broadcasts updates
4. Frontend updates buildings incrementally
