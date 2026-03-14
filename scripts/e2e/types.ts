export interface WorkspaceConfig {
    id: string;
    name: string;
    apiKey: string;
    syncFolder: string;
    teamIds: string[];
    lastSyncTime?: string;
    enabled: boolean;
}

export interface PluginSettingsSnapshot {
    workspaces: WorkspaceConfig[];
    defaultWorkspaceId: string | null;
    includeComments: boolean;
    debugMode: boolean;
}

export interface LinearTeam {
    id: string;
    name: string;
    key: string;
}

export interface LinearState {
    id: string;
    name: string;
    type: string;
}

export interface LinearUser {
    id: string;
    name: string;
    email: string;
}

export interface LinearLabel {
    id: string;
    name: string;
    color: string;
}

export interface LinearComment {
    id: string;
    body: string;
    createdAt: string;
    user: {
        name: string;
    };
}

export interface LinearIssue {
    id: string;
    identifier: string;
    title: string;
    description?: string;
    state: {
        id: string;
        name: string;
        type: string;
    };
    assignee?: {
        id: string;
        name: string;
        email: string;
    };
    team: {
        id: string;
        name: string;
        key: string;
    };
    priority: number;
    labels: {
        nodes: LinearLabel[];
    };
    createdAt: string;
    updatedAt: string;
    url: string;
    comments?: {
        nodes: LinearComment[];
    };
}

export interface NoteFrontmatter {
    linear_workspace_id?: string;
    linear_id?: string;
    linear_identifier?: string;
    linear_title?: string;
    linear_description?: string;
    linear_status?: string;
    linear_status_id?: string;
    linear_assignee?: string;
    linear_assignee_id?: string;
    linear_team?: string;
    linear_team_id?: string;
    linear_url?: string;
    linear_created?: string;
    linear_updated?: string;
    linear_last_synced?: string;
    linear_priority?: number;
    linear_estimate?: number;
    linear_labels?: string[];
    [key: string]: unknown;
}

export interface ParsedNote {
    raw: string;
    frontmatter: NoteFrontmatter;
    body: string;
}

export interface CaseDefinition {
    id: string;
    name: string;
    summary: string;
    smoke: boolean;
    run: (context: E2EContext) => Promise<void>;
}

export interface CaseResult {
    id: string;
    name: string;
    status: 'passed' | 'failed' | 'skipped';
    durationMs: number;
    artifacts: string[];
    error?: string;
}

export interface WorkspaceRuntime {
    config: WorkspaceConfig;
    client: LinearClientLike;
    team: LinearTeam;
    state: LinearState;
    user?: LinearUser;
    tempNotePath: string;
    issue?: LinearIssue;
}

export interface SharedState {
    originalDefaultWorkspaceId: string | null;
    workspacesById: Record<string, WorkspaceRuntime>;
    localNotes: string[];
    remoteIssues: Array<{ workspaceId: string; issueId: string }>;
}

export interface E2EOptions {
    suite: 'full' | 'smoke' | 'list';
    vaultPath: string;
    vaultName: string;
    pluginId: string;
}

export interface E2EContext {
    options: E2EOptions;
    runId: string;
    pluginSettings: PluginSettingsSnapshot;
    artifactRoot: string;
    cases: CaseDefinition[];
    results: CaseResult[];
    shared: SharedState;
    obsidian: ObsidianCliLike;
    captureArtifact: (relativePath: string, content: string) => Promise<string>;
    snapshotNote: (label: string, vaultRelativePath: string) => Promise<string>;
    log: (message: string) => void;
}

export interface ObsidianCliLike {
    reloadPlugin(pluginId: string): Promise<void>;
    getErrors(): Promise<string>;
    getConsole(level?: 'log' | 'warn' | 'error' | 'info' | 'debug'): Promise<string>;
    screenshot(destination: string): Promise<void>;
    domText(selector: string, all?: boolean): Promise<string>;
    eval<T = string>(code: string): Promise<T>;
    evalJson<T>(code: string): Promise<T>;
    open(path: string, newTab?: boolean): Promise<void>;
    read(path: string): Promise<string>;
    create(path: string, content: string, open?: boolean): Promise<void>;
    setProperty(path: string, name: string, value: string | number | boolean | string[], type?: 'text' | 'list' | 'number' | 'checkbox' | 'date' | 'datetime'): Promise<void>;
    delete(path: string): Promise<void>;
}

export interface LinearClientLike {
    getTeams(): Promise<LinearTeam[]>;
    getUsers(): Promise<LinearUser[]>;
    getTeamStates(teamId: string): Promise<LinearState[]>;
    getIssueById(id: string): Promise<LinearIssue | null>;
    createIssue(input: {
        title: string;
        description: string;
        teamId: string;
        assigneeId?: string;
        stateId?: string;
        priority?: number;
        labelNames?: string[];
    }): Promise<LinearIssue>;
    updateIssue(
        id: string,
        updates: Partial<{
            title: string;
            description: string;
            stateId: string;
            assigneeId: string | null;
            priority: number;
            labelNames: string[];
            teamId: string;
        }>
    ): Promise<LinearIssue>;
    addComment(issueId: string, body: string): Promise<void>;
    deleteIssue(issueId: string): Promise<void>;
}
