/**
 * SPDX-License-Identifier: MIT
 */
import { Resource, ResourceResolver, URI } from '@theia/core';
import { inject, injectable } from '@theia/core/shared/inversify';
import { UpdateService, UpdateUri } from '../../common/update-protocol';

/**
 * The read-only versions the diff and merge editors show for an update: a release's file, or the student's file as it
 * was before the last update. The backend reads them; nothing here can write.
 */
@injectable()
export class UpdateResourceResolver implements ResourceResolver {
    /** The backend that reads the versions. */
    @inject(UpdateService) protected readonly service!: UpdateService;

    /**
     * Returns the read-only resource `uri` names, whose contents the backend reads each time they are asked for: `''`
     * when that version has no file there or the path is not inside the workspace. Reading them rejects when the
     * backend cannot read the version (the release's starter cannot be had, or a backup cannot be read) or cannot be
     * reached.
     *
     * Throws when `uri` is not one {@link UpdateUri.encode} makes: that is how a resolver declines, and Theia's resource
     * provider then asks the next one.
     */
    resolve(uri: URI): Resource {
        const parts = UpdateUri.decode(uri);
        if (parts === undefined) {
            throw new Error(`Not an assignment update version: ${uri.toString()}`);
        }
        return {
            uri,
            readOnly: true,
            readContents: () => this.service.read(parts.workspace, parts.side, parts.path),
            dispose: () => undefined,
        };
    }
}
