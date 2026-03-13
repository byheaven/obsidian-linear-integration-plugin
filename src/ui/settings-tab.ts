import { App, PluginSettingTab, Setting, Notice, Modal } from 'obsidian';
import LinearPlugin from '../../main';
import { LinearWorkspace } from '../models/types';
import { LinearClient } from '../api/linear-client';

class StatusMappingModal extends Modal {
    private statusName: string = '';
    private iconValue: string = '';
    private onSubmit: (status: string, icon: string) => void;
    private existingStatuses: string[];

    constructor(
        app: App, 
        onSubmit: (status: string, icon: string) => void,
        existingStatuses: string[] = []
    ) {
        super(app);
        this.onSubmit = onSubmit;
        this.existingStatuses = existingStatuses;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        new Setting(contentEl).setName('Add custom status mapping').setHeading();

        // Show existing mappings for reference
        if (this.existingStatuses.length > 0) {
            const existingEl = contentEl.createEl('div', { cls: 'setting-item-description' });
            existingEl.createEl('strong', { text: 'Existing mappings: ' });
            existingEl.createSpan({ text: this.existingStatuses.join(', ') });
        }

        // Status name input
        new Setting(contentEl)
            .setName('Status name')
            .setDesc('Enter the Linear status name (case-sensitive)')
            .addText(text => {
                text.setPlaceholder('e.g., "In Review", "Blocked", "Ready for QA"')
                    .setValue(this.statusName)
                    .onChange(value => this.statusName = value);
                
                text.inputEl.focus();
                return text;
            });

        // Icon input with emoji suggestions
        new Setting(contentEl)
            .setName('Icon/Emoji')
            .setDesc('Enter an emoji or icon')
            .addText(text => {
                text.setPlaceholder('e.g., 👀, 🚫, ⭐, 🧪, 🚀')
                    .setValue(this.iconValue)
                    .onChange(value => this.iconValue = value);
                
                return text;
            });

        // Emoji quick picks
        const emojiContainer = contentEl.createDiv({ cls: 'emoji-quick-picks' });
        emojiContainer.createEl('span', { text: 'Quick picks: ', cls: 'emoji-label' });
        
        const commonEmojis = ['👀', '🚫', '⭐', '🧪', '🚀', '✋', '🔄', '⏸️', '🎯', '💡'];
        commonEmojis.forEach(emoji => {
            const emojiBtn = emojiContainer.createEl('button', { 
                text: emoji,
                cls: 'emoji-quick-pick'
            });
            emojiBtn.onclick = () => {
                this.iconValue = emoji;
                // Update the text input
                const iconInput = contentEl.querySelector('input[placeholder*="emoji"]') as HTMLInputElement;
                if (iconInput) {
                    iconInput.value = emoji;
                }
            };
        });

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
        
        const addButton = buttonContainer.createEl('button', { 
            text: 'Add mapping',
            cls: 'mod-cta'
        });
        addButton.onclick = () => this.submit();

        const cancelButton = buttonContainer.createEl('button', { 
            text: 'Cancel'
        });
        cancelButton.onclick = () => this.close();

        // Allow Enter key to submit
        contentEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.submit();
            }
        });
    }

    private submit(): void {
        if (!this.statusName.trim()) {
            new Notice('Please enter a status name');
            return;
        }

        if (!this.iconValue.trim()) {
            new Notice('Please enter an icon or emoji');
            return;
        }

        // Check if status already exists
        if (this.existingStatuses.includes(this.statusName.trim())) {
            new Notice('This status mapping already exists. It will be updated.');
        }

        this.onSubmit(this.statusName.trim(), this.iconValue.trim());
        this.close();
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}

export class LinearSettingsTab extends PluginSettingTab {
    plugin: LinearPlugin;

