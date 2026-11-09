/**
 * SPDX-License-Identifier: MIT
 */
import { DisposableCollection, Emitter, ILogger, URI } from '@theia/core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { inject, injectable, named } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { DEFAULT_CONFIG, loadConfig, YukibanaConfig } from '../../common/yukibana-config';
import { ReadOnlyPolicy } from './read-only-policy';

/** The name of the config file, read from the first workspace root. */
export const YUKIBANA_CONFIG_FILENAME = 'yukibana.json';

/**
 * The workspace's config: its `yukibana.json`, read on start, again whenever the file changes and, once the first config
 * is applied, whenever the workspace changes, and handed to {@link ReadOnlyPolicy} each time. A workspace change while
 * the first config is still loading is missed.
 *
 * Only the first workspace root's file is read. With no root, no file, or a file that cannot be read or is not valid
 * (logged as an error), the config is {@link DEFAULT_CONFIG} and nothing is read-only.
 *
 * Invariant: {@link config} is the config last applied, and {@link DEFAULT_CONFIG} before the first.
 */
@injectable()
export class ConfigProvider implements FrontendApplicationContribution {
    /** The watch on the current config file and the listener for its changes, disposed when the workspace changes. */
    protected readonly toDisposeOnWorkspaceChanged = new DisposableCollection();
    /** The emitter behind {@link onConfigChanged}. */
    private readonly onConfigChangeEmitter = new Emitter<YukibanaConfig>();
    /**
     * The event fired with the config each time one is applied: the first time, on every workspace change and on every
     * change to the file, even when the result is the same as before, and with {@link DEFAULT_CONFIG} when the file is
     * missing or not valid. A listener runs after {@link config} and {@link ReadOnlyPolicy} are updated.
     */
    readonly onConfigChanged = this.onConfigChangeEmitter.event;

    /** What {@link config} returns. */
    private _config: YukibanaConfig = DEFAULT_CONFIG;
    /**
     * The number of {@link reload}s begun. A reload, and the reads its watch starts, apply nothing once a later reload
     * has begun, so a read still in flight from a previous root cannot apply that root's globs over the current one.
     */
    private _generation = 0;

    /**
     * @param files reads and watches the config file.
     * @param workspaceService says which root the file is read from.
     * @param readOnlyPolicy receives each config's `readOnly`.
     * @param logger says when a config is applied and why a file was not.
     */
    constructor(
        @inject(FileService) protected readonly files: FileService,
        @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService,
        @inject(ReadOnlyPolicy) protected readonly readOnlyPolicy: ReadOnlyPolicy,
        @inject(ILogger)
        @named('yukibana:ConfigProvider')
        protected readonly logger: ILogger,
    ) {}

    /**
     * Waits for the workspace, applies its config, and from then on reloads whenever the workspace changes; a workspace
     * change before the first config is applied is not followed.
     *
     * Resolves once the first config is applied. Rejects only if the file system fails when asked whether the file
     * exists; a file that cannot be read or parsed is logged and the default applied instead.
     */
    async onStart(): Promise<void> {
        await this.workspaceService.ready;
        await this.reload();
        this.workspaceService.onWorkspaceChanged(() => this.reload());
    }

    /**
     * Stops watching the previous file, then applies the config of the current first root, and watches its file when
     * there is one.
     *
     * A change to the file re-reads it without waiting, so two quick changes may be applied in the order their reads
     * finish. A file created after this ran is not noticed until the workspace changes, since only an existing file is
     * watched.
     *
     * Reloads are not awaited by the workspace listener, so they may overlap; only the latest one begun applies anything
     * ({@link _generation}): an earlier one still waiting on the file system then resolves without applying or watching.
     */
    protected async reload(): Promise<void> {
        const generation = ++this._generation;
        this.toDisposeOnWorkspaceChanged.dispose();
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        if (root === undefined) {
            this.applyDefault();
            return;
        }
        const configURI = root.resolve(YUKIBANA_CONFIG_FILENAME);
        const exists = await this.files.exists(configURI);
        if (generation !== this._generation) {
            return;
        }
        if (!exists) {
            this.applyDefault();
            return;
        }
        const read = async () => {
            try {
                const { value } = await this.files.read(configURI);
                if (generation === this._generation) {
                    this.apply(root, loadConfig(value));
                }
            } catch (e) {
                if (generation === this._generation) {
                    this.logger.error(`Failed to load Yukibana configuration from '${configURI}: ${e}`, e);
                    this.applyDefault();
                }
            }
        };
        this.toDisposeOnWorkspaceChanged.push(this.files.watch(configURI));
        this.toDisposeOnWorkspaceChanged.push(
            this.files.onDidFilesChange(e => {
                if (e.contains(configURI)) {
                    read();
                }
            }),
        );
        await read();
    }

    /**
     * The first config applied. It never rejects, and never resolves if {@link onStart} never runs.
     *
     * It is not updated by later reloads: a caller that must follow changes reads {@link config} and listens to
     * {@link onConfigChanged}.
     */
    get ready(): Promise<YukibanaConfig> {
        return this._ready.promise;
    }

    /** The config last applied; {@link DEFAULT_CONFIG} until {@link onStart} has applied one. */
    get config(): YukibanaConfig {
        return this._config;
    }

    /** What {@link ready} returns, resolved by the first {@link apply}. */
    protected readonly _ready = new Deferred<YukibanaConfig>();

    /** Applies {@link DEFAULT_CONFIG} with no root, so that nothing is read-only. */
    protected applyDefault(): void {
        this.apply(undefined, DEFAULT_CONFIG);
    }

    /**
     * Makes `config` the current config, hands its `readOnly` globs to {@link ReadOnlyPolicy} relative to `root` (none
     * read-only when `root` is `undefined`), fires {@link onConfigChanged}, and resolves {@link ready} if this is the
     * first.
     */
    protected apply(root: URI | undefined, config: YukibanaConfig): void {
        this._config = config;
        this.readOnlyPolicy.update(root, config.readOnly);
        this.logger.info('Configuration loaded');
        this.onConfigChangeEmitter.fire(config);
        this._ready.resolve(this._config);
    }
}
