/**
 * SPDX-License-Identifier: MIT
 */
import { nls } from '@theia/core';
import { DeflatedToolbarTree, ToolbarAlignment } from '@theia/toolbar/lib/browser/toolbar-interfaces';

/**
 * Returns the toolbar a student starts with: back and forward, and Metals' "run current file", on the left; "Submit
 * assignment..." on the right. Each call returns a new tree; the module binds it as `ToolbarDefaultsFactory`.
 *
 * The ids are commands other extensions register: one not registered in this application (Metals' run, outside a Scala
 * project) names nothing.
 */
export const YukibanaToolbarDefaults: () => DeflatedToolbarTree = () => ({
    items: {
        [ToolbarAlignment.LEFT]: [
            [
                {
                    id: 'textEditor.commands.go.back',
                    command: 'textEditor.commands.go.back',
                    icon: 'codicon codicon-arrow-left',
                },
                {
                    id: 'textEditor.commands.go.forward',
                    command: 'textEditor.commands.go.forward',
                    icon: 'codicon codicon-arrow-right',
                },
            ],
            [
                {
                    id: 'metals.run-current-file',
                    command: 'metals.run-current-file',
                    icon: 'codicon codicon-play',
                },
            ],
        ],
        [ToolbarAlignment.CENTER]: [[]],
        [ToolbarAlignment.RIGHT]: [
            [
                {
                    id: 'yukibana.submitAssignment',
                    command: 'yukibana.submitAssignment',
                    icon: 'codicon codicon-send',
                    tooltip: nls.localize('yukibana/submission/submitAssignment', 'Submit assignment...'),
                },
            ],
        ],
    },
});
