# Sift

Sift is a token-efficient capture -> extract -> sync plugin for OpenClaw.

It targets a common failure mode in agent workflows: long webpages, long notes, long JSON payloads,
and long Notion update bodies getting replayed in the main conversation over and over.

## MVP

- `sift_stage_artifact`
  - stages inline text, local files, or fetched URLs into local artifacts
  - writes `raw.*`, `normalized.*`, and `manifest.json`
  - lets later steps pass file paths instead of raw source content
- `sift_notion_sync`
  - creates pages from markdown
  - retrieves page markdown
  - replaces full page content with markdown
  - performs exact search-and-replace updates

## Why this shape

The first goal is to cut token burn without obviously hurting output quality:

- keep large source material in files/artifacts
- keep the model focused on summaries, patches, and decisions
- use Notion's markdown APIs instead of giant block JSON payloads
- prefer incremental updates over full-page rewrites when possible

## Local development

```bash
npm install
npm test
npm run check
```

## Planned next steps

- richer URL capture for JS-heavy pages via pluggable adapters
- schema-guided extraction helpers
- file-backed update helpers that can consume staged manifests directly
- local install + runtime enable docs for native OpenClaw
