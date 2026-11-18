import { error, fail, redirect } from '@sveltejs/kit';
import { TEMPLATES, type Template } from '#lib/templates.ts';
import type { Actions, PageServerLoad } from './$types';
import { trustId, uuidOf, type EditionId, type ProjectId, type ReleaseId, type SubmissionId, type TokenId, type UserId } from '#lib/ids.ts';
import type { EnrolledStudent, HandIn, Release } from '#lib/hand-ins.ts';
import { asUser, refusalOf } from '#lib/server/db.ts';
import { text } from '#lib/server/form.ts';
import { requireClaims, withContext } from '#lib/server/context.ts';
import { acceptSubmission } from '#lib/server/submissions.ts';
import { workerConfig } from '#lib/server/worker.ts';
import { siteOrigin, nonce } from '#lib/server/connect.ts';
import { GITHUB_COOKIE, GITHUB_STATE_COOKIE, GITHUB_STATE_COOKIE_OPTIONS, openToken, sealState } from '#lib/server/github-cookie.ts';
import { authorizeUrlOf, githubFor, installUrlOf, linkOf, linkRepository, pickerFor, unlinkRepository, wantedOf, type LinkView, type Picker } from '#lib/server/github-link.ts';
import { instantOf, isZone, type Reading } from '#lib/wall-time.ts';

interface ProjectRow {
    project_id: ProjectId;
    edition_id: string;
    course_code: string;
    edition_label: string;
    slug: string;
    title: string;
    kind: string;
    available_after: Date | null;
    deadline: Date | null;
    closes_at: Date | null;
    role: string | null;
    /** app.may_edit_projects: whether the settings and publishing controls
     *  would be accepted, so whether to draw them. */
    can_edit: boolean;
    ready: boolean;
    can_submit: boolean;
}

interface SubmissionRow {
    submission_id: string;
    submitted_at: Date;
    byte_size: number;
    sha256: string;
    author_id: string;
    full_name: string | null;
    github_login: string | null;
    late: boolean;
    /** The release the registry recorded the submission as started from,
     *  or null when it said none. */
    base_id: string | null;
}

interface StudentRow {
    email: string;
    user_id: string | null;
    full_name: string | null;
    github_login: string | null;
}

/** `r` as the page reads it (#lib/hand-ins), its base found among
 *  `releases` (the project's, newest first; empty for a student, who cannot
 *  read releases and so sees no base). */
function handInOf(r: SubmissionRow, releases: readonly Release[]): HandIn {
    const at = releases.findIndex(x => x.releaseId === r.base_id);
    const found = releases[at];
    return {
        submissionId: trustId<SubmissionId>(r.submission_id),
        authorId: trustId<UserId>(r.author_id),
        submittedAt: r.submitted_at,
        byteSize: r.byte_size,
        sha256: r.sha256,
        late: r.late,
        base: found === undefined ? null : { ...found, version: releases.length - at, latest: at === 0 },
        fullName: r.full_name,
        githubLogin: r.github_login,
    };
}

interface ReleaseRow {
    release_id: string;
    label: string;
    commit_sha: string | null;
    starter_size: number;
    teacher_size: number;
    uploaded_at: Date;
    uploader: string | null;
    via_token: boolean;
    /** The repository a release by link came from, as its token named it (`owner/name`, which the page links the commit
     *  on GitHub by);
     *  null for any other release. */
    published_from: string | null;
}

/** The Repository section, as the caller may see it. */
interface GitHubSection {
    /** The project's link; null when it has none. */
    link: LinkView | null;
    /** Whether this browser holds a GitHub connection for this person, so
     *  the picker can be shown. Always false for staff who are not owners. */
    connected: boolean;
    /** The repositories to pick from, listed with the connection only when
     *  the project has no link or the address asks to change it
     *  (`?relink`); null when not listed. */
    picker: Picker | null;
    /** Whether the address asks to change the link (`?relink`). */
    relink: boolean;
    /** The recommended templates (#lib/templates), for an owner; empty for
     *  other staff, who cannot link. */
    templates: readonly Template[];
    /** The App's page on GitHub, `https://github.com/apps/<slug>`. */
    app: string;
}

