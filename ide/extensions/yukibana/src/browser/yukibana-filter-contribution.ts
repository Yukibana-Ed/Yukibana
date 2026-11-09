/**
 * SPDX-License-Identifier: MIT
 */
import { ContributionFilterRegistry, Filter, FilterContribution } from '@theia/core';
import { injectable } from '@theia/core/shared/inversify';

/**
 * Removes contributions other extensions (Theia's own or not) bind, before they are used: for now Theia's terminal
 * frontend contribution, so the IDE has no terminal commands, menus or keybindings.
 */
@injectable()
export class YukibanaFilterContribution implements FilterContribution {
    /** Adds, for every contribution type, a filter that drops `TerminalFrontendContribution`. */
    registerContributionFilters(registry: ContributionFilterRegistry): void {
        registry.addFilters('*', [
            // https://github.com/eclipse-theia/theia/blob/master/packages/terminal/src/browser/terminal-frontend-contribution.ts
            filterClassName(name => name !== 'TerminalFrontendContribution'),
        ]);
    }
}

/**
 * Returns a contribution filter that keeps an object iff `filter` keeps the name of its class.
 *
 * An object whose constructor has no name is dropped. Names are compared as the bundle has them, so this relies on the
 * build keeping class names.
 */
function filterClassName(filter: Filter<string>): Filter<Object> {
    return object => {
        const className = object?.constructor?.name;
        return className ? filter(className) : false;
    };
}
