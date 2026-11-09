/**
 * SPDX-License-Identifier: MIT
 */
import { MaybePromise } from '@theia/core';

/** The key an {@link IdentityProvider} would be bound under; nothing binds one by it, providers are `IdentityProviderContribution`s. */
export const IdentityProvider = Symbol('IdentityProvider');

/** Says who is using the IDE, for telemetry. */
export interface IdentityProvider {
    /** The provider's name, sent beside every identity it gives so the two can be read together. */
    readonly ID: string;

    /** Returns the identity telemetry is sent under now; it may change, for instance when someone logs in. May reject. */
    getIdentity(): MaybePromise<string>;
}
