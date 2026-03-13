# Multi-Workspace Support — Design Spec

**Date:** 2026-03-13
**Status:** Approved

---

## Overview

Add full multi-workspace support to the Linear ↔ Obsidian plugin. A "workspace" maps to a single Linear organization (one API key per organization). Each workspace has its own sync folder, team filter, and last-sync timestamp. All enabled workspaces sync in parallel when the user triggers a sync.

No migration from the existing single-workspace settings. Users reconfigure from scratch.

---

## Data Model

### `LinearWorkspace` (updated)

```typescript
export interface LinearWorkspace {
    id: string;           // locally-generated UUID
    name: string;         // user-defined display name, e.g. "Work", "Personal"
    apiKey: string;
    syncFolder: string;   // vault path for this workspace's notes
    teamIds: string[];    // empty array = sync all teams in this workspace
    lastSyncTime?: string;
    enabled: boolean;
}
```

### `LinearPluginSettings` (simplified)

Remove the following top-level fields (all move into `LinearWorkspace`):
- `apiKey`
- `teamId`
- `syncFolder`
- `lastSyncTime`
- `multiWorkspaceSupport`

Retain all global fields:
- `workspaces: LinearWorkspace[]`
- `autoSync: boolean`
- `autoSyncInterval: number`
- `noteTemplate: string`
- `statusMapping: { [key: string]: string }`
- `includeDescription: boolean`
- `includeComments: boolean`
- `autocompleteEnabled: boolean`
- `debugMode: boolean`

---

## SyncManager Architecture

### Constructor

Remove the `LinearClient` parameter. SyncManager creates clients on demand per workspace.

```typescript
// Before
new SyncManager(app, linearClient, settings, plugin)

// After
new SyncManager(app, settings, plugin)
```

### `syncAll()` — parallel across workspaces

```typescript
async syncAll(): Promise<SyncResult> {
    const enabled = this.settings.workspaces.filter(w => w.enabled);
    if (enabled.length === 0) return emptyResult();

    const results = await Promise.allSettled(
        enabled.map(w => this.syncWorkspace(w))
    );

    return aggregateResults(enabled, results);
    // errors are prefixed with "[WorkspaceName]: " for traceability
}
```

### `syncWorkspace(workspace: LinearWorkspace)` — single workspace

Extracted from the current `syncAll()` logic, parameterized:
- Creates `new LinearClient(workspace.apiKey)`
- Passes `workspace.teamIds` as the team filter (empty = no filter)
- Uses `workspace.lastSyncTime` for incremental sync
- Uses `workspace.syncFolder` as the note destination
- Updates `workspace.lastSyncTime` on completion, then calls `saveSettings()`

### Return type

`SyncResult` is unchanged (`created`, `updated`, `errors[]`). Error strings are prefixed with `[WorkspaceName]` to identify the source workspace.

---

## Settings UI

### Workspace Management Section

Replaces the current top-level API Key / Team / Sync Folder fields. Positioned at the top of the settings tab.

**List view** — each workspace renders as a collapsed row:
```
[enabled toggle]  Work  ·  Linear/Work  [▼ expand]  [delete]
```

**Expanded view** — reveals the workspace's configuration fields:
| Field | Control |
|---|---|
| Name | Text input |
| API Key | Password input + "Test Connection" button |
| Sync Folder | Text input |
| Teams | Multi-select dropdown (loaded after API key validates; empty = all teams) |

**"+ Add Workspace"** button at the bottom of the list. New workspaces are added in expanded state.

**Interaction details:**
- Test Connection loads the Teams dropdown on success
- Delete triggers a browser `confirm()` dialog
- Every field change calls `saveSettings()` immediately

### Impact on Other Features

| Feature | Change |
|---|---|
| `IssueCreateModal` | Workspace selector added: dropdown of enabled workspaces, pre-selects the first enabled one |
| Autocomplete / Kanban / Agenda | Use `plugin.getDefaultClient()` — returns a `LinearClient` for the first enabled workspace |
| `BatchOperationManager` | Uses `plugin.getDefaultClient()` |

### `plugin.getDefaultClient()`

New helper on the plugin class:

```typescript
getDefaultClient(): LinearClient | null {
    const workspace = this.settings.workspaces.find(w => w.enabled);
    return workspace ? new LinearClient(workspace.apiKey) : null;
}
```

The single `this.linearClient` field on the plugin is removed. All existing call sites are updated to use `getDefaultClient()`.

---

## File Change Summary

| File | Change |
|---|---|
| `src/models/types.ts` | Update `LinearWorkspace`, remove 5 top-level fields from `LinearPluginSettings` and `DEFAULT_SETTINGS` |
| `src/sync/sync-manager.ts` | Remove `LinearClient` constructor param; add `syncWorkspace()`; rewrite `syncAll()` for parallel execution |
| `src/ui/settings-tab.ts` | Replace API Key/Team/Folder section with workspace management UI |
| `main.ts` | Remove `this.linearClient` field; add `getDefaultClient()`; update `SyncManager` constructor call |
| `src/features/local-config-system.ts` | Update `BatchOperationManager` to use `plugin.getDefaultClient()` |
| `src/ui/issue-modal.ts` | Add workspace selector dropdown |

---

## Out of Scope

- Migration from existing single-workspace settings (users reconfigure)
- Per-workspace note templates or status mappings (global settings apply to all)
- Workspace-level sync schedules (one global auto-sync interval)
