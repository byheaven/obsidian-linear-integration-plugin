# Obsidian CLI E2E

This directory contains the local end-to-end suite for the Linear Integration plugin.

## When To Run It

Run the suite after any substantial change that affects:

- sync behavior
- frontmatter shape
- managed note body
- issue creation from notes
- comments
- multi-workspace behavior
- settings and migrations

If a pull request changes any of those areas, it must include an E2E run and must also add or update at least one case.

## Preconditions

- Obsidian desktop is open and the target vault is loaded.
- The Obsidian CLI can reach that running vault.
- The target vault already has the `linear-integration` plugin configured.
- At least two workspaces are enabled in `.obsidian/plugins/linear-integration/data.json`.
- The configured API keys are valid.

## Commands

```bash
npm run e2e:list
npm run e2e:smoke
npm run e2e
```

To target a different vault:

```bash
npm run e2e -- --vault-path /absolute/path/to/vault
```

## What The Runner Does

- reads the configured plugin settings from the target vault
- selects the first two enabled workspaces
- creates temporary notes and issues using a `RUN_ID`
- drives the plugin through Obsidian CLI debug commands
- captures reports, snapshots, console output, and screenshots under `tests/e2e/artifacts/<RUN_ID>/`
- deletes local temporary notes and any synced notes bound to the temporary test issues
- permanently deletes remote temporary issues during cleanup

## Artifacts

Each run writes:

- `report.json`
- `report.md`
- `runner.log`
- snapshots of notes before and after key transitions
- `dev:errors` and console dumps per case

Artifacts are intentionally kept after cleanup so failures can be investigated.

## Cases

The human-readable case definitions live in `tests/e2e/cases/`.

The executable case registry lives in `scripts/e2e/cases/index.ts`.

## Maintenance Rules

- Every sync bugfix or new sync feature must add at least one new E2E assertion, or extend an existing case.
- The suite should stay additive. Prefer adding new cases or expected results over rewriting history.
- If a change is large enough that you would manually sanity-check it in Obsidian, it is large enough to require `npm run e2e` or `npm run e2e:smoke`.
