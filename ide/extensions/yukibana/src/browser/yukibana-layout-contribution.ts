/**
 * SPDX-License-Identifier: MIT
 */
import { AIChatContribution } from '@theia/ai-chat-ui/lib/browser/ai-chat-ui-contribution';
import { ILogger, MaybePromise, URI } from '@theia/core';
import { FrontendApplication, FrontendApplicationContribution, OpenerService, ShellLayoutRestorer, StorageService, WidgetManager, WidgetOpenMode } from '@theia/core/lib/browser';
import { inject, injectable, interfaces, named } from '@theia/core/shared/inversify';
import { DebugFrontendApplicationContribution } from '@theia/debug/lib/browser/debug-frontend-application-contribution';
import { EditorManager } from '@theia/editor/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileNavigatorContribution } from '@theia/navigator/lib/browser/navigator-contribution';
import { OutlineViewContribution } from '@theia/outline-view/lib/browser/outline-view-contribution';
import { PluginViewRegistry } from '@theia/plugin-ext/lib/main/browser/view/plugin-view-registry';
import { ScmContribution } from '@theia/scm/lib/browser/scm-contribution';
import { SearchInWorkspaceFrontendContribution } from '@theia/search-in-workspace/lib/browser/search-in-workspace-frontend-contribution';
import { TestViewContribution } from '@theia/test/lib/browser/view/test-view-contribution';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { YukibanaConfig } from '../common/yukibana-config';
import { AssignmentPaneContribution } from './assignment/assignment-pane-contribution';
import { AssignmentResolver } from './assignment/assignment-resolver';
import { ConfigProvider } from './config/config-provider';
import { YukibanaPluginViewRegistry } from './yukibana-plugin-view-registry';

interface WithLayout {
    initializeLayout?(app: FrontendApplication): MaybePromise<void>;
}

type ConfigWidgetKey = keyof YukibanaConfig['layout']['widgets'];

const TOGGLEABLE_WIDGETS: Array<[interfaces.ServiceIdentifier<WithLayout>, ConfigWidgetKey]> = [
    [FileNavigatorContribution, 'files'],
    [SearchInWorkspaceFrontendContribution, 'search'],
    [ScmContribution, 'vcs'],
    [DebugFrontendApplicationContribution, 'debug'],
    [TestViewContribution, 'testing'],
    [OutlineViewContribution, 'outline'],
    [AIChatContribution, 'aiChat'],
];

/**
 * A layout restorer that neither restores nor stores: every window starts from the layout the contributions and the
 * config build, not from what the student last left, so a project opens the way its teacher set it up each time.
 */
@injectable()
export class YukibanaLayoutRestorer extends ShellLayoutRestorer {
    /** Passes Theia's dependencies through, with a logger of its own. */
    constructor(
        @inject(WidgetManager) widgetManager: WidgetManager,
        @inject(ILogger) @named('yukibana:LayoutRestorer') logger: ILogger,
        @inject(StorageService) storageService: StorageService,
    ) {
        super(widgetManager, logger, storageService);
    }
    /** Returns `false`, "nothing restored", so that the shell initializes the default layout. */
    override async restoreLayout(app: FrontendApplication): Promise<boolean> {
        this.logger.debug('Prevent restoring layout');
        return false;
    }
    /** Does nothing: the layout is never saved. */
    override async storeLayout(app: FrontendApplication): Promise<void> {
        this.logger.debug('Prevent saving layout');
    }
}

/** Opens what a project opens with: the assignment pane, and the config's `openFiles`. */
@injectable()
export class YukibanaLayoutContribution implements FrontendApplicationContribution {
    /**
     * @param widgets unused.
     * @param configProvider gives `openFiles`.
     * @param logger says when the layout is initialized, at debug level.
     * @param openerService unused.
     * @param workspaceService gives the root `openFiles` are relative to.
     * @param fileService says whether a file exists.
     * @param editorManager opens the files.
     * @param assignmentPane opens the assignment pane.
     * @param assignmentResolver says which file is the assignment.
     */
    constructor(
        @inject(WidgetManager) protected readonly widgets: WidgetManager,
        @inject(ConfigProvider) protected readonly configProvider: ConfigProvider,
        @inject(ILogger) @named('yukibana:LayoutContribution') protected readonly logger: ILogger,
        @inject(OpenerService) protected readonly openerService: OpenerService,
        @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService,
        @inject(FileService) protected readonly fileService: FileService,
        @inject(EditorManager) protected readonly editorManager: EditorManager,
        @inject(AssignmentPaneContribution) protected readonly assignmentPane: AssignmentPaneContribution,
        @inject(AssignmentResolver) protected readonly assignmentResolver: AssignmentResolver,
    ) {}

