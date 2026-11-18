/** Linking a project to a GitHub repository, from the project page
 *  (docs/cloud/github.md, Stage 3).
 *
 *  An owner presses Connect GitHub (`?/connectGithub`): the Worker sets a
 *  sealed state cookie and sends the browser to GitHub's authorize page, or
 *  to the App's installation page. GitHub sends the browser back to
 *  `/auth/github/return` with a code; `returned` decides, before GitHub is
 *  asked anything, whether that return is this browser's and this
 *  person's, and only then trades the code for the person's token, sealed
 *  into a fifteen-minute cookie. The project page then lists, with that
 *  token, the repositories the person may link (`pickerFor`), and
 *  `?/linkRepository` asks GitHub once more for the one chosen, requires
 *  admin or maintain on it (`mayLink`), and records GitHub's ids with
 *  `app.link_repository`, which decides whether this person may.
 *
 *  What GitHub says is a fact established here, at the boundary, with the
 *  person's own token; who may link what is the database's decision. The
 *  routes only carry out what this module decides, so the decisions are
 *  tested with a stubbed `GitHub` and no browser.
 */

import type { Claims } from '#lib/claims.ts';
import type { EditionId, ProjectId } from '#lib/ids.ts';
import { report } from '#lib/report.ts';
import { asUser, refusalOf, type Sql, type Tx } from './db';
import type { GitHubConfig } from './env';
import { GitHubError, githubClient, mayLink, REPOSITORY_NAME, type GitHub, type Repository } from './github';
import { cookieKey, openState, sealToken } from './github-cookie';

/** Returns GitHub's authorize page for the App's OAuth client `clientId`, coming back
 *  to `/auth/github/return` on `site` (the site's canonical origin, which
 *  must be the App's registered callback URL) with `state`. */
export function authorizeUrlOf(clientId: string, site: string, state: string): URL {
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', returnUrlOf(site));
    url.searchParams.set('state', state);
    return url;
}

/** Returns the App's installation page (`https://github.com/apps/<slug>/installations/new`)
 *  with `state`, for the button "Install the App or add repositories". With
 *  "Request user authorization during installation" on, GitHub comes back
 *  to the same return route with a code and this state. Connect itself
 *  does not go here: for somebody who installed the App already, this is a
 *  settings screen that may not come back. */
export function installUrlOf(slug: string, state: string): URL {
    const url = new URL(`https://github.com/apps/${encodeURIComponent(slug)}/installations/new`);
    url.searchParams.set('state', state);
    return url;
}

/** Returns the App's callback URL on `site`, an origin without a trailing slash. */
export const returnUrlOf = (site: string): string => `${site}/auth/github/return`;

/** Returns the project page's Releases tab, where the Repository section is, for
 *  `edition` and `project`, as a path; with `relink`, the address that shows
 *  the picker over an existing link (`&relink`), scrolled to the section. */
export const repositorySectionOf = (edition: EditionId, project: ProjectId, relink = false): string =>
    `/editions/${edition}/projects/${project}?tab=releases${relink ? '&relink#repository' : ''}`;

/** What `/auth/github/return` does. */
export type Returned =
    /** No connection is in flight in this browser (no state cookie), as when
     *  somebody installed the App from github.com: a page that says to go
     *  back and press Connect. No cookie is touched and GitHub is not asked. */
    | { readonly kind: 'installed' }
    /** Not this browser's or this person's connection, or no longer valid:
     *  an error page with `status` and `message`. No cookie is touched and
     *  GitHub is not asked, so a request a page elsewhere makes cancels
     *  nothing and spends nothing. */
    | { readonly kind: 'refused'; readonly status: number; readonly message: string }
    /** This browser's connection, which did not end in a token (the person
     *  said no on GitHub, or GitHub refused the code): the state cookie is
     *  deleted, and an error page shows `message`. */
    | { readonly kind: 'failed'; readonly status: number; readonly message: string }
    /** Connected: set the token cookie to `cookie` (sealed for the person),
     *  delete the state cookie, and redirect (303) to `to`. */
    | { readonly kind: 'connected'; readonly cookie: string; readonly to: string };

const AGAIN = 'Go back to the project page and press Connect GitHub again.';

/** `/auth/github/return`, decided. In this order, and nothing is asked of
 *  GitHub before the last step:
 *
 *  - no state cookie: `installed`;
 *  - a state cookie that does not open (tampered, expired, another client
 *    secret), a person signed in who is not the one who pressed Connect
 *    (`sub`, null for nobody), or a `state` in the query that is not the
 *    cookie's: `refused`, touching nothing;
 *  - an `error` from GitHub, or no `code`: `failed`;
 *  - the code GitHub refuses: `failed`, reported;
 *  - otherwise `connected`, with the token sealed for `sub` as of `now`,
 *    back to the project page, with the picker again when Connect was
 *    pressed while changing a link (it once came back without it, and the
 *    owner had to press Change a second time).
 *
 *  `installation_id` and `setup_action` are ignored: the installations are
 *  listed again with the token. */
