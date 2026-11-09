/**
 * SPDX-License-Identifier: MIT
 */
import { ContributionProvider, MaybePromise } from '@theia/core';
import { inject, injectable, named } from '@theia/core/shared/inversify';
import { IdentityProvider } from './identity-provider';

/** The key identity providers are bound under, as contributions; {@link IdentityService} chooses among them. */
export const IdentityProviderContribution = Symbol('IdentityProviderContribution');
/** An identity provider that competes with the others. */
export interface IdentityProviderContribution extends IdentityProvider {
    /** Where the provider ranks: the one with the highest wins; among equals, the one bound first. */
    readonly PRIORITY: number;
}

/**
 * The identity telemetry is sent under: that of the bound {@link IdentityProviderContribution} with the highest
 * `PRIORITY`, asked afresh on each call, so a provider bound by another extension takes over from the default.
 */
@injectable()
export class IdentityService implements IdentityProvider {
    /** Every bound identity provider; the backend module always binds the default one. */
    @inject(ContributionProvider)
    @named(IdentityProviderContribution)
    protected readonly providers!: ContributionProvider<IdentityProviderContribution>;

    /** Returns the provider with the highest priority. Throws when none is bound, which it once did as a `TypeError`. */
    protected getBestProvider(): IdentityProvider {
        const providers = this.providers.getContributions();
        const best = providers.sort((a, b) => b.PRIORITY - a.PRIORITY)[0];
        if (best === undefined) {
            throw new Error('No identity provider is bound to IdentityProviderContribution.');
        }
        return best;
    }

    /** The chosen provider's {@link IdentityProvider.ID}. Throws when no provider is bound. */
    get ID(): string {
        return this.getBestProvider().ID;
    }

    /** Returns the chosen provider's identity, as it gives it. Throws when no provider is bound. */
    getIdentity(): MaybePromise<string> {
        return this.getBestProvider().getIdentity();
    }
}
