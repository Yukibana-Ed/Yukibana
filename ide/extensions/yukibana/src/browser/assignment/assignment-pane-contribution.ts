/**
 * SPDX-License-Identifier: MIT
 */
import { AbstractViewContribution } from '@theia/core/lib/browser';
import { injectable } from '@theia/core/shared/inversify';
import { AssignmentPaneWidget } from './assignment-pane-widget';

/**
 * The assignment pane as a view: the command `yukibana.assignmentPane.toggle` and {@link openView}, which put the one
 * {@link AssignmentPaneWidget} in the left panel.
 *
 * It does not open the pane by itself; `YukibanaLayoutContribution` does, when the assignment file exists.
 */
@injectable()
export class AssignmentPaneContribution extends AbstractViewContribution<AssignmentPaneWidget> {
    /** Names the widget by {@link AssignmentPaneWidget.ID}, so the widget factory bound under that id is the one used. */
    constructor() {
        super({
            widgetId: AssignmentPaneWidget.ID,
            widgetName: AssignmentPaneWidget.LABEL,
            defaultWidgetOptions: { area: 'left' },
            toggleCommandId: 'yukibana.assignmentPane.toggle',
        });
    }
}
