/**
 * SPDX-License-Identifier: MIT
 */
import { nls, OS, Path, URI } from '@theia/core';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { inject, injectable } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import type { Project } from '@yukibana/client';
import { CONFIG_FILENAME, projectIdOf } from './welcome/welcome-model';

/**
 * What a folder is, for putting a project there: `free`, missing or empty, so a starter can be unpacked into it;
 * `this-project`, already a copy of the project, to open; `other-files`, a folder that holds something else; or
 * `not-a-folder`, a file or a link that is not to a copy of the project.
 */
export type FolderState = 'free' | 'this-project' | 'other-files' | 'not-a-folder';

/**
 * Returns why `name` cannot name a project's folder, or `undefined` if it passes: it must not be empty, start or end
 * with a space, be `.` or `..`, or hold a character that some operating system forbids in a name (`/ \ < > : " | ? *`
 * and control characters).
 *
 * It does not catch Windows' reserved names (`CON`, `NUL`…) or a trailing dot.
 */
export function folderNameProblem(name: string): string | undefined {
    if (name.trim() === '') {
        return nls.localize('yukibana/cloud/openProject/nameEmpty', 'Enter a name for the folder');
    }
    if (name !== name.trim()) {
        return nls.localize('yukibana/cloud/openProject/nameSpaces', 'A folder name cannot start or end with a space');
    }
    if (name === '.' || name === '..') {
        return nls.localize('yukibana/cloud/openProject/nameDots', "'{0}' cannot name a folder", name);
    }
    // eslint-disable-next-line no-control-regex
    if (/[\\/<>:"|?*\u0000-\u001f]/.test(name)) {
        return nls.localize('yukibana/cloud/openProject/nameCharacters', 'A folder name cannot contain any of / \\ < > : " | ? *');
    }
    return undefined;
}

/** Returns `uri`'s path the way the backend's operating system writes it. */
export function fsPathOf(uri: URI): string {
    return uri.path.fsPath(OS.backend.isWindows ? Path.Format.Windows : Path.Format.Posix);
}

/** Where projects are on this computer, and where a new one goes. */
@injectable()
export class ProjectLocations {
    /** The files, through the backend. */
    @inject(FileService) protected readonly files!: FileService;
    /** Where the recently opened workspaces come from. */
    @inject(WorkspaceService) protected readonly workspaces!: WorkspaceService;
    /** Where the home folder comes from. */
    @inject(EnvVariablesServer) protected readonly env!: EnvVariablesServer;

    /**
     * Returns the id of the registry project the `yukibana.json` of `folder` names, or `undefined` when there is no such
     * file, it cannot be read, or it names none. Never rejects.
     */
    async projectIdAt(folder: URI): Promise<string | undefined> {
        try {
            return projectIdOf((await this.files.read(folder.resolve(CONFIG_FILENAME))).value);
        } catch {
            return undefined;
        }
    }

    /**
     * Returns what `folder` is for the project `projectId`.
     *
     * A link counts as `not-a-folder` unless it leads to a copy of the project, since a starter is never unpacked through
     * one.
     *
     * A folder that cannot be looked at reads as `free`: Theia's file service answers "does not exist" when a stat fails
     * (e.g. no permission on the parent) and no children when a listing fails, without saying why. Rejects only when no
     * file system provider serves `folder`'s scheme, or when `folder` disappears between those two looks.
     */
    async stateOf(folder: URI, projectId: string): Promise<FolderState> {
        if (!(await this.files.exists(folder))) {
            return 'free';
        }
        const stat = await this.files.resolve(folder, { resolveMetadata: false });
        if (!stat.isDirectory) {
            return 'not-a-folder';
        }
        if ((await this.projectIdAt(folder)) === projectId) {
            return 'this-project';
        }
        if (stat.isSymbolicLink) {
            return 'not-a-folder';
        }
        return stat.children === undefined || stat.children.length === 0 ? 'free' : 'other-files';
    }

    /**
     * Returns where `project` goes unless the person says otherwise: its copy among the recently opened workspaces, if
     * any; otherwise the first of a folder named after its slug, `<slug>-1`, `<slug>-2`… that is free or a copy of it,
     * next to the most recently opened workspace, or in the home folder when there is none.
     *
     * Reads the `yukibana.json` of every recent workspace, so it takes time linear in their number. Does not end while
     * every candidate name is taken. A folder that cannot be looked at reads as free (see
     * {@link ProjectLocations.stateOf}), so the folder suggested may turn out unreadable when the starter is unpacked;
     * rejects only as `stateOf` does.
     */
    async defaultDestination(project: Project): Promise<URI> {
        const recent = (await this.workspaces.recentWorkspaces()).map(uri => new URI(uri));
        for (const uri of recent) {
            if ((await this.stateOf(uri, project.projectId)) === 'this-project') {
                return uri;
            }
        }
        const parent = recent.length > 0 ? recent[0].parent : new URI(await this.env.getHomeDirUri());
        for (let n = 0; ; n++) {
            const candidate = parent.resolve(n === 0 ? project.slug : `${project.slug}-${n}`);
            const state = await this.stateOf(candidate, project.projectId);
            if (state === 'free' || state === 'this-project') {
                return candidate;
            }
        }
    }
}
