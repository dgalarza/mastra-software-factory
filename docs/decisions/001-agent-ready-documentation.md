# 1. Agent-Ready Documentation Structure

**Date:** 2026-07-11
**Status:** Accepted

## Context
This codebase is being prepared for AI agent work. Agents need structured, discoverable documentation to work effectively -- they cannot access knowledge that lives outside the repository.

## Decision
Adopt a progressive disclosure documentation structure:
- AGENTS.md as a concise entry point (~100 lines) with markdown links to detailed docs
- CLAUDE.md as a symlink to AGENTS.md for Claude Code compatibility
- ARCHITECTURE.md as a codemap with invariants and boundaries
- docs/DOMAIN.md for business domain knowledge, terminology, and workflows
- docs/ directory for guides, references, and decision records
- Nested AGENTS.md files for major domain directories (as needed)

## Consequences
- All project knowledge must live in-repo (not in Slack, Confluence, or heads)
- Documentation changes should be reviewed like code changes
- AGENTS.md must stay concise; bloat gets extracted to docs/
- ADRs should be written for significant architectural decisions going forward
- docs/DOMAIN.md currently ships as a stub since this project has no defined product domain yet -- it should be filled in as real requirements land

## Alternatives Considered
- Single large AGENTS.md -- rejected because it crowds agent context and rots quickly
- No structured docs, rely on code comments -- rejected because agents need navigational aids beyond inline comments
