/**
 * SPDX-License-Identifier: MIT
 */
import { BaseWidget, Message } from '@theia/core/lib/browser';
import { MarkdownRendererFactory } from '@theia/core/lib/browser/markdown-rendering/markdown-renderer';
import { MarkdownStringImpl } from '@theia/core/lib/common/markdown-rendering';
import URI from '@theia/core/lib/common/uri';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { ConfigProvider } from '../config/config-provider';
import { AssignmentResolver } from './assignment-resolver';

/**
 * The assignment pane: the assignment file ({@link AssignmentResolver}), rendered as Markdown, kept up to date as the
 * file, the workspace and the config change.
 *
 * When there is no workspace root the pane keeps what it last showed, and starts empty. The rendering is trusted
 * (HTML and `command:` links work) because the assignment is the teacher's text, not input from elsewhere; a project
 * that does not want the student to edit it lists it in `readOnly`.
 */
@injectable()
export class AssignmentPaneWidget extends BaseWidget {
    /** The widget's id, and the id of the widget factory that makes it. */
    static readonly ID = 'yukibana.assignment-pane';
    /** The pane's title and tooltip. */
    static readonly LABEL = 'Assignment';

    /** Makes the renderer each {@link showMarkdown} uses. */
    @inject(MarkdownRendererFactory) protected readonly rendererFactory!: MarkdownRendererFactory;
    /** Reads the assignment file, and says when it changes. */
    @inject(FileService) protected readonly fileService!: FileService;
    /** The workspace. Unused here: {@link resolver} is what reads it. */
    @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService;
    /** The config. Unused here: {@link resolver} is what reads it. */
    @inject(ConfigProvider) protected readonly configProvider!: ConfigProvider;
    /** Says which file is the assignment, and when that may have changed. */
    @inject(AssignmentResolver) protected readonly resolver!: AssignmentResolver;

    /** The assignment file last resolved, or `undefined` before the first resolve or when there is no workspace root. */
    protected uri: URI | undefined;

    /** Sets the pane's title and look, refreshes it whenever the assignment may have changed, and shows it once now. */
    @postConstruct()
    protected init(): void {
        this.id = AssignmentPaneWidget.ID;
        this.title.label = AssignmentPaneWidget.LABEL;
        this.title.caption = AssignmentPaneWidget.LABEL;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-book';
        this.addClass('yukibana-markdown-pane');
        this.node.style.overflow = 'auto';
        this.node.style.padding = '8px 16px';
        this.toDispose.push(this.resolver.onDidChange(() => this.refresh()));
        this.toDispose.push(
            this.fileService.onDidFilesChange(e => {
                if (this.uri && e.contains(this.uri)) {
                    this.refresh();
                }
            }),
        );
        this.refresh();
    }

    /**
     * Resolves the assignment file again and shows it, or leaves the pane as it is when there is no workspace root.
     *
     * Rejects with what {@link showFile} throws, a missing file among it; the callers here do not wait for it, so that
     * is an unhandled rejection in the console and the pane keeps what it showed.
     */
    protected async refresh(): Promise<void> {
        this.uri = await this.resolver.resolve();
        if (!this.uri) {
            return;
        }
        await this.showFile(this.uri);
    }

    /**
     * Shows the file at `uri`, read as text and rendered as Markdown, in place of what the pane showed.
     *
     * Rejects with the {@link FileService} error when the file cannot be read (it does not exist, for one), and then
     * changes nothing. It does not make `uri` the file the pane follows: the next refresh shows the assignment again.
     */
    async showFile(uri: URI): Promise<void> {
        const content = await this.fileService.read(uri);
        this.showMarkdown(content.value.toString());
    }

    /**
     * Shows `text`, rendered as trusted Markdown (HTML, theme icons and `command:` links allowed), in place of what the
     * pane showed.
     *
     * Each rendering is disposed only with the widget, not when the next one replaces it.
     */
    showMarkdown(text: string): void {
        const renderer = this.rendererFactory();
        const md = new MarkdownStringImpl(text, { supportHtml: true, isTrusted: true, supportThemeIcons: true });
        const rendered = renderer.render(md);
        this.node.replaceChildren(rendered.element);
        this.toDispose.push(rendered);
    }

    /** Focuses the pane, so that activating it moves the keyboard to it. */
    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.node.focus();
    }
}
