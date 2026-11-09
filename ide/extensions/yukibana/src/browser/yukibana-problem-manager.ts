/**
 * SPDX-License-Identifier: MIT
 */
import { ILogger, URI } from '@theia/core';
import { Iterators } from '@theia/core/lib/browser';
import { inject, injectable, named } from '@theia/core/shared/inversify';
import { Diagnostic } from '@theia/core/shared/vscode-languageserver-protocol';
import { MarkerCollection, SearchFilter } from '@theia/markers/lib/browser/marker-manager';
import { ProblemManager, ProblemStat } from '@theia/markers/lib/browser/problem/problem-manager';
import { ConfigProvider } from './config/config-provider';
import { Marker } from '@theia/markers/lib/common/marker';

/**
 * Theia's problem manager, which hides every marker while the config's `features.squiggles` is false: no underlines, no
 * problems listed, zero counts. Markers are still collected meanwhile, and show again when it is turned on.
 *
 * Clearing does not work meanwhile: Theia's `LanguagesMainImpl.$clearDiagnostics` clears the files {@link getUris}
 * returns, which is none while markers are off, so diagnostics a language server clears in that time stay, and show
 * stale when markers are turned on again, until the server reports that file again.
 */
@injectable()
export class YukibanaProblemManager extends ProblemManager {
    /**
     * Re-announces every marked file on each config change, so the views ask again, and logs whether markers are on.
     */
    constructor(
        @inject(ConfigProvider) protected readonly configProvider: ConfigProvider,
        @inject(ILogger) @named('yukibana:ProblemManager') protected readonly logger: ILogger,
    ) {
        super();
        configProvider.onConfigChanged(e => this.onConfigChanged());
        configProvider.ready.then(config => {
            logger.info(`${config.features.squiggles !== false ? 'Enabling' : 'Disabling'} problem markers`);
        });
    }

    /** `true` iff markers show: the current config's `features.squiggles` is not false. */
    get isEnabled(): boolean {
        return this.configProvider.config.features.squiggles !== false;
    }

    /** Fires a markers change for every file with markers, including those hidden while markers are off. */
    protected onConfigChanged(): void {
        for (const uri of super.getUris()) {
            this.fireOnDidChangeMarkers(new URI(uri));
        }
    }

    /** Returns the markers by file as Theia does, or none while markers are off. */
    override getMarkersByUri(): IterableIterator<[string, MarkerCollection<Diagnostic>]> {
        if (!this.isEnabled) {
            return Iterators.asIterator([]);
        }
        return super.getMarkersByUri();
    }

    /** Returns the files with markers as Theia does, or none while markers are off. */
    override getUris(): IterableIterator<string> {
        if (!this.isEnabled) {
            return Iterators.asIterator([]);
        }
        return super.getUris();
    }

    /** Returns the counts of errors, warnings and infos as Theia does, or zeros while markers are off. */
    override getProblemStat(): ProblemStat {
        if (!this.isEnabled) {
            return {
                errors: 0,
                warnings: 0,
                infos: 0,
            };
        }
        return super.getProblemStat();
    }

    /** Returns the markers `filter` matches as Theia does, or none while markers are off. */
    override findMarkers(filter?: SearchFilter<Diagnostic> | undefined): Marker<Diagnostic>[] {
        if (!this.isEnabled) {
            return [];
        }
        return super.findMarkers(filter);
    }
}
