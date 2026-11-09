/**
 * SPDX-License-Identifier: MIT
 */
import { CommandService, ILogger, MessageService, nls, Progress, URI } from '@theia/core';
import { inject, injectable, named } from '@theia/core/shared/inversify';
import { FileDialogService } from '@theia/filesystem/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { TelemetryService } from '@theia/telemetry/lib/common';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import type { Project } from '@yukibana/client';
import { localizeMarkdown } from '@yukibana/ide-common/lib/localize-markdown';
import { CloudService } from '../common/cloud-protocol';
import { CloudTelemetry } from '../common/cloud-telemetry';
import { CloudAccountService } from './cloud-account-service';
import { LoginCommand } from './command-contribution';
import { DownloadProjectDialog } from './download-project-dialog';
import { OpenProjectNewWindowDialog } from './open-project-window-dialog';
import { fsPathOf, ProjectLocations } from './project-locations';

/**
 * Opens a registry project from a `yukibana://project/open?id=<project id>` link: looks it up, asks where it goes,
 * unpacks its starter there unless the folder is already a copy of it, and opens the folder, in this window or a new
 * one. Every attempt is reported to telemetry once, with how far it got and how it ended.
 *
 * Invariant: `outcome` and `progress` belong to the open started last.
 */
@injectable()
export class YukibanaProjectOpener {
    /** How the open started last ended, or is ending, as telemetry says it; `error` until something decides otherwise. */
    protected outcome: CloudTelemetry.OpenProjectOutcome;
    /**
     * The progress notification of the current or last open, already cancelled once that open ended; `undefined` before
     * one is shown.
     */
    protected progress: Progress | undefined;

    /** Where each step of an open is written down. */
    @inject(ILogger) @named('yukibana:OpenHandler') protected readonly logger!: ILogger;
    /** The backend that looks projects up and unpacks starters. */
    @inject(CloudService) protected readonly service!: CloudService;
    /** What asks for a folder when the person browses. */
    @inject(FileDialogService) protected readonly fileDialogs!: FileDialogService;
    /** What opens the project's folder as the workspace. */
    @inject(WorkspaceService) protected readonly workspaces!: WorkspaceService;
    /** Where progress and failures are shown. */
    @inject(MessageService) protected readonly messages!: MessageService;
    /** The files, to start the folder dialog at a folder that exists. */
    @inject(FileService) protected readonly files!: FileService;
    /** Where every attempt is reported. */
    @inject(TelemetryService) protected readonly telemetry!: TelemetryService;
    /** The account this window uses, asked after a login it offered. */
    @inject(CloudAccountService) protected readonly accounts!: CloudAccountService;
    /** What runs the login command. */
    @inject(CommandService) protected readonly commands!: CommandService;
    /** What a folder is, and where a project goes by default. */
    @inject(ProjectLocations) protected readonly locations!: ProjectLocations;

    /** Creates an opener with no open under way. */
    constructor() {
        this.outcome = 'error';
    }

    /**
     * Opens the project `uri`'s `id` query parameter names, as the class says, and settles once the folder was asked to
     * open or the attempt ended.
     *
     * Never rejects: a failure is logged and shown. A link without an id, a project that is not found or has no starter
     * yet, a download that fails, or a cancelled destination dialog ends it with a message or quietly; closing the
     * question of which window opens it in this window. Not logged in, it offers to log in and, if that works, starts
     * over; that second attempt runs after this call has settled and is reported on its own.
     * - Requires: no other call of `openProjectURI` on this opener is under way. Not enforced, and not always met (the
     *   open handler holds one opener per window, so two links opened close together overlap): an overlapping call
     *   overwrites `outcome` and `progress`, so the telemetry and the progress notification of both are wrong, though
     *   each still opens its project.
     */
    async openProjectURI(uri: URI): Promise<void> {
        this.logger.info(`Opening project from URI: ${uri}`);
        const start = Date.now();
        let stage: CloudTelemetry.OpenProjectStage = 'parse';
        this.outcome = 'error';
        this.progress = undefined;
        let projectId: string | undefined = undefined;
        let newWindow: boolean | undefined = undefined;

        try {
            projectId = this.parseURI(uri);
            if (!projectId) {
                return;
            }

            this.progress = await this.messages.showProgress({
                text: nls.localize('yukibana/cloud/openProject/progressMessage', 'Opening project'),
            });

            stage = 'info';
            const project = await this.getProjectInfo(uri, projectId);
            if (!project) {
                return;
            }

            stage = 'location';
            const destination = await this.askDestination(project);
            if (!destination) {
                this.outcome = 'cancelled';
                this.logger.info('No destination');
                return;
            }

            // Looked at again: the folder may have changed since the dialog did, and only a copy of the project is opened as it is
            if ((await this.locations.stateOf(destination, projectId)) !== 'this-project') {
                stage = 'download';
                if (!(await this.downloadStarter(projectId, destination))) {
                    return;
                }
            }

            this.progress.report({
                message: nls.localize('yukibana/cloud/openProject/opening', 'Opening...'),
            });

            stage = 'window';
            newWindow = await this.askOpenInNewWindow();

            this.outcome = 'opened';
            this.report(this.outcome, stage, start, projectId, newWindow);
            this.workspaces.open(destination, { preserveWindow: !newWindow });
        } catch (e) {
            this.logger.error(`Could not open project (stage: ${stage})`, e);
            this.messages.error(localizeMarkdown('yukibana/cloud/openProject/failed', 'Could not open project: {0}', e instanceof Error ? e.message : String(e)));
        } finally {
            this.progress?.cancel();
            if (this.outcome !== 'opened') {
                this.report(this.outcome, stage, start, projectId, newWindow);
            }
        }
    }

