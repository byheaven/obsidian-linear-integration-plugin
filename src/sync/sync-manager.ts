import { App, TFile } from 'obsidian';
import { LinearClient } from '../api/linear-client';
import { LinearIssue, LinearWorkspace, LinearPluginSettings, NoteFrontmatter, SyncResult } from '../models/types';
import { parseFrontmatter, updateFrontmatter } from '../utils/frontmatter';

interface IndexedNote {
    file: TFile;
    frontmatter: NoteFrontmatter;
    inSyncFolder: boolean;
}

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

            const linkedNotes = this.indexLinkedNotes(workspace.syncFolder);
            const shouldBootstrap = this.shouldBootstrapWorkspace(workspace, linkedNotes);
            const updatedAfter = shouldBootstrap ? undefined : workspace.lastSyncTime;
            const issues = await this.getIssuesForWorkspace(client, workspace, updatedAfter);

            // Always advance lastSyncTime on a successful fetch, even if no new issues
            workspace.lastSyncTime = new Date().toISOString();
            await this.plugin.saveSettings();

            if (issues.length === 0) return result;

            for (const issue of issues) {
                try {
                    const file = await this.findOrCreateNoteForIssue(issue, linkedNotes, workspace);
                    const wasCreated = await this.updateNoteWithIssue(file, issue, workspace);
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

    async findOrCreateNoteForIssue(issue: LinearIssue, linkedNotes: IndexedNote[], workspace: LinearWorkspace): Promise<TFile> {
        const existing = this.findMatchingNote(issue, linkedNotes, workspace);
        if (existing) return existing;

        const filename = this.sanitizeFilename(`${issue.identifier} - ${issue.title}.md`);
        const filepath = `${workspace.syncFolder}/${filename}`;
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

    async updateNoteWithIssue(file: TFile, issue: LinearIssue, workspace: LinearWorkspace): Promise<boolean> {
        const frontmatter = await this.getFrontmatter(file);

        const isNewNote = !frontmatter.linear_id && !frontmatter.linear_identifier;

        // Update frontmatter
        const updatedFrontmatter: NoteFrontmatter = {
            ...frontmatter,
            linear_workspace_id: workspace.id,
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

    private indexLinkedNotes(syncFolder: string): IndexedNote[] {
        return this.app.vault.getMarkdownFiles().map((file: TFile) => ({
            file,
            frontmatter: parseFrontmatter(this.app, file),
            inSyncFolder: this.isFileInSyncFolder(file.path, syncFolder)
        }));
    }

    private shouldBootstrapWorkspace(workspace: LinearWorkspace, linkedNotes: IndexedNote[]): boolean {
        if (!workspace.lastSyncTime) return true;

        return !linkedNotes.some(({ frontmatter }) =>
            frontmatter.linear_workspace_id === workspace.id &&
            Boolean(frontmatter.linear_id || frontmatter.linear_identifier)
        );
    }

    private async getIssuesForWorkspace(
        client: LinearClient,
        workspace: LinearWorkspace,
        updatedAfter?: string
    ): Promise<LinearIssue[]> {
        if (workspace.teamIds.length === 0) {
            return client.getIssues(undefined, updatedAfter);
        }

        const batches = await Promise.all(
            workspace.teamIds.map(tid => client.getIssues(tid, updatedAfter))
        );
        return batches.flat();
    }

    private findMatchingNote(issue: LinearIssue, linkedNotes: IndexedNote[], workspace: LinearWorkspace): TFile | null {
        const workspaceMatchById = linkedNotes.find(({ frontmatter }) =>
            frontmatter.linear_workspace_id === workspace.id &&
            frontmatter.linear_id === issue.id
        );
        if (workspaceMatchById) return workspaceMatchById.file;

        const workspaceMatchByIdentifier = linkedNotes.find(({ frontmatter }) =>
            frontmatter.linear_workspace_id === workspace.id &&
            frontmatter.linear_identifier === issue.identifier
        );
        if (workspaceMatchByIdentifier) return workspaceMatchByIdentifier.file;

        const legacyMatchById = linkedNotes.find(({ frontmatter, inSyncFolder }) =>
            !frontmatter.linear_workspace_id &&
            inSyncFolder &&
            frontmatter.linear_id === issue.id
        );
        if (legacyMatchById) return legacyMatchById.file;

        const legacyMatchByIdentifier = linkedNotes.find(({ frontmatter, inSyncFolder }) =>
            !frontmatter.linear_workspace_id &&
            inSyncFolder &&
            frontmatter.linear_identifier === issue.identifier
        );
        if (legacyMatchByIdentifier) return legacyMatchByIdentifier.file;

        return null;
    }

    private async ensureSyncFolder(syncFolder: string): Promise<void> {
        const folder = this.app.vault.getAbstractFileByPath(syncFolder);
        if (!folder) {
            await this.app.vault.createFolder(syncFolder);
        }
    }

    private isFileInSyncFolder(filePath: string, syncFolder: string): boolean {
        const normalizedSyncFolder = syncFolder.replace(/\/+$/, '');
        if (!normalizedSyncFolder) return false;

        return filePath.startsWith(`${normalizedSyncFolder}/`);
    }

    private sanitizeFilename(filename: string): string {
        return filename
            .replace(/[\\/:*?"<>|]/g, '-')
            .replace(/\s+/g, ' ')
            .trim();
    }

}