interface TokenRow {
    token_id: string;
    label: string;
    created_at: Date;
    last_used_at: Date | null;
    revoked_at: Date | null;
}

function ids(params: { edition: string; project: string }): { edition: EditionId; project: ProjectId } {
    const edition = uuidOf<EditionId>(params.edition);
    const project = uuidOf<ProjectId>(params.project);
    if (edition === null || project === null) error(404, 'No such project.');
    return { edition, project };
}

/** A project as the caller sees it: the project with the database's
 *  answers to "may this person edit it" and "may they submit now", every
 *  submission they may read (their own for a student, everyone's for
 *  staff), newest first (#lib/hand-ins `HandIn`), for staff the edition's
 *  students and every release by id (`allReleases`, newest first), the
 *  newest 20 releases in full for staff, and the tokens
 *  for an owner (never their secrets, which are not stored). Where the
 *  GitHub App is configured, staff also get the Repository section
 *  (`github`; null otherwise and for students): the link, and for an owner
 *  holding a GitHub connection, the repositories they may link, listed
 *  after the transaction (no transaction waits on GitHub) and only when
 *  the project has no link or the address says `?relink`. GitHub failing
 *  never fails the page (`pickerFor`). A 404 for a
 *  project the caller cannot see, for one that is not in the edition the
 *  address names, and for parameters that are not uuids; the login page
 *  for nobody. */
export const load: PageServerLoad = async event => {
    const claims = requireClaims(event);
    const { edition, project } = ids(event.params);
    const app = workerConfig().github;
    return withContext(async ctx => {
        const page = await asUser(ctx.sql, claims, async tx => {
            const [p] = await tx<ProjectRow[]>`
        select p.project_id, p.edition_id, c.code as course_code, e.label as edition_label, p.slug, p.title, p.kind::text as kind, p.available_after, p.deadline, p.closes_at,
               app.role_in(p.edition_id)::text as role,
               app.may_edit_projects(p.edition_id) as can_edit,
               app.current_starter(p.project_id) is not null as ready,
               app.can_submit(p.project_id) as can_submit
        from project p
        join course_edition e on e.edition_id = p.edition_id
        join course c on c.course_id = e.course_id
        where p.project_id = ${project} and p.edition_id = ${edition}`;
            if (p === undefined) error(404, 'No such project.');
            const staff = p.role === 'owner' || p.role === 'assistant';
            const owner = p.role === 'owner';
            const rows = await tx<SubmissionRow[]>`
        select s.submission_id, s.submitted_at, s.byte_size, encode(s.sha256, 'hex') as sha256, s.author_id, u.full_name, u.github_login,
               coalesce(s.submitted_at > ${p.deadline}::timestamptz, false) as late, s.base_release_id as base_id
        from submission s
        left join app_user u on u.user_id = s.author_id
        where s.project_id = ${project}
        order by s.submitted_at desc`;
            const releases = staff
                ? await tx<ReleaseRow[]>`
            select r.release_id, r.label, r.commit_sha, r.starter_size, r.teacher_size, r.uploaded_at,
                   coalesce(u.github_login, u.full_name) as uploader, r.token_id is not null as via_token, r.published_from
            from project_release r left join app_user u on u.user_id = r.uploaded_by
            where r.project_id = ${project} order by r.seq desc limit 20`
                : [];
            const tokens = owner
                ? await tx<TokenRow[]>`
            select token_id, label, created_at, last_used_at, revoked_at from project_token
            where project_id = ${project} order by created_at desc`
                : [];
            // Every student of the edition, whether or not they have sent
            // anything: the Submissions tab is about who still owes work.
            // The enrolment policy shows staff their edition's rows.
            const students = staff
                ? (
                      await tx<StudentRow[]>`
            select en.email, en.user_id, u.full_name, u.github_login
            from enrollment en left join app_user u on u.user_id = en.user_id
            where en.edition_id = ${p.edition_id} and en.role = 'student'
            order by en.email`
                  ).map((r): EnrolledStudent => ({
                      email: r.email,
                      userId: r.user_id === null ? null : trustId<UserId>(r.user_id),
                      fullName: r.full_name,
                      githubLogin: r.github_login,
                  }))
                : [];
            // Every release, newest first, by id and label: what a submission's
            // version is counted in, and what an assembly in the browser chooses
            // from (#lib/hand-ins/assembled). Empty for a student.
            const all = staff
                ? (
                      await tx<{ release_id: string; label: string }[]>`
            select release_id, label from project_release where project_id = ${project} order by seq desc`
                  ).map((r): Release => ({ releaseId: trustId<ReleaseId>(r.release_id), label: r.label }))
                : [];
            const submissions = rows.map(r => handInOf(r, all));
            const link = app !== null && staff ? await linkOf(tx, project) : null;
            // The registry's address the page tells a workflow to use: the
            // site's canonical origin, not the one this page was opened at. A
            // CI job asks GitHub for a token whose audience is that address,
            // and the registry accepts only its own canonical origin, so a
            // snippet copied from the workers.dev address would publish
            // nothing (docs/cloud/github.md).
            const origin = siteOrigin(workerConfig().siteUrl, event.url);
            return { project: p, staff, owner, submissions, students, allReleases: all, releases, tokens, link, origin };
        });
        const { link, ...rest } = page;
        if (app === null || !page.staff) return { ...rest, github: null };
        const relink = page.owner && event.url.searchParams.has('relink');
        let connected = false;
        let picker: Picker | null = null;
        if (page.owner) {
            const { github, key } = await githubFor(app);
            const token = await openToken(event.cookies.get(GITHUB_COOKIE), claims.sub, key, new Date());
            connected = token !== null;
            if (token !== null && (link === null || relink)) picker = await pickerFor(github, token);
        }
        const section: GitHubSection = { link, connected, picker, relink, templates: page.owner ? TEMPLATES : [], app: `https://github.com/apps/${app.slug}` };
        return { ...rest, github: section };
    });
};

