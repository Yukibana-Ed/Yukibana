import type { LayoutServerLoad } from './$types';
import type { Membership } from '#lib/memberships.ts';
import { asUser } from '#lib/server/db.ts';
import { withContext } from '#lib/server/context.ts';
import { workerConfig } from '#lib/server/worker.ts';
import { topicsFor } from '#lib/topics.ts';

/** Who is signed in, the editions they are in (for the header's course
 *  switcher), and what their pages listen to for live updates: the
 *  Realtime address, the publishable key (public by design), and the topics
 *  their enrolments give them. Whether they may actually join a topic is the
 *  database's decision when they try; this only saves asking for ones they
 *  could not.
 *
 *  Runs again on every navigation, so the header and the page always
 *  describe the same request. Reading only `locals`, it ran once per full
 *  load: when a session ended in an open tab, the header kept the address it
 *  had at first while every page said "log in". `sessionRefused` says why a
 *  session that was there stopped counting, for the layout to tell. */
export const load: LayoutServerLoad = async ({ locals, url }) => {
    // Reading the URL is what makes SvelteKit rerun this load when it changes.
    void url.href;
    const claims = locals.claims;
    if (claims === null) return { user: null, memberships: [], live: null, sessionRefused: locals.sessionRefused };
    const config = workerConfig();
    const memberships = await withContext(ctx =>
        asUser(
            ctx.sql,
            claims,
            tx => tx<Membership[]>`
      select n.edition_id, n.role::text as role, c.code, e.label, e.archived_at is not null as archived
      from enrollment n
      join course_edition e on e.edition_id = n.edition_id
      join course c on c.course_id = e.course_id
      where n.user_id = ${claims.sub}
      order by e.archived_at nulls first, c.code, e.label desc`,
        ),
    );
    return {
        sessionRefused: null,
        user: { id: claims.sub, email: claims.email },
        memberships,
        live: {
            url: config.supabaseUrl,
            key: config.supabasePublishableKey,
            topics: topicsFor(
                claims.sub,
                memberships.map(m => ({ editionId: m.edition_id, role: m.role })),
            ),
        },
    };
};
