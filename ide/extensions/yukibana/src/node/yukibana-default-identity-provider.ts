/**
 * SPDX-License-Identifier: MIT
 */
import { injectable } from '@theia/core/shared/inversify';
import { randomUUIDv7 } from 'node:crypto';
import { IdentityProviderContribution } from './identity-service';

/** The identity when no provider with a higher `PRIORITY` is bound: a random id, so the events of one run can be told apart, and nobody named. */
@injectable()
export class YukibanaDefaultIdentityProvider implements IdentityProviderContribution {
    /** `'default'`. */
    readonly ID: string = 'default';
    /**
     * `0`. A provider must rank above `0` to replace this one: nothing checks that another provider's is higher, and on
     * a tie {@link IdentityService} keeps the one bound first, which is this one when its module loads first.
     */
    readonly PRIORITY: number = 0;

    /** A UUIDv7 made when the backend starts; never stored, so the next run has another. */
    protected readonly id: string = randomUUIDv7();

    /** Returns {@link id}: the same for as long as the backend runs. */
    getIdentity(): string {
        return this.id;
    }
}