/** The GitHub App, or null where none is configured, for the actions. */
const githubApp = () => workerConfig().github;
/** What a GitHub action answers where no GitHub App is configured. */
const noGitHub = () => fail(404, { error: 'This registry does not link projects to GitHub.' });

/** A `fail` for a failure of an action's database work: the database's
 *  status and sentence for a refusal, a 500 with a fixed sentence for
 *  anything else (`refusalOf`, which reports it). */
const failing = (e: unknown) => {
    const { status, message } = refusalOf('projects', e);
    return fail(status, { error: message });
};
const httpFailing = (e: unknown) => {
    if (typeof e === 'object' && e !== null && 'status' in e && 'body' in e) {
        const err = e as { status: number; body: { message: string } };
        return fail(err.status, { error: err.body.message });
    }
    return failing(e);
};
/** The form's three times as instants, read in the zone the page wrote them
 *  in (its hidden `zone` field), each keeping the instant it was rendered
 *  from (its hidden `…_was` field) when its text is unchanged
 *  (#lib/wall-time). A form without a zone is a page from before times
 *  carried one, written in the browser's zone, which the Worker cannot
 *  know: it is refused rather than read as UTC, which is the bug it was. */
function timesOf(form: FormData): { ok: true; availableAfter: Date | null; deadline: Date | null; closesAt: Date | null } | { ok: false; why: string } {
    const zone = text(form, 'zone');
    if (!isZone(zone)) return { ok: false, why: 'This page is out of date: reload it and save again.' };
    const read = (name: string): Reading => {
        const was = new Date(text(form, `${name}_was`));
        return instantOf(text(form, name), zone, Number.isNaN(was.getTime()) ? null : was);
    };
    const availableAfter = read('available_after');
    if (!availableAfter.ok) return availableAfter;
    const deadline = read('deadline');
    if (!deadline.ok) return deadline;
    const closesAt = read('closes_at');
    if (!closesAt.ok) return closesAt;
    return { ok: true, availableAfter: availableAfter.at, deadline: deadline.at, closesAt: closesAt.at };
}

