jest.mock('obsidian', () => ({}), { virtual: true });

import { SyncManager } from '../sync-manager';
import { LinearClient } from '../../api/linear-client';
import { DEFAULT_SETTINGS, LinearIssue, LinearPluginSettings, LinearWorkspace, NoteFrontmatter } from '../../models/types';

type MockFile = {
    path: string;
    name: string;
    content: string;
    frontmatter?: NoteFrontmatter;
};

type MockApp = {
    vault: {
        getMarkdownFiles: jest.Mock<MockFile[], []>;
        getAbstractFileByPath: jest.Mock<MockFile | { path: string } | null, [string]>;
        createFolder: jest.Mock<Promise<void>, [string]>;
        create: jest.Mock<Promise<MockFile>, [string, string]>;
    };
    metadataCache: {
        getFileCache: jest.Mock<{ frontmatter: NoteFrontmatter } | null, [MockFile]>;
    };
    fileManager: {
        processFrontMatter: jest.Mock<Promise<void>, [MockFile, (frontmatter: Record<string, unknown>) => void]>;
    };
};

const mockGetIssuesByApiKey = new Map<string, jest.Mock<Promise<LinearIssue[]>, [string | undefined, string | undefined]>>();

function createWorkspace(overrides: Partial<LinearWorkspace> = {}): LinearWorkspace {
    return {
        id: 'workspace-1',
        name: 'Workspace 1',
        apiKey: 'api-key-1',
        syncFolder: 'Linear/Workspace 1',
        teamIds: [],
        enabled: true,
        ...overrides
    };
}

function createIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
    return {
        id: 'issue-1',
        identifier: 'ENG-1',
        title: 'Issue title',
        description: 'Issue description',
        state: {
            id: 'state-1',
            name: 'Todo',
            type: 'unstarted'
        },
        assignee: {
            id: 'user-1',
            name: 'Jane Doe',
            email: 'jane@example.com'
        },
        team: {
            id: 'team-1',
            name: 'Engineering',
            key: 'ENG'
        },
        priority: 2,
        estimate: 3,
        labels: {
            nodes: [{ id: 'label-1', name: 'bug', color: '#ff0000' }]
        },
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-02T00:00:00.000Z',
        url: 'https://linear.app/issue/ENG-1',
        ...overrides
    };
}

function createFile(path: string, frontmatter?: NoteFrontmatter): MockFile {
    return {
        path,
        name: path.split('/').pop() ?? path,
        content: '',
        frontmatter
    };
}

function createMockApp(initialFiles: MockFile[] = []): MockApp {
    const files = [...initialFiles];
    const folders = new Set<string>(['Linear', 'Linear/Workspace 1', 'Linear/Workspace 2', 'Inbox']);

    const vault = {
        getMarkdownFiles: jest.fn(() => files),
        getAbstractFileByPath: jest.fn((path: string) => {
            if (folders.has(path)) return { path };
            return files.find(file => file.path === path) ?? null;
        }),
        createFolder: jest.fn(async (path: string) => {
            folders.add(path);
        }),
        create: jest.fn(async (path: string, content: string) => {
            const file = createFile(path);
            file.content = content;
            files.push(file);
            return file;
        })
    };

    return {
        vault,
        metadataCache: {
            getFileCache: jest.fn((file: MockFile) =>
                file.frontmatter ? { frontmatter: file.frontmatter } : null
            )
        },
        fileManager: {
            processFrontMatter: jest.fn(async (file: MockFile, updater: (frontmatter: Record<string, unknown>) => void) => {
                const frontmatter = { ...(file.frontmatter ?? {}) };
                updater(frontmatter);
                file.frontmatter = frontmatter as NoteFrontmatter;
            })
        }
    };
}

function createSettings(workspaces: LinearWorkspace[]): LinearPluginSettings {
    return {
        ...DEFAULT_SETTINGS,
        workspaces
    };
}

