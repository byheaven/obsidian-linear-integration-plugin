import { App, TFile } from 'obsidian';
import { LinearClient } from '../api/linear-client';
import { LinearIssue, LinearWorkspace, LinearPluginSettings, NoteFrontmatter, SyncResult } from '../models/types';
import { parseFrontmatter, updateFrontmatter } from '../utils/frontmatter';

export class SyncManager {
    constructor(
        private app: App,
        private settings: LinearPluginSettings,
        private plugin: any
    ) {}

    async syncAll(): Promise<SyncResult> {
        const result: SyncResult = { created: 0, updated: 0, errors: [], conflicts: [] };
        const enabled = this.settings.workspaces.filter(w => w.enabled);
        if (enabled.length === 0) return result;

        const settled = await Promise.allSettled(enabled.map(w => this.syncWorkspace(w)));

        settled.forEach((r, i) => {
            if (r.status === 'fulfilled') {
                result.created += r.value.created;
                result.updated += r.value.updated;
                result.errors.push(...r.value.errors);
                result.conflicts.push(...r.value.conflicts);
            } else {
                result.errors.push(`[${enabled[i].id}] Sync failed: ${r.reason}`);
            }
        });

        return result;
    }

    private async syncWorkspace(workspace: LinearWorkspace): Promise<SyncResult> {
        const result: SyncResult = { created: 0, updated: 0, errors: [], conflicts: [] };
        const client = new LinearClient(workspace.apiKey);

        try {
            await this.ensureSyncFolder(workspace.syncFolder);

            let issues: LinearIssue[] = [];
            if (workspace.teamIds.length === 0) {
                issues = await client.getIssues(undefined, workspace.lastSyncTime);
            } else {
                const batches = await Promise.all(
                    workspace.teamIds.map(tid => client.getIssues(tid, workspace.lastSyncTime))
                );
                issues = batches.flat();
            }

            // Always advance lastSyncTime on a successful fetch, even if no new issues
            workspace.lastSyncTime = new Date().toISOString();
            await this.plugin.saveSettings();

            if (issues.length === 0) return result;

            const linkedNotes = new Map<string, TFile>();
            for (const file of this.app.vault.getMarkdownFiles()) {
                const fm = parseFrontmatter(this.app, file);
                if (fm.linear_id) linkedNotes.set(fm.linear_id, file);
                if (fm.linear_identifier) linkedNotes.set(fm.linear_identifier, file);
            }

            for (const issue of issues) {
                try {
                    const file = await this.findOrCreateNoteForIssue(issue, linkedNotes, workspace.syncFolder);
                    const wasCreated = await this.updateNoteWithIssue(file, issue);
                    if (wasCreated) result.created++;
                    else result.updated++;
                } catch (error) {
                    result.errors.push(`[${workspace.id}] Failed to sync ${issue.identifier}: ${(error as Error).message}`);
                }
            }

        } catch (error) {
            result.errors.push(`[${workspace.id}] Sync failed: ${(error as Error).message}`);
            // Do NOT update lastSyncTime — next sync retries from last successful point
        }

        return result;
    }

    async findOrCreateNoteForIssue(issue: LinearIssue, linkedNotes: Map<string, TFile>, syncFolder: string): Promise<TFile> {
        const existing = linkedNotes.get(issue.id) || linkedNotes.get(issue.identifier);
        if (existing) return existing;

        const filename = this.sanitizeFilename(`${issue.identifier} - ${issue.title}.md`);
        const filepath = `${syncFolder}/${filename}`;
        const content = this.generateNoteContent(issue);
        return await this.app.vault.create(filepath, content);
    }

    generateNoteContent(issue: LinearIssue): string {
        const template = this.settings.noteTemplate;
        const statusIcon = this.settings.statusMapping[issue.state.name] || '📋';
        
        return template
            .replace(/{{title}}/g, issue.title)
            .replace(/{{status}}/g, `${statusIcon} ${issue.state.name}`)
            .replace(/{{assignee}}/g, issue.assignee?.name || 'Unassigned')
            .replace(/{{team}}/g, issue.team.name)
            .replace(/{{created}}/g, new Date(issue.createdAt).toLocaleDateString())
            .replace(/{{updated}}/g, new Date(issue.updatedAt).toLocaleDateString())
            .replace(/{{description}}/g, issue.description || 'No description')
            .replace(/{{url}}/g, issue.url)
            .replace(/{{lastSync}}/g, new Date().toLocaleString());
    }

    async updateNoteWithIssue(file: TFile, issue: LinearIssue): Promise<boolean> {
        
        const frontmatter = await this.getFrontmatter(file);
        
        const isNewNote = !frontmatter.linear_id;
        
        // Update frontmatter
        const updatedFrontmatter: NoteFrontmatter = {
            ...frontmatter,
            linear_id: issue.id,
            linear_identifier: issue.identifier,
            linear_status: issue.state.name,
            linear_assignee: issue.assignee?.name,
            linear_team: issue.team.name,
            linear_url: issue.url,
            linear_created: issue.createdAt,
            linear_updated: issue.updatedAt,
            linear_last_synced: new Date().toISOString(),
            linear_priority: issue.priority,
            linear_estimate: issue.estimate,
            linear_labels: issue.labels.nodes.map(label => label.name)
        };

        // Always use processFrontMatter to update frontmatter — this preserves
        // user-defined properties (including quoted wikilinks like "[[Note]]")
        // and never replaces existing note content.
        await updateFrontmatter(this.app, file, updatedFrontmatter);

        return isNewNote;
    }

    async getFrontmatter(file: TFile): Promise<NoteFrontmatter> {
        
        return parseFrontmatter(this.app, file);
    }

    async getLinearIdFromNote(file: TFile): Promise<string | null> {
        const frontmatter = await this.getFrontmatter(file);
        return frontmatter.linear_id || null;
    }

    private async ensureSyncFolder(syncFolder: string): Promise<void> {
        const folder = this.app.vault.getAbstractFileByPath(syncFolder);
        if (!folder) {
            await this.app.vault.createFolder(syncFolder);
        }
    }

    private sanitizeFilename(filename: string): string {
        return filename
            .replace(/[\\/:*?"<>|]/g, '-')
            .replace(/\s+/g, ' ')
            .trim();
    }

}