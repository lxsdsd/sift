# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [0.1.1] - 2026-03-28

### Added
- Added repository metadata, package file allowlist, keywords, and Node engine constraints.
- Added `npm run release:check` to verify package/manifest version lockstep.
- Added GitHub Actions CI for `npm ci`, `npm run check`, `npm test`, and `npm run release:check`.

### Changed
- Promoted the package to a dedicated reusable repo/package shape via scoped package name `@lxsdsd/openclaw-sift`.
- Switched `devDependencies.openclaw` from a machine-local file path to the published `openclaw` package so contributors can install dependencies outside the original workstation.

## [0.1.0] - 2026-03-28

### Added
- Initial `sift` plugin scaffold with `sift_stage_artifact` and `sift_notion_sync` tools.
- Runtime discovery fix via `openclaw.plugin.json` and explicit optional tool names.
- Artifact staging outputs: `manifest.json`, `clean.md`, `extracted.json`, plus preserved source file.
- Notion sync support for markdown create/read/update flows, manifest-backed inputs, search, `429 Retry-After` handling, and recursive `unknown_block_ids` follow-up fetches.
- Test coverage for artifact staging and live acceptance proof against Notion create/read/update flows.