export async function returned(input: {
    readonly query: URLSearchParams;
    readonly stateCookie: string | undefined;
    readonly sub: string | null;
    readonly key: CryptoKey;
    readonly github: GitHub;
    readonly now: Date;
}): Promise<Returned> {
    if (input.stateCookie === undefined || input.stateCookie === '') return { kind: 'installed' };
    const flight = await openState(input.stateCookie, input.key, input.now);
    if (flight === null) return { kind: 'refused', status: 400, message: `This GitHub connection has expired or was not started in this browser. ${AGAIN}` };
    if (input.sub === null) return { kind: 'refused', status: 401, message: `You are not signed in any more. Sign in, then ${AGAIN.charAt(0).toLowerCase()}${AGAIN.slice(1)}` };
    if (flight.sub !== input.sub || input.query.get('state') !== flight.state) {
        return { kind: 'refused', status: 400, message: `This GitHub connection was not started by you in this browser. ${AGAIN}` };
    }
    const code = input.query.get('code') ?? '';
    if (input.query.has('error') || code === '') {
        const why = input.query.get('error_description') ?? input.query.get('error') ?? 'GitHub sent no code';
        return { kind: 'failed', status: 400, message: `GitHub did not connect: ${why}. ${AGAIN}` };
    }
    let token: string;
    try {
        token = await input.github.exchangeCode(code);
    } catch (e) {
        if (!(e instanceof GitHubError)) throw e;
        return { kind: 'failed', status: 502, message: `${report('github', e.message)}. ${AGAIN}` };
    }
    return { kind: 'connected', cookie: await sealToken(token, input.sub, input.key, input.now), to: repositorySectionOf(flight.edition, flight.project, flight.relink) };
}

/** A repository the person may link, as the picker shows it. */
export interface Pickable {
    /** GitHub's id, which the form sends back. */
    readonly id: string;
    /** `owner/name`, for the person. */
    readonly fullName: string;
    /** Whether it is private. */
    readonly private: boolean;
}

/** What the picker shows. */
export interface Picker {
    /** The repositories the person may link (admin or maintain), by name. */
    readonly repositories: readonly Pickable[];
    /** True when there may be more than are listed: more than
     *  `MAX_INSTALLATIONS` installations, or an installation with more than
     *  one page. The page then says to type `owner/name`. */
    readonly truncated: boolean;
    /** Null, or a sentence saying GitHub did not answer (already reported),
     *  in which case `repositories` is empty. */
    readonly failed: string | null;
}

/** How many installations the picker reads. With one request for the
 *  installations and one per installation, a page stays well under the
 *  Worker's subrequest limit (fifty on the free plan), even for somebody in
 *  many organisations. */
export const MAX_INSTALLATIONS = 10;

/** The repositories the holder of `token` may link: one page of up to 100
 *  of each of the first `MAX_INSTALLATIONS` installations they can see,
 *  without those whose permissions lack admin and maintain. Never throws for
 *  GitHub: a failure or a rate limit is reported and comes back as
 *  `failed`, so it never takes the project page down. */
export async function pickerFor(github: GitHub, token: string): Promise<Picker> {
    try {
        const installations = await github.installations(token);
        let truncated = installations.length > MAX_INSTALLATIONS;
        const found = new Map<string, Pickable>();
        for (const i of installations.slice(0, MAX_INSTALLATIONS)) {
            const page = await github.installationRepositories(token, i.id);
            if (page.total > page.repositories.length) truncated = true;
            for (const r of page.repositories) if (mayLink(r)) found.set(r.id, { id: r.id, fullName: r.fullName, private: r.private });
        }
        return { repositories: [...found.values()].toSorted((a, b) => a.fullName.localeCompare(b.fullName)), truncated, failed: null };
    } catch (e) {
        if (!(e instanceof GitHubError)) throw e;
        report('github', e.message);
        return { repositories: [], truncated: false, failed: 'GitHub did not answer; Refresh, or Connect GitHub again.' };
    }
}

/** Which repository a link form names: GitHub's id, from the picker, or an
 *  `owner/name` typed for one not listed. */
export type Wanted = { readonly id: string } | { readonly name: string };

/** Returns the repository the link form names, from its `repository_id` and
 *  `repository` fields (an id wins when both are given), or a sentence
 *  saying what is wrong. A typed name may be a GitHub address
 *  (`https://github.com/owner/name`, with or without `.git`); what is sent
 *  to GitHub is the `owner/name` alone, so it cannot change the path. */