/** The project page's forms. Every action requires a signed-in caller and
 *  parameters that are uuids (else a 404), and leaves the decision of who
 *  may to the database. A refusal is a `fail` whose `error` is a sentence
 *  for the person; a failure that is not one is a 500 with a fixed
 *  sentence, reported and not shown (`refusalOf`).
 *
 *  Of the actions, only `update` checks that the project is in the edition the address
 *  names. `submit`, `createToken`, `revokeToken`, `linkRepository` and
 *  `unlinkRepository` check only that the `edition` parameter is a uuid and
 *  act on the project (or token) by its own id, so under another edition's
 *  address they do what they would do under the right one; `load` answers
 *  that address with a 404. Nothing is widened by it: the database decides
 *  by the project, not the address. `connectGithub` decides nothing and
 *  only remembers the address, to come back to it.
 *
 *  The three GitHub actions answer 404 where no GitHub App is configured. */
export const actions: Actions = {
    /** The page's upload form: the `archive` file, through
     *  `acceptSubmission`, with no base release. Answers `{ submitted }`
     *  with what was recorded, or a `fail` with the status
     *  `acceptSubmission` threw. The API route does the same for an IDE. */
    submit: async event => {
        const claims = requireClaims(event);
        const { project } = ids(event.params);
        const form = await event.request.formData();
        const file = form.get('archive');
        if (!(file instanceof File)) return fail(400, { error: 'Choose a .tar.gz file.' });
        const bytes = new Uint8Array(await file.arrayBuffer());
        try {
            const accepted = await withContext(ctx => acceptSubmission(ctx, claims, project, bytes, null));
            return { submitted: accepted };
        } catch (e) {
            return httpFailing(e);
        }
    },
    /** The Settings form: the title and the three times (`timesOf`). Under
     *  the project policy, which lets only those who may edit the edition's
     *  projects change one. A project the policy hides from the caller, or
     *  that is not in this edition, is a 403 that says nothing changed: an
     *  update that matched no row used to answer `{ ok: true }`. Answers
     *  `{ ok: true }`. */
    update: async event => {
        const claims = requireClaims(event);
        const { edition, project } = ids(event.params);
        const form = await event.request.formData();
        const title = text(form, 'title');
        if (title === '') return fail(400, { error: 'A project needs a title.' });
        const times = timesOf(form);
        if (!times.ok) return fail(400, { error: times.why });
        const { availableAfter, deadline, closesAt } = times;
        let updated: number;
        try {
            updated = await withContext(ctx =>
                asUser(ctx.sql, claims, async tx => {
                    const rows = await tx`
          update project set title = ${title}, available_after = ${availableAfter}, deadline = ${deadline}, closes_at = ${closesAt}
          where project_id = ${project} and edition_id = ${edition}
          returning project_id`;
                    return rows.length;
                }),
            );
        } catch (e) {
            return failing(e);
        }
        if (updated === 0) return fail(403, { error: 'You may not change this project; nothing was saved.' });
        return { ok: true };
    },
    /** A new project token labelled `label` (`ci` when empty), through
     *  `app.create_project_token`, owners only. Answers `{ token }` with the
     *  label and the secret, which is shown this once and stored nowhere. */
    createToken: async event => {
        const claims = requireClaims(event);
        const { project } = ids(event.params);
        const form = await event.request.formData();
        const label = text(form, 'label') || 'ci';
        try {
            const secret = await withContext(ctx =>
                asUser(ctx.sql, claims, async tx => {
                    const [row] = await tx<{ secret: string }[]>`select app.create_project_token(${project}, ${label}) as secret`;
                    if (row === undefined) throw new Error('no token returned');
                    return row.secret;
                }),
            );
            return { token: { label, secret } };
        } catch (e) {
            return failing(e);
        }
    },
    /** Revokes the token `token_id` through `app.revoke_project_token`,
     *  which takes it from an owner of the token's own project. That need
     *  not be the project in the address: the function decides by the
     *  token. An id that is not a uuid is a 400. Answers `{ ok: true }`. */
    revokeToken: async event => {
        const claims = requireClaims(event);
        ids(event.params);
        const form = await event.request.formData();
        const token = uuidOf<TokenId>(text(form, 'token_id'));
        if (token === null) return fail(400, { error: 'No such token.' });
        try {
            await withContext(ctx => asUser(ctx.sql, claims, tx => tx`select app.revoke_project_token(${token})`));
        } catch (e) {
            return failing(e);
        }
        return { ok: true };
    },
    /** Connect GitHub: seals a connection in flight into the state cookie
     *  (a fresh random state, the person's `sub`, this edition and project,
     *  and whether a link is being changed, the field `relink=1`; ten minutes) and redirects (303) to GitHub's authorize page, or, with
     *  the field `install=1`, to the App's installation page. Asks nobody
     *  and decides nothing: what may be linked is decided when linking. A
     *  POST like every cookie write, so only this site's own form can start
     *  one. 404 where the GitHub App is not configured. */
    connectGithub: async event => {
        const claims = requireClaims(event);
        const { edition, project } = ids(event.params);
        const app = githubApp();
        if (app === null) return noGitHub();
        const form = await event.request.formData();
        const state = nonce();
        const { key } = await githubFor(app);
        event.cookies.set(
            GITHUB_STATE_COOKIE,
            await sealState({ state, sub: claims.sub, edition, project, relink: text(form, 'relink') === '1' }, key, new Date()),
            GITHUB_STATE_COOKIE_OPTIONS,
        );
        const to = text(form, 'install') === '1' ? installUrlOf(app.slug, state) : authorizeUrlOf(app.clientId, siteOrigin(workerConfig().siteUrl, event.url), state);
        redirect(303, to.toString(), { external: ['https://github.com'] });
    },
    /** Links the project to the repository the form names (`repository_id`
     *  from the picker, or a typed `repository`, `owner/name`), with this
     *  browser's GitHub connection, through `linkRepository`
     *  (#lib/server/github-link): GitHub must show the person admin or
     *  maintain on it, and `app.link_repository` decides whether they may
     *  link this project. Without a connection sealed for this person it is
     *  a 400 that says to connect (and a cookie sealed for somebody else is
     *  deleted). After a link the GitHub cookie is deleted: nothing needs
     *  the token any more. Answers `{ linked }` with the repository's
     *  `owner/name`. */
    linkRepository: async event => {
        const claims = requireClaims(event);
        const { project } = ids(event.params);
        const app = githubApp();
        if (app === null) return noGitHub();
        const form = await event.request.formData();
        const wanted = wantedOf(text(form, 'repository_id'), text(form, 'repository'));
        if (typeof wanted === 'string') return fail(400, { error: wanted });
        const { github, key } = await githubFor(app);
        const held = event.cookies.get(GITHUB_COOKIE);
        const token = await openToken(held, claims.sub, key, new Date());
        if (token === null) {
            if (held !== undefined) event.cookies.delete(GITHUB_COOKIE, { path: '/' });
            return fail(400, { error: 'Connect GitHub first: a connection lasts fifteen minutes, in the browser it was made in.' });
        }
        const linked = await withContext(ctx => linkRepository(ctx.sql, claims, project, github, token, wanted));
        if (!linked.ok) return fail(linked.status, { error: linked.message });
        event.cookies.delete(GITHUB_COOKIE, { path: '/' });
        return { linked: linked.repository };
    },
    /** Unlinks the project's repository through `app.unlink_repository`,
     *  owners only; a project with no link is a 404. Releases already
     *  published stay. Answers `{ unlinked: true }`. */
    unlinkRepository: async event => {
        const claims = requireClaims(event);
        const { project } = ids(event.params);
        if (githubApp() === null) return noGitHub();
        try {
            await withContext(ctx => unlinkRepository(ctx.sql, claims, project));
        } catch (e) {
            return failing(e);
        }
        return { unlinked: true };
    },
};
