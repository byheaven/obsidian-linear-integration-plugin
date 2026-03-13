import { debugLog } from '../utils/debug';
import { App, TFile } from 'obsidian';
import { LinearClient } from '../api/linear-client';
import { LinearIssue, LinearPluginSettings, NoteFrontmatter, SyncResult } from '../models/types';
import { parseFrontmatter, updateFrontmatter } from '../utils/frontmatter';

export class SyncManager {
    constructor(
        private app: App,
        private linearClient: LinearClient,
        private settings: LinearPluginSettings,
        private plugin: any
    ) {}

    async syncAll(): Promise<SyncResult> {
        const result: SyncResult = {
            created: 0,
            updated: 0,
            errors: [],
            conflicts: []
        };

        try {
            // Ensure sync folder exists
            await this.ensureSyncFolder();

            // Get last sync time
            const lastSync = await this.getLastSyncTime();

            // Fetch issues from Linear
            const issues = await this.linearClient.getIssues(
                this.settings.teamId || undefined,
                lastSync
            );

            // Build vault-wide index of all notes linked to Linear issues (one-time scan)
            const linkedNotes = new Map<string, TFile>();
            for (const file of this.app.vault.getMarkdownFiles()) {
                const fm = parseFrontmatter(this.app, file);
                if (fm.linear_id) linkedNotes.set(fm.linear_id, file);
                if (fm.linear_identifier) linkedNotes.set(fm.linear_identifier, file);
            }

            // Process each issue
            for (const issue of issues) {
                try {
                    const file = await this.findOrCreateNoteForIssue(issue, linkedNotes);
                    const wasCreated = await this.updateNoteWithIssue(file, issue);
                    
                    if (wasCreated) {
                        result.created++;
                    } else {
                        result.updated++;
                    }
                } catch (error) {
                    result.errors.push(`Failed to sync issue ${issue.identifier}: ${(error as Error).message}`);
                }
            }

            // Update last sync time
            await this.setLastSyncTime(new Date().toISOString());

        } catch (error) {
            result.errors.push(`Sync failed: ${(error as Error).message}`);
        }

        return result;
    }

    async findOrCreateNoteForIssue(issue: LinearIssue, linkedNotes: Map<string, TFile>): Promise<TFile> {
        // O(1) lookup across entire vault
        const existing = linkedNotes.get(issue.id) || linkedNotes.get(issue.identifier);
        if (existing) return existing;

        // No existing note found — create in sync folder
        await this.ensureSyncFolder();
        const filename = this.sanitizeFilename(`${issue.identifier} - ${issue.title}.md`);
        const filepath = `${this.settings.syncFolder}/${filename}`;
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

    private async ensureSyncFolder(): Promise<void> {
        const folder = this.app.vault.getAbstractFileByPath(this.settings.syncFolder);
        if (!folder) {
            await this.app.vault.createFolder(this.settings.syncFolder);
        }
    }

    private sanitizeFilename(filename: string): string {
        return filename
            .replace(/[\\/:*?"<>|]/g, '-')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private async getLastSyncTime(): Promise<string | undefined> {
        // Get from plugin settings instead of separate file
        return this.settings.lastSyncTime;
    }

    private async setLastSyncTime(time: string): Promise<void> {
        try {
            // Update plugin settings
            this.settings.lastSyncTime = time;
            // Save settings (you'll need access to the plugin instance)
            await this.plugin.saveSettings();
            // This requires passing the plugin instance to SyncManager
        } catch (error) {
            debugLog.error('Failed to save last sync time:', error);
        }
    }    
}