    constructor(app: App, plugin: LinearPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // ── Workspaces ───────────────────────────────────────────────────────────
        containerEl.createEl('h3', { text: 'Workspaces' });

        // Default workspace selector
        const defaultWorkspaceSetting = new Setting(containerEl)
            .setName('Default workspace')
            .setDesc('Used for autocomplete, issue creation, and Kanban/Agenda generation.');

        const renderDefaultDropdown = () => {
            defaultWorkspaceSetting.controlEl.empty();
            const select = defaultWorkspaceSetting.controlEl.createEl('select');
            const enabled = this.plugin.settings.workspaces.filter((w: LinearWorkspace) => w.enabled);
            if (enabled.length === 0) {
                select.createEl('option', { text: 'No workspaces enabled', value: '' });
                select.disabled = true;
            } else {
                enabled.forEach((w: LinearWorkspace) => {
                    const opt = select.createEl('option', { text: w.name || w.id, value: w.id });
                    if (w.id === this.plugin.settings.defaultWorkspaceId) opt.selected = true;
                });
                select.addEventListener('change', async () => {
                    this.plugin.settings.defaultWorkspaceId = select.value;
                    await this.plugin.saveSettings();
                });
            }
        };
        renderDefaultDropdown();

        // Workspace list
        const workspaceListEl = containerEl.createDiv({ cls: 'linear-workspace-list' });

        const renderWorkspaceList = () => {
            workspaceListEl.empty();
            this.plugin.settings.workspaces.forEach((workspace: LinearWorkspace, index: number) => {
                const row = workspaceListEl.createDiv({ cls: 'linear-workspace-row' });
                const header = row.createDiv({ cls: 'linear-workspace-header' });

                // Enabled toggle
                const toggle = header.createEl('input', { type: 'checkbox' });
                toggle.checked = workspace.enabled;
                toggle.addEventListener('change', async () => {
                    workspace.enabled = toggle.checked;
                    await this.plugin.saveSettings();
                    renderDefaultDropdown();
                });

                header.createSpan({ text: ` ${workspace.name || `Workspace ${index + 1}`}` });
                if (workspace.syncFolder) header.createSpan({ text: ` · ${workspace.syncFolder}`, cls: 'linear-workspace-folder' });

                // Expand button
                let expanded = !workspace.name; // auto-expand new workspaces
                const expandBtn = header.createEl('button', { text: expanded ? '▲' : '▼' });
                const details = row.createDiv({ cls: 'linear-workspace-details' });
                details.style.display = expanded ? 'block' : 'none';
                expandBtn.addEventListener('click', () => {
                    expanded = !expanded;
                    details.style.display = expanded ? 'block' : 'none';
                    expandBtn.textContent = expanded ? '▲' : '▼';
                });

                // Delete button
                const deleteBtn = header.createEl('button', { text: '✕' });
                deleteBtn.addEventListener('click', async () => {
                    const msg = workspace.lastSyncTime
                        ? `Delete "${workspace.name || 'this workspace'}"? Sync history will be lost.`
                        : `Delete "${workspace.name || 'this workspace'}"?`;
                    if (confirm(msg)) {
                        this.plugin.settings.workspaces.splice(index, 1);
                        if (this.plugin.settings.defaultWorkspaceId === workspace.id) {
                            this.plugin.settings.defaultWorkspaceId = null;
                        }
                        await this.plugin.saveSettings();
                        renderWorkspaceList();
                        renderDefaultDropdown();
                    }
                });

                // ── Expanded details ──────────────────────────────────────────────

                // Name field
                new Setting(details).setName('Name').addText(text =>
                    text.setValue(workspace.name).onChange(async val => {
                        workspace.name = val;
                        await this.plugin.saveSettings();
                        // Update header label in-place without re-rendering the whole list
                        const nameSpan = header.querySelector('span');
                        if (nameSpan) nameSpan.textContent = ` ${val || `Workspace ${index + 1}`}`;
                        renderDefaultDropdown();
                    })
                );

                // API Key + Test Connection
                let teamsSelect: HTMLSelectElement | null = null;
                const apiKeySetting = new Setting(details).setName('API Key').addText(text => {
                    text.inputEl.type = 'password';
                    text.setValue(workspace.apiKey).onChange(async val => {
                        workspace.apiKey = val;
                        await this.plugin.saveSettings();
                    });
                });
                apiKeySetting.addButton(btn =>
                    btn.setButtonText('Test Connection').onClick(async () => {
                        if (!workspace.apiKey) { new Notice('Enter an API key first.'); return; }
                        btn.setButtonText('Testing…').setDisabled(true);
                        try {
                            const client = new LinearClient(workspace.apiKey);
                            const ok = await client.testConnection();
                            if (!ok) {
                                new Notice('Connection failed. Check the API key.');
                                return;
                            }
                            new Notice('Connected!');
                            try {
                                const teams = await client.getTeams();
                                if (teamsSelect) {
                                    teamsSelect.replaceChildren();
                                    teams.forEach(t => {
                                        const opt = teamsSelect!.createEl('option', { text: t.name, value: t.id });
                                        opt.selected = workspace.teamIds.includes(t.id);
                                    });
                                }
                            } catch {
                                new Notice('Connected, but failed to load teams.');
                            }
                        } catch {
                            new Notice('Connection failed.');
                        } finally {
                            btn.setButtonText('Test Connection').setDisabled(false);
                        }
                    })
                );

                // Sync Folder
                new Setting(details).setName('Sync folder').addText(text =>
                    text.setPlaceholder('Linear/Work').setValue(workspace.syncFolder).onChange(async val => {
                        workspace.syncFolder = val;
                        await this.plugin.saveSettings();
                    })
                );

                // Teams multi-select
                const teamsSetting = new Setting(details)
                    .setName('Teams')
                    .setDesc('Leave empty to sync all teams. Click "Test Connection" to load options.');
                teamsSelect = teamsSetting.controlEl.createEl('select');
                teamsSelect.multiple = true;
                teamsSelect.style.minHeight = '80px';
                // Show previously saved teamIds as placeholder options until Test Connection is clicked
                workspace.teamIds.forEach(tid => {
                    teamsSelect!.createEl('option', { text: tid, value: tid }).selected = true;
                });
                teamsSelect.addEventListener('change', async () => {
                    workspace.teamIds = Array.from(teamsSelect!.selectedOptions).map(o => o.value);
                    await this.plugin.saveSettings();
                });
            });
        };
        renderWorkspaceList();

        // Add Workspace button
        new Setting(containerEl).addButton(btn =>
            btn.setButtonText('+ Add Workspace').onClick(async () => {
                this.plugin.settings.workspaces.push({
                    id: crypto.randomUUID(),
                    name: '',
                    apiKey: '',
                    syncFolder: '',
                    teamIds: [],
                    enabled: true,
                });
                await this.plugin.saveSettings();
                renderWorkspaceList();
                renderDefaultDropdown();
            })
        );

        new Setting(containerEl).setName('Synchronization').setHeading();

        // Auto sync toggle
        new Setting(containerEl)
            .setName('Auto sync')
            .setDesc('Automatically sync with Linear on startup')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoSync)
                .onChange(async (value) => {
                    this.plugin.settings.autoSync = value;
                    await this.plugin.saveSettings();
                }));

        // Auto sync interval
        new Setting(containerEl)
            .setName('Auto sync interval')
            .setDesc('Minutes between automatic syncs (0 to disable)')
            .addSlider(slider => slider
                .setLimits(0, 120, 5)
                .setValue(this.plugin.settings.autoSyncInterval)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.autoSyncInterval = value;
                    await this.plugin.saveSettings();
                }));

        // Include description toggle
        new Setting(containerEl)
            .setName('Include description')
            .setDesc('Include Linear issue descriptions in notes')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.includeDescription)
                .onChange(async (value) => {
                    this.plugin.settings.includeDescription = value;
                    await this.plugin.saveSettings();
                }));

        // Include comments toggle
        new Setting(containerEl)
            .setName('Include comments')
            .setDesc('Include Linear issue comments in notes')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.includeComments)
                .onChange(async (value) => {
                    this.plugin.settings.includeComments = value;
                    await this.plugin.saveSettings();
                }));

        // Add auto-fill from Note expressions setting
        new Setting(containerEl)
            .setName('Auto-fill from note expressions')
            .setDesc('Automatically fill Linear fields in the create modal based on @team/, @assignee/, @priority/ expressions found in the note')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoFillFromExpressions)
                .onChange(async (value) => {
                    this.plugin.settings.autoFillFromExpressions = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl).setName('Note template').setHeading();

        // Note template setting
        new Setting(containerEl)
            .setName('Note template')
            .setDesc('Template for generated notes. Available variables: {{title}}, {{status}}, {{assignee}}, {{team}}, {{created}}, {{updated}}, {{description}}, {{url}}, {{lastSync}}')
            .addTextArea(text => {
                text.setValue(this.plugin.settings.noteTemplate);
                text.inputEl.rows = 10;
                text.inputEl.cols = 50;
                text.onChange(async (value) => {
                    this.plugin.settings.noteTemplate = value;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName('Status mapping')
            .setDesc('Map Linear issue states to emoji icons in your notes:')
            .setHeading();

        // Status mapping settings
        Object.entries(this.plugin.settings.statusMapping).forEach(([status, icon]) => {
            new Setting(containerEl)
                .setName(status)
                .addText(text => text
                    .setValue(icon)
                    .onChange(async (value) => {
                        this.plugin.settings.statusMapping[status] = value;
                        await this.plugin.saveSettings();
                    }));
        });

        // Add custom status mapping
        new Setting(containerEl)
            .setName('Add custom status mapping')
            .setDesc('Add a new status → icon mapping')
            .addButton(button => button
                .setButtonText('Add')
                .onClick(() => {
                    const existingStatuses = Object.keys(this.plugin.settings.statusMapping);
                    new StatusMappingModal(this.app, async (status, icon) => {
                        this.plugin.settings.statusMapping[status] = icon;
                        await this.plugin.saveSettings();
                        new Notice(`Added mapping: ${status} → ${icon}`);
                        this.display();
                    }, existingStatuses).open();
                }));
        // Add debug mode 
        new Setting(containerEl)
            .setName('Debug mode')
            .setDesc('Enable debug logging in browser console for troubleshooting')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.debugMode)
                .onChange(async (value) => {
                    this.plugin.settings.debugMode = value;
                    await this.plugin.saveSettings();
                    
                    // ✅ Update debug mode immediately
                    const { debugLog } = await import('../utils/debug');
                    debugLog.setDebugMode(value);
                    
                    // Show feedback
                    if (value) {
                        new Notice('🐛 Debug mode enabled - check browser console');
                    } else {
                        new Notice('Debug mode disabled');
                    }
                }));
    }

}