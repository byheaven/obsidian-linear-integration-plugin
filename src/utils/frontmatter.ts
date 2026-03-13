import { App, TFile, CachedMetadata } from 'obsidian';
import { NoteFrontmatter } from '../models/types';


export function parseFrontmatter(app: App, file: TFile): NoteFrontmatter {
    const cachedMetadata: CachedMetadata | null = app.metadataCache.getFileCache(file);
    
    if (!cachedMetadata?.frontmatter) {
        return {} as NoteFrontmatter;
    }
    
    const frontmatter = cachedMetadata.frontmatter;
    const result: NoteFrontmatter = {} as NoteFrontmatter;
    
    Object.entries(frontmatter).forEach(([key, value]) => {
        if (key !== 'position') {
            (result as any)[key] = value;
        }
    });
    
    return result;
}

export async function updateFrontmatter(app: App, file: TFile, newFrontmatter: NoteFrontmatter): Promise<void> {
    await app.fileManager.processFrontMatter(file, (frontmatter) => {
        // Only update/add the provided keys — never delete user-defined properties.
        // This preserves wikilink values like "[[AMIO]]" that the user set manually,
        // since Obsidian's YAML serializer strips quotes from [[...]] strings when
        // it rewrites the entire frontmatter block.
        Object.entries(newFrontmatter).forEach(([key, value]) => {
            if (key !== 'position' && value !== undefined && value !== null) {
                frontmatter[key] = value;
            }
        });
    });
}