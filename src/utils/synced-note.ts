import { LinearIssue } from '../models/types';

export const LINEAR_ISSUE_SECTION = '## Linear Issue';
export const NEW_COMMENT_SECTION = '## New Comment';
export const COMMENTS_SECTION = '## Comments';
export const COMMENT_SYNC_PREFIX = '--- Synced to Linear at ';
export const COMMENT_SYNC_SUFFIX = ' ---';
export const DEFAULT_COMMENT_SYNC_LABEL = 'Never';

export interface ManagedNoteState {
    draftText: string;
    syncLabel: string;
}

export function createCommentSyncMarker(syncLabel: string): string {
    return `${COMMENT_SYNC_PREFIX}${syncLabel}${COMMENT_SYNC_SUFFIX}`;
}

export function parseManagedNoteState(content: string): ManagedNoteState {
    const newCommentStart = content.indexOf(NEW_COMMENT_SECTION);
    if (newCommentStart < 0) {
        return {
            draftText: '',
            syncLabel: DEFAULT_COMMENT_SYNC_LABEL
        };
    }

    const commentsStart = content.indexOf(COMMENTS_SECTION, newCommentStart + NEW_COMMENT_SECTION.length);
    const draftSection = content
        .slice(newCommentStart + NEW_COMMENT_SECTION.length, commentsStart >= 0 ? commentsStart : undefined)
        .trimStart();

    const lines = draftSection.split('\n');
    const markerLine = lines[0]?.trim();
    const syncLabel = extractSyncLabel(markerLine) ?? DEFAULT_COMMENT_SYNC_LABEL;
    const draftText = lines.slice(1).join('\n').trim();

    return {
        draftText,
        syncLabel
    };
}

export function renderManagedNoteBody(
    issue: LinearIssue,
    state: ManagedNoteState,
    includeComments: boolean
): string {
    const comments = issue.comments?.nodes ?? [];
    const lines = [
        LINEAR_ISSUE_SECTION,
        '',
        `[${issue.identifier}](${issue.url})`,
        '',
        NEW_COMMENT_SECTION,
        '',
        createCommentSyncMarker(state.syncLabel),
        ''
    ];

    if (state.draftText) {
        lines.push(state.draftText.trimEnd(), '');
    }

    lines.push(COMMENTS_SECTION, '');

    if (!includeComments) {
        lines.push('*Comment mirroring is disabled.*');
    } else if (comments.length === 0) {
        lines.push('*No comments yet.*');
    } else {
        comments.forEach((comment, index) => {
            const authorName = comment.user?.name || 'Linear';
            lines.push(`### ${authorName} - ${new Date(comment.createdAt).toLocaleString()}`, '');
            lines.push(comment.body, '');
            if (index < comments.length - 1) {
                lines.push('---', '');
            }
        });
    }

    return `${lines.join('\n').trimEnd()}\n`;
}

function extractSyncLabel(markerLine?: string): string | null {
    if (!markerLine) return null;
    if (!markerLine.startsWith(COMMENT_SYNC_PREFIX) || !markerLine.endsWith(COMMENT_SYNC_SUFFIX)) {
        return null;
    }

    return markerLine.slice(COMMENT_SYNC_PREFIX.length, markerLine.length - COMMENT_SYNC_SUFFIX.length).trim() || null;
}