export function wantedOf(repositoryId: string, repository: string): Wanted | string {
    if (repositoryId !== '') return /^[0-9]{1,20}$/.test(repositoryId) ? { id: repositoryId } : 'Choose a repository from the list.';
    const name = repository
        .replace(/^https:\/\/github\.com\//i, '')
        .replace(/\.git$/, '')
        .replace(/\/$/, '');
    if (name === '') return 'Choose a repository, or type its owner/name.';
    return REPOSITORY_NAME.test(name) ? { name } : `"${repository}" is not a repository's owner/name.`;
}

/** What linking came to. */
export type Linked = { readonly ok: true; readonly repository: string } | { readonly ok: false; readonly status: number; readonly message: string };

/** Links `project` to the repository `wanted` names, as `claims`, proving
 *  control with `token`, the person's GitHub token.
 *
 *  GitHub is asked for the repository with the person's token; one GitHub
 *  does not show them is a 404, one they neither administer nor maintain a
 *  403, both before the database is asked. Then `app.link_repository` is
 *  called with the ids GitHub returned, never with anything from the form,
 *  and decides whether this person may link this project (owners only),
 *  replacing its link if it had one. Its refusal, or GitHub's failure (502,
 *  reported), comes back as `ok: false` with a sentence. */
export async function linkRepository(sql: Sql, claims: Claims, project: ProjectId, github: GitHub, token: string, wanted: Wanted): Promise<Linked> {
    let repo: Repository | null;
    try {
        repo = 'id' in wanted ? await github.repositoryById(token, wanted.id) : await github.repositoryByName(token, wanted.name);
    } catch (e) {
        if (!(e instanceof GitHubError)) throw e;
        return { ok: false, status: 502, message: `${report('github', e.message)}.` };
    }
    if (repo === null) {
        return {
            ok: false,
            status: 404,
            message: `GitHub shows you no repository ${'id' in wanted ? 'with that id' : wanted.name} through the App. Install the App on its account, or add the repository to the installation.`,
        };
    }
    if (!mayLink(repo)) return { ok: false, status: 403, message: `To link ${repo.fullName} you need admin or maintain on it, and GitHub says you have neither.` };
    try {
        await asUser(sql, claims, tx => tx`select app.link_repository(${project}, ${repo.id}, ${repo.ownerId}, ${repo.fullName})`);
    } catch (e) {
        return { ok: false, ...refusalOf('github', e) };
    }
    return { ok: true, repository: repo.fullName };
}

/** Unlinks `project` as `claims`, through `app.unlink_repository`, which
 *  takes it from owners only and refuses a project with no link (P0002, a
 *  404). Throws the database's refusal (map it with `refusalOf`). */
export async function unlinkRepository(sql: Sql, claims: Claims, project: ProjectId): Promise<void> {
    await asUser(sql, claims, tx => tx`select app.unlink_repository(${project})`);
}

/** A project's link as the page shows it. */
export interface LinkView {
    /** `owner/name` when it was linked: a rename since is not reflected. */
    readonly repository: string;
    /** When it was linked. */
    readonly linkedAt: Date;
    /** Login or name of the owner who linked it; null when the caller may
     *  not see their profile, or they have neither. */
    readonly linkedBy: string | null;
    /** Whether the person who linked it is still an owner of the edition,
     *  as far as the caller can see the enrolments. For display only: it
     *  says why releases stopped, and `app.publish_release_with_repository`
     *  decides it again on every publish. */
    readonly ownerCurrent: boolean;
    /** The project's newest release published by link (`published_from`
     *  set): when, with what label, from which name. Null when none was. */
    readonly lastPublish: { readonly at: Date; readonly label: string; readonly from: string } | null;
}

/** `project`'s link, as the caller in `tx` may see it: null when it has
 *  none or the caller may not read it (students; the table's policy lets
 *  only staff of the edition read links). */
export async function linkOf(tx: Tx, project: ProjectId): Promise<LinkView | null> {
    const [l] = await tx<{ repository: string; linked_at: Date; linked_by: string | null; owner_current: boolean }[]>`
    select l.repository, l.linked_at, coalesce(u.github_login, u.full_name) as linked_by,
           exists (select 1 from enrollment en join project p on p.edition_id = en.edition_id
                   where p.project_id = l.project_id and en.user_id = l.linked_by and en.role = 'owner') as owner_current
    from repository_link l left join app_user u on u.user_id = l.linked_by
    where l.project_id = ${project}`;
    if (l === undefined) return null;
    const [r] = await tx<{ uploaded_at: Date; label: string; published_from: string }[]>`
    select uploaded_at, label, published_from from project_release
    where project_id = ${project} and published_from is not null order by seq desc limit 1`;
    return {
        repository: l.repository,
        linkedAt: l.linked_at,
        linkedBy: l.linked_by,
        ownerCurrent: l.owner_current,
        lastPublish: r === undefined ? null : { at: r.uploaded_at, label: r.label, from: r.published_from },
    };
}

/** What a route needs to talk to GitHub for the App in `config`: the client
 *  and the cookies' key (derived anew each time; deriving is cheap). */
export async function githubFor(config: GitHubConfig, fetchFn: typeof fetch = fetch): Promise<{ readonly github: GitHub; readonly key: CryptoKey }> {
    return { github: githubClient(config, fetchFn), key: await cookieKey(config.clientSecret) };
}
