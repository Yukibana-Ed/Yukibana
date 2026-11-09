/**
 * SPDX-License-Identifier: MIT
 */
import { CommandService, ILogger, MaybePromise, URI } from '@theia/core';
import { OpenerOptions, OpenHandler } from '@theia/core/lib/browser';
import { inject, injectable, named } from '@theia/core/shared/inversify';
import { CloudAccountService } from './cloud-account-service';
import { LoginCommand } from './command-contribution';
import { YukibanaProjectOpener } from './yukibana-project-opener';

/**
 * Opens `yukibana:` links: `yukibana://project/open?id=<project id>` opens a registry project (see
 * {@link YukibanaProjectOpener}). Any `yukibana://project/...` link, whatever its path, first asks the person to log in
 * when the registry says nobody is; only `/open` then opens a project. A link whose authority is not `project` is
 * logged and otherwise ignored.
 */
@injectable()
export class YukibanaOpenHandler implements OpenHandler {
    /** The handler's id among Theia's open handlers. */
    readonly id = 'yukibana';
    /** The handler's name for people. */
    readonly label = 'Yukibana';

    /** The priority it claims a `yukibana:` URI with. */
    static readonly PRIORITY: number = 500;

    /** Where each link is written down. */
    @inject(ILogger) @named('yukibana:OpenHandler') protected readonly logger!: ILogger;
    /** The account this window uses. */
    @inject(CloudAccountService) protected readonly accounts!: CloudAccountService;
    /** What runs the login command. */
    @inject(CommandService) protected readonly commands!: CommandService;
    /** What opens a project link. */
    @inject(YukibanaProjectOpener) protected opener!: YukibanaProjectOpener;

    /** Returns {@link YukibanaOpenHandler.PRIORITY} for a `yukibana:` URI and 0, not mine, for any other; `options` are ignored. */
    canHandle(uri: URI, options?: OpenerOptions): MaybePromise<number> {
        return uri.scheme === 'yukibana' ? YukibanaOpenHandler.PRIORITY : 0;
    }

    /**
     * Runs the link `uri` and settles once it is done; `options` are ignored. Resolves to `undefined`, since a link opens
     * no widget.
     *
     * Rejects when the login it starts cannot reach the backend; the project opener itself never rejects.
     */
    async open(uri: URI, options?: OpenerOptions): Promise<undefined> {
        const subject = uri.authority;
        const command = uri.path.toString();

        this.logger.info(`Opening url: ${uri.toString()}`);

        if (subject === 'project') {
            this.logger.info(`Running project command: ${command}`);
            await this.doProjectCommand(command, uri);
        }
    }

    /**
     * Runs the project link `uri`, whose path is `command`: logs in first when the registry says nobody is, then opens the
     * project for `/open`, whether or not the login worked (the opener offers it again). Any other command offers that
     * login too, and then does nothing else.
     *
     * Rejects when the login cannot reach the backend.
     */
    protected async doProjectCommand(command: string, uri: URI): Promise<void> {
        // The registry, not the keystore, says whether the stored session still works
        if ((await this.accounts.refresh()).kind === 'logged-out') {
            this.logger.info('Logged out');
            await this.commands.executeCommand(LoginCommand.id);
        }

        if (command === '/open') {
            await this.opener.openProjectURI(uri);
        }
    }
}
