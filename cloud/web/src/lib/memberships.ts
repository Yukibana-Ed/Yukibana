import type { EditionRole } from './api';
import type { EditionId } from './ids';

/** One edition the person is in, as the header's course switcher lists it. */
export interface Membership {
    /** The edition, the switcher's link. */
    readonly edition_id: EditionId;
    /** Their role in it. */
    readonly role: EditionRole;
    /** The course's code, the first of the switcher's words ("CS-101"). */
    readonly code: string;
    /** The edition's label, the rest of them ("2026 autumn"). */
    readonly label: string;
    /** `true` iff the edition is archived; the switcher lists those apart. */
    readonly archived: boolean;
}
