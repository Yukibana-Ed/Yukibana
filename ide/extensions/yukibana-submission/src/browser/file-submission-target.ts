/**
 * SPDX-License-Identifier: MIT
 */
import { nls } from '@theia/core';
import { inject } from '@theia/core/shared/inversify';
import { FileDialogService } from '@theia/filesystem/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { SubmissionService } from '../common/submission-protocol';
import { SubmissionResult, SubmissionTarget, SubmissionTargetAvailability } from '../common/submission-target';

/**
 * Saves a submission as a `.tar.gz` where the student chooses.
 *
 * It used to write `submission.tar.gz` into the workspace root, where nothing left it out of the next submission, so
 * each submission carried the one before. The dialog now starts beside the workspace instead.
 */
export class FileSubmissionTarget implements SubmissionTarget {
    /** `'file'`, what `submission.target` names this target by. */
    readonly id = 'file';
    /** The target's name for people. */
    readonly label = 'File';

    /** Where the workspace is, so the dialog can start beside it. */
    @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService;
    /** Holds the submission, and writes its archive. */
    @inject(SubmissionService) protected readonly submissionService!: SubmissionService;
    /** Asks the student where to save. */
    @inject(FileDialogService) protected readonly fileDialogs!: FileDialogService;
    /** Resolves the folder the dialog starts in. */
    @inject(FileService) protected readonly files!: FileService;

    /** Returns that the target is always available: saving a file needs nothing. */
    async getAvailability(): Promise<SubmissionTargetAvailability> {
        return {
            available: true,
        };
    }

    /**
     * Asks where to save, starting in the first workspace root's parent folder (or the dialog's default when there is
     * none or it cannot be resolved), and saves submission `submissionId`'s archive there; the project is not needed.
     *
     * Returns not ok when the student chose no file, or when the submission is no longer held. Rejects when the file
     * cannot be written.
     */
    async submit(_projectId: string, submissionId: string): Promise<SubmissionResult> {
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        const beside = root === undefined ? undefined : await this.files.resolve(root.parent).catch(() => undefined);
        const destination = await this.fileDialogs.showSaveDialog(
            {
                title: nls.localize('yukibana/submission/fileTarget/saveTitle', 'Save submission'),
                inputValue: 'submission.tar.gz',
            },
            beside,
        );
        if (destination === undefined) {
            return {
                ok: false,
                reason: nls.localize('yukibana/submission/fileTarget/noFileChosen', 'No file was chosen'),
            };
        }
        if (await this.submissionService.save(submissionId, destination.toString())) {
            return {
                ok: true,
            };
        }
        return {
            ok: false,
            reason: nls.localize('yukibana/submission/fileTarget/gone', 'The submission is no longer prepared; submit again'),
        };
    }
}