    /**
     * Returns the project id in `uri`'s `id` query parameter, or `undefined` (and the outcome `invalid-uri`) when it has
     * none or it is empty.
     */
    protected parseURI(uri: URI): string | undefined {
        // `?id=` gives '', which is no id either
        const projectId = new URLSearchParams(uri.query).get('id') || undefined;
        this.logger.info(`Opening project: ${projectId}`);

        if (!projectId) {
            this.outcome = 'invalid-uri';
            this.logger.info('No project id');
        }
        return projectId;
    }

    /**
     * Returns the project `projectId` if the registry has it and its starter is ready; otherwise sets the outcome, tells
     * the person, and returns `undefined`. Not logged in, it offers a login that reopens `uri`, without waiting for it.
     */
    protected async getProjectInfo(uri: URI, projectId: string): Promise<Project | undefined> {
        this.progress?.report({
            message: nls.localize('yukibana/cloud/openProject/gettingInfo', 'Getting info...'),
        });
        const lookup = await this.service.getProjectInfo(projectId);
        if (lookup.kind === 'not-logged-in') {
            this.outcome = 'not-logged-in';
            this.logger.info('Not logged in');
            this.offerLogin(uri);
            return;
        }
        if (lookup.kind === 'not-found') {
            this.outcome = 'not-found';
            this.logger.info('Project not found');
            this.messages.error(nls.localize('yukibana/cloud/openProject/notFound', 'Project not found'));
            return;
        }
        const info = lookup.project;
        if (!info.starterReady) {
            this.outcome = 'no-starter';
            this.logger.info('Project has no starter');
            this.messages.error(localizeMarkdown('yukibana/cloud/openProject/noStarter', "Project '{0}' has no starter files to download yet", info.title));
            return;
        }
        return info;
    }

    /**
     * Asks where `project` goes, suggesting its default destination, and returns the folder chosen: a free one, or a copy
     * of the project; `undefined` if the person cancelled.
     */
    protected async askDestination(project: Project): Promise<URI | undefined> {
        this.progress?.report({
            message: nls.localize('yukibana/cloud/openProject/choosingLocation', 'Choosing download location...'),
        });
        return new DownloadProjectDialog({
            title: project.title,
            destination: await this.locations.defaultDestination(project),
            browse: parent => this.browse(parent),
            stateOf: folder => this.locations.stateOf(folder, project.projectId),
            display: fsPathOf,
        }).open();
    }

    /** Asks for a folder, starting at `parent`, and returns it; `undefined` if none was chosen. */
    protected async browse(parent: URI): Promise<URI | undefined> {
        const start = await this.files.resolve(parent).catch(() => undefined);
        return this.fileDialogs.showOpenDialog(
            {
                title: nls.localize('yukibana/cloud/openProject/browseTitle', "Choose where to put the project's folder"),
                openLabel: nls.localizeByDefault('Select'),
                canSelectFolders: true,
                canSelectFiles: false,
                canSelectMany: false,
            },
            start,
        );
    }

    /**
     * Unpacks the starter of `projectId` straight into `destination` and returns `true` iff it did, telling the person
     * about anything left out or why nothing was unpacked.
     */
    protected async downloadStarter(projectId: string, destination: URI): Promise<boolean> {
        this.progress?.report({
            message: nls.localize('yukibana/cloud/openProject/downloading', 'Downloading...'),
        });
        const result = await this.service.downloadProject(projectId, destination.toString());
        if (!result.ok) {
            this.outcome = 'download-failed';
            this.logger.error(`Could not download project: ${result.reason}`);
            this.messages.error(localizeMarkdown('yukibana/cloud/openProject/downloadFailReason', 'Download failed: {0}', result.reason));
            return false;
        }
        if (result.leftOut.length > 0) {
            this.messages.warn(localizeMarkdown('yukibana/cloud/openProject/leftOut', 'Some files of the starter were not unpacked: {0}', result.leftOut.join('; ')));
        }
        return true;
    }

    /** Offers to log in, and opens the project once that worked. */
    protected async offerLogin(uri: URI): Promise<void> {
        const logIn = nls.localize('yukibana/cloud/submission/login', 'Log in');
        const choice = await this.messages.error(nls.localize('yukibana/cloud/openProject/notLoggedIn', 'Log in to open this project'), logIn);
        if (choice !== logIn) {
            return;
        }
        await this.commands.executeCommand(LoginCommand.id);
        if ((await this.accounts.refresh()).kind === 'logged-in') {
            await this.openProjectURI(uri);
        }
    }

    /** Asks where to open the project: `true` for a new window, `undefined` for this one (as closing the dialog also says). */
    protected askOpenInNewWindow(): Promise<boolean | undefined> {
        return new OpenProjectNewWindowDialog().open();
    }

    /** Reports the attempt that started at `start` (ms since the epoch) to telemetry: a usage if it opened or was cancelled, an error otherwise. */
    private report(outcome: CloudTelemetry.OpenProjectOutcome, stage: CloudTelemetry.OpenProjectStage, start: number, projectId?: string, newWindow?: boolean): void {
        const durationMs = Date.now() - start;
        const data = {
            outcome: outcome,
            stage: stage,
            durationMs: durationMs,
            projectId: projectId ?? '',
            newWindow: newWindow ?? false,
        } satisfies CloudTelemetry.OpenProjectURIData;
        this.telemetry.report(CloudTelemetry.OpenProjectURI, data, {
            kind: outcome === 'opened' || outcome === 'cancelled' ? 'usage' : 'error',
        });
    }
}
