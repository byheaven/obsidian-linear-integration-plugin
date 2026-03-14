import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { NoteFrontmatter, ParsedNote } from '../types';

export function parseNote(content: string): ParsedNote {
    const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) {
        return {
            raw: content,
            frontmatter: {},
            body: content
        };
    }

    return {
        raw: content,
        frontmatter: (YAML.parse(match[1]) ?? {}) as NoteFrontmatter,
        body: content.slice(match[0].length)
    };
}

export async function readNoteFromDisk(vaultPath: string, vaultRelativePath: string): Promise<ParsedNote> {
    const absolutePath = path.join(vaultPath, vaultRelativePath);
    const raw = await fs.readFile(absolutePath, 'utf8');
    return parseNote(raw);
}

export function assertFilePathInsideVault(vaultRelativePath: string): void {
    if (path.isAbsolute(vaultRelativePath) || vaultRelativePath.startsWith('../')) {
        throw new Error(`Unsafe vault relative path: ${vaultRelativePath}`);
    }
}

export function buildManagedBodyExpectations(body: string): boolean {
    return body.includes('## Linear Issue')
        && body.includes('## New Comment')
        && body.includes('## Comments')
        && body.includes('--- Synced to Linear at ');
}