describe('SyncManager multi-workspace note matching', () => {
    beforeEach(() => {
        mockGetIssuesByApiKey.clear();
        jest.spyOn(LinearClient.prototype, 'getIssues').mockImplementation(function (
            this: { apiKey: string },
            teamId?: string,
            updatedAfter?: string
        ) {
            const apiKey = this.apiKey;
            const mock = mockGetIssuesByApiKey.get(apiKey);

            if (!mock) {
                throw new Error(`No getIssues mock configured for ${apiKey}`);
            }

            return mock(teamId, updatedAfter);
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('runs a full sync when lastSyncTime is missing', async () => {
        const workspace = createWorkspace();
        const issue = createIssue();
        const app = createMockApp();
        const plugin = { saveSettings: jest.fn(async () => undefined) };
        const settings = createSettings([workspace]);
        const getIssuesMock = jest.fn<Promise<LinearIssue[]>, [string | undefined, string | undefined]>()
            .mockResolvedValue([issue]);

        mockGetIssuesByApiKey.set(workspace.apiKey, getIssuesMock);

        const manager = new SyncManager(app as never, settings, plugin);
        const result = await manager.syncAll();

        expect(getIssuesMock).toHaveBeenCalledWith(undefined, undefined);
        expect(result.created).toBe(1);
        expect(app.vault.create).toHaveBeenCalledWith(
            'Linear/Workspace 1/ENG-1 - Issue title.md',
            expect.any(String)
        );

        const createdFile = app.vault.create.mock.results[0]?.value;
        await expect(createdFile).resolves.toMatchObject({
            frontmatter: expect.objectContaining({
                linear_workspace_id: workspace.id,
                linear_id: issue.id
            })
        });
    });

    it('bootstraps a workspace with existing lastSyncTime when no workspace-bound notes exist', async () => {
        const workspace = createWorkspace({ lastSyncTime: '2026-03-10T00:00:00.000Z' });
        const issue = createIssue();
        const app = createMockApp([
            createFile('Inbox/legacy.md', { linear_identifier: 'OTHER-1' })
        ]);
        const plugin = { saveSettings: jest.fn(async () => undefined) };
        const settings = createSettings([workspace]);
        const getIssuesMock = jest.fn<Promise<LinearIssue[]>, [string | undefined, string | undefined]>()
            .mockResolvedValue([issue]);

        mockGetIssuesByApiKey.set(workspace.apiKey, getIssuesMock);

        const manager = new SyncManager(app as never, settings, plugin);
        await manager.syncAll();

        expect(getIssuesMock).toHaveBeenCalledWith(undefined, undefined);
    });

    it('keeps incremental sync once a workspace-bound note exists', async () => {
        const workspace = createWorkspace({ lastSyncTime: '2026-03-10T00:00:00.000Z' });
        const issue = createIssue();
        const existingFile = createFile('Archive/ENG-1.md', {
            linear_workspace_id: workspace.id,
            linear_id: issue.id,
            linear_identifier: issue.identifier
        });
        const app = createMockApp([existingFile]);
        const plugin = { saveSettings: jest.fn(async () => undefined) };
        const settings = createSettings([workspace]);
        const getIssuesMock = jest.fn<Promise<LinearIssue[]>, [string | undefined, string | undefined]>()
            .mockResolvedValue([issue]);

        mockGetIssuesByApiKey.set(workspace.apiKey, getIssuesMock);

        const manager = new SyncManager(app as never, settings, plugin);
        const result = await manager.syncAll();

        expect(getIssuesMock).toHaveBeenCalledWith(undefined, '2026-03-10T00:00:00.000Z');
        expect(app.vault.create).not.toHaveBeenCalled();
        expect(result.updated).toBe(1);
        expect(existingFile.frontmatter?.linear_workspace_id).toBe(workspace.id);
    });

    it('does not match notes from another workspace by identifier', async () => {
        const workspaceOne = createWorkspace({
            id: 'workspace-1',
            name: 'Workspace 1',
            apiKey: 'api-key-1',
            syncFolder: 'Linear/Workspace 1'
        });
        const workspaceTwo = createWorkspace({
            id: 'workspace-2',
            name: 'Workspace 2',
            apiKey: 'api-key-2',
            syncFolder: 'Linear/Workspace 2'
        });
        const issue = createIssue({ id: 'issue-2', identifier: 'ENG-1', title: 'Workspace 2 issue' });
        const workspaceOneFile = createFile('Linear/Workspace 1/ENG-1.md', {
            linear_workspace_id: workspaceOne.id,
            linear_id: 'issue-1',
            linear_identifier: 'ENG-1'
        });
        const app = createMockApp([workspaceOneFile]);
        const plugin = { saveSettings: jest.fn(async () => undefined) };
        const settings = createSettings([workspaceTwo]);
        const getIssuesMock = jest.fn<Promise<LinearIssue[]>, [string | undefined, string | undefined]>()
            .mockResolvedValue([issue]);

        mockGetIssuesByApiKey.set(workspaceTwo.apiKey, getIssuesMock);

        const manager = new SyncManager(app as never, settings, plugin);
        const result = await manager.syncAll();

        expect(result.created).toBe(1);
        expect(app.vault.create).toHaveBeenCalledWith(
            'Linear/Workspace 2/ENG-1 - Workspace 2 issue.md',
            expect.any(String)
        );
        expect(workspaceOneFile.frontmatter?.linear_workspace_id).toBe(workspaceOne.id);
    });

    it('claims legacy notes inside the current syncFolder and backfills the workspace id', async () => {
        const workspace = createWorkspace({ lastSyncTime: '2026-03-10T00:00:00.000Z' });
        const issue = createIssue();
        const legacyFile = createFile('Linear/Workspace 1/ENG-1.md', {
            linear_identifier: issue.identifier
        });
        const app = createMockApp([legacyFile]);
        const plugin = { saveSettings: jest.fn(async () => undefined) };
        const settings = createSettings([workspace]);
        const getIssuesMock = jest.fn<Promise<LinearIssue[]>, [string | undefined, string | undefined]>()
            .mockResolvedValue([issue]);

        mockGetIssuesByApiKey.set(workspace.apiKey, getIssuesMock);

        const manager = new SyncManager(app as never, settings, plugin);
        const result = await manager.syncAll();

        expect(app.vault.create).not.toHaveBeenCalled();
        expect(result.updated).toBe(1);
        expect(legacyFile.frontmatter).toEqual(expect.objectContaining({
            linear_workspace_id: workspace.id,
            linear_id: issue.id,
            linear_identifier: issue.identifier
        }));
    });

    it('does not claim legacy notes outside the current syncFolder', async () => {
        const workspace = createWorkspace({ lastSyncTime: '2026-03-10T00:00:00.000Z' });
        const issue = createIssue();
        const legacyFile = createFile('Inbox/ENG-1.md', {
            linear_identifier: issue.identifier
        });
        const app = createMockApp([legacyFile]);
        const plugin = { saveSettings: jest.fn(async () => undefined) };
        const settings = createSettings([workspace]);
        const getIssuesMock = jest.fn<Promise<LinearIssue[]>, [string | undefined, string | undefined]>()
            .mockResolvedValue([issue]);

        mockGetIssuesByApiKey.set(workspace.apiKey, getIssuesMock);

        const manager = new SyncManager(app as never, settings, plugin);
        const result = await manager.syncAll();

        expect(result.created).toBe(1);
        expect(app.vault.create).toHaveBeenCalledWith(
            'Linear/Workspace 1/ENG-1 - Issue title.md',
            expect.any(String)
        );
        expect(legacyFile.frontmatter?.linear_workspace_id).toBeUndefined();
    });
});