    /** Opens and activates the assignment pane iff there is a workspace root and the assignment file exists in it. */
    async initializeLayout(app: FrontendApplication): Promise<void> {
        this.logger.debug('Initializing layout');
        const assignmentURI = await this.assignmentResolver.resolve();
        if (!!assignmentURI) {
            if (await this.fileService.exists(assignmentURI)) {
                this.assignmentPane.openView({ activate: true, reveal: true });
            }
        }
    }

    /**
     * Opens the first config's `openFiles` under the first workspace root, once the workspace and the config are ready;
     * nothing when no folder is open.
     */
    async onDidInitializeLayout(app: FrontendApplication): Promise<void> {
        await this.workspaceService.ready;
        const config = await this.configProvider.ready;
        const roots = this.workspaceService.tryGetRoots();
        if (roots.length === 0) {
            return;
        }
        const root = new URI(roots[0].resource.toString());
        await this.openFiles(root, config.openFiles);
    }

    /**
     * Starts opening each of `files`, relative to `root`: the first to be activated, the rest opened without it.
     *
     * The opens start in order but each first asks whether its file exists, and none is awaited, so they complete in
     * any order and the editors' tab order is not guaranteed. One that does not exist is skipped; when that is the first,
     * nothing is activated. It resolves without waiting for them, so a file that fails to open is an unhandled rejection
     * rather than an error here.
     */
    protected async openFiles(root: URI, files: readonly string[]): Promise<void> {
        for (const [i, file] of files.entries()) {
            this.openFile(root, file, i === 0 ? 'activate' : 'open');
        }
    }

    /** Opens `file`, relative to `root`, in `mode`, if it exists. */
    protected async openFile(root: URI, file: string, mode: WidgetOpenMode | undefined): Promise<void> {
        await this.doOpenFile(root.resolve(file), mode);
    }

    /** Opens `file` in an editor in `mode` if it exists, and does nothing if it does not. */
    protected async doOpenFile(file: URI, mode: WidgetOpenMode | undefined): Promise<void> {
        if (await this.fileService.exists(file)) {
            await this.editorManager.open(file, { mode: mode });
        }
    }
}

/**
 * Rebinds the contribution `id` to itself, as a singleton, with its `initializeLayout` run only if `isEnabled` holds
 * for the first config applied; with it false the contribution's view is left out of the initial layout. The view is
 * not removed, and its commands can still open it.
 *
 * Does nothing but log when `id` is not bound (its extension is not in the application).
 *
 * - Requires: `id` is a class, bound to itself. Inversify throws when the container loads if it is not a class, and a
 *   binding to another class or to a value is replaced by `id` itself.
 */
export function rebindWithLayoutToggle<T extends WithLayout>(
    isBound: interfaces.IsBound,
    rebind: interfaces.Rebind,
    id: interfaces.ServiceIdentifier<T>,
    isEnabled: (config: YukibanaConfig) => boolean,
): void {
    if (!isBound(id)) {
        console.log(`rebindWithLayoutToggle: ${String(id)} is not bound`);
        return;
    }
    rebind(id)
        .toSelf()
        .inSingletonScope()
        .onActivation(({ container }, contribution) => {
            const configProvider = container.get(ConfigProvider);
            const original = contribution.initializeLayout?.bind(contribution);
            if (!!original) {
                contribution.initializeLayout = async app => {
                    const config = await configProvider.ready;
                    if (isEnabled(config)) {
                        await original(app);
                    }
                };
            }
            return contribution;
        });
}

/**
 * Binds the layout: {@link YukibanaLayoutContribution}, {@link YukibanaLayoutRestorer} in place of Theia's restorer, a
 * toggle on each of the views the config's `layout.widgets` names, and `YukibanaPluginViewRegistry` in place of
 * the plugins' view registry.
 *
 * - Requires: called once, after the modules binding `ShellLayoutRestorer` and `PluginViewRegistry` are loaded;
 *   otherwise rebinding them throws.
 */
export function bindLayout(bind: interfaces.Bind, rebind: interfaces.Rebind, isBound: interfaces.IsBound): void {
    bind(YukibanaLayoutContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(YukibanaLayoutContribution);
    rebind(ShellLayoutRestorer).to(YukibanaLayoutRestorer).inSingletonScope();

    for (const [contribution, widget] of TOGGLEABLE_WIDGETS) {
        rebindWithLayoutToggle(isBound, rebind, contribution, config => config.layout.widgets[widget]);
    }

    rebind(PluginViewRegistry).to(YukibanaPluginViewRegistry).inSingletonScope();
}
