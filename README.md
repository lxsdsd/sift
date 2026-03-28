# Sift

Sift is a reusable OpenClaw plugin for token-efficient capture -> extract -> sync workflows.

It targets a common failure mode in agent systems: long webpages, long notes, long JSON payloads,
and long Notion update bodies getting replayed in the main conversation over and over.

## What it does

- `sift_stage_artifact`
  - stages inline text, local files, or fetched URLs into local artifacts
  - writes `manifest.json`, `clean.md`, `extracted.json`, and a preserved source file
  - lets later steps pass file paths or manifest paths instead of raw source content
- `sift_notion_sync`
  - searches Notion pages/data sources
  - creates pages from inline markdown or staged manifests
  - retrieves page markdown, including optional follow-up fetches for truncated `unknown_block_ids`
  - replaces full page content or performs exact search-and-replace updates
  - retries on `429 rate_limited` responses using `Retry-After`

## Why this shape

The goal is to cut token burn without obviously hurting output quality:

- keep large source material in files/artifacts
- keep the model focused on summaries, patches, and decisions
- use Notion's markdown APIs instead of giant block JSON payloads
- prefer incremental updates over full-page rewrites when possible
- keep Notion as a sink, not the only source of truth

## Plugin vs skill

Sift is a plugin, not a skill.

- A plugin adds runtime capabilities and tools to OpenClaw itself.
- A skill is instructions and workflow guidance for the agent.
- A skill can tell an agent when to use Sift.
- Sift can therefore be reused across many skills, projects, and agents.

## Local development

```bash
npm install
npm test
npm run check
```

## Next steps

- add schema-guided extraction helpers on top of `extracted.json`
- add optional page/database creation helpers for richer Notion parents
- add pluggable fetch adapters for JS-heavy pages
- document install/config patterns for native OpenClaw runtimes
