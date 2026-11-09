import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { uuidOf, type EditionId, type ProjectId } from '#lib/ids.ts';
import { KINDS, type Kind } from '#lib/kinds.ts';
import { asUser, clashOf, refusalOf, statusOf } from '#lib/server/db.ts';
import { text } from '#lib/server/form.ts';
import { requireClaims, withContext } from '#lib/server/context.ts';
import { studentProjects } from '#lib/server/student.ts';

interface ProjectRow {
    project_id: ProjectId;
    slug: string;
    title: string;
    kind: string;
    available_after: Date | null;
    deadline: Date | null;
    closes_at: Date | null;
    releases: number;
    ready: boolean;
    my_submissions: number;
}

interface RosterRow {
    email: string;
    role: string;
    source: string;
    linked: boolean;
    full_name: string | null;
    github_login: string | null;
}

const editionOf = (param: string): EditionId => {
    const id = uuidOf<EditionId>(param);
    if (id === null) error(404, 'No such edition.');
    return id;
};

/** An edition as the caller sees it: the projects the policies let them see
 *  (for a student those whose window is open now, all for staff) in the order students see
 *  them, for a student where they stand with each (`mine`), and for staff
 *  the roster. A 404 for an edition the caller cannot see, whether or not
 *  it exists, and for a parameter that is not a uuid; the login page for
 *  nobody. */
export const load: PageServerLoad = async event => {
    const claims = requireClaims(event);
    const edition = editionOf(event.params.edition);
    return withContext(ctx =>
        asUser(ctx.sql, claims, async tx => {
            const [head] = await tx<{ edition_id: EditionId; label: string; archived_at: Date | null; code: string; title: string; role: string | null; can_edit: boolean }[]>`
        select e.edition_id, e.label, e.archived_at, c.code, e.title, app.role_in(e.edition_id)::text as role,
               app.may_edit_projects(e.edition_id) as can_edit
        from course_edition e join course c on c.course_id = e.course_id
        where e.edition_id = ${edition}`;
            if (head === undefined) error(404, 'No such edition.');
            const staff = head.role === 'owner' || head.role === 'assistant';
            const projects = await tx<ProjectRow[]>`
        select p.project_id, p.slug, p.title, p.kind::text as kind, p.available_after, p.deadline, p.closes_at,
               (select count(*) from project_release r where r.project_id = p.project_id)::int as releases,
               app.current_starter(p.project_id) is not null as ready,
               (select count(*) from submission s where s.project_id = p.project_id and s.author_id = ${claims.sub})::int as my_submissions
        from project p where p.edition_id = ${edition}
        order by p.position nulls last, p.created_at`;
            // A student's list says where they stand with each project.
            const mine = head.role === 'student' ? await studentProjects(tx, claims, edition) : [];
            const roster = staff
                ? await tx<RosterRow[]>`
            select en.email, en.role::text as role, en.source::text as source, en.user_id is not null as linked, u.full_name, u.github_login
            from enrollment en left join app_user u on u.user_id = en.user_id
            where en.edition_id = ${edition}
            order by en.role desc, en.email`
                : [];
            // `canEdit` is the database's answer, the same function its policies
            // ask: the page draws the reorder handles and the new-project form only
            // when they would be accepted.
            return { edition: head, role: head.role, staff, owner: head.role === 'owner', canEdit: head.can_edit, projects, mine, roster, kinds: KINDS };
        }),
    );
};

/** A `fail` for a failure of an action's database work: the database's
 *  status and sentence for a refusal, a 500 with a fixed sentence for
 *  anything else (`refusalOf`, which reports it). */
const failing = (e: unknown) => {
    const { status, message } = refusalOf('editions', e);
    return fail(status, { error: message });
};

/** The two names a person types here that another row may already have,
 *  each refused in words about what they typed rather than the index's. */
const clashing = (e: unknown, label: string, code: string) => {
    switch (clashOf(e)) {
        case 'course_edition_course_id_label_key':
            return fail(409, { error: `This course already has an edition called "${label}". Choose another label.` });
        case 'course_code_key':
            return fail(409, { error: `Another course already has the code "${code}".` });
        default:
            return failing(e);
    }
};

/** The edition page's forms. Every action requires a signed-in caller
 *  and an `edition` parameter that is a uuid (else a 404), and leaves the
 *  decision of who may to the database function or policy it calls. A
 *  refusal is a `fail` whose `error` is a sentence: 400 for a form
 *  that is not filled in right, 409 for a name already taken, otherwise the
 *  database's status and sentence for what it refused (`statusOf`), and a
 *  500 with a fixed sentence, the failure reported and not shown, for
 *  anything else (`refusalOf`). */
export const actions: Actions = {
    /** A drop in the project list: `project` now sits after `after` and before
     *  `before` (either empty at an end of the list). The page posts this as
     *  the drop happens; app.move_project decides whether the caller may and
     *  moves one row. Answers `{ moved: project }`, the id lowercased. A
     *  `project` that is not a uuid, or an `after` or `before` that is
     *  neither empty nor a uuid, is the same 400, "Not a project.". */
    move: async event => {
        const claims = requireClaims(event);
        editionOf(event.params.edition);
        const form = await event.request.formData();
        const neighbour = (name: string): ProjectId | null | undefined => {
            const value = text(form, name);
            return value === '' ? null : (uuidOf<ProjectId>(value) ?? undefined);
        };
        const project = uuidOf<ProjectId>(text(form, 'project'));
        const after = neighbour('after');
        const before = neighbour('before');
        if (project === null || after === undefined || before === undefined) return fail(400, { error: 'Not a project.' });
        try {
            await withContext(ctx => asUser(ctx.sql, claims, tx => tx`select app.move_project(${project}, ${after}, ${before})`));
        } catch (e) {
            return failing(e);
        }
        return { moved: project };
    },
    /** Enrols `email` with `role` (`student` when empty; `assistant` and
     *  `owner` too; anything else a 400) through `app.enrol`, owners only. An
     *  address without an `@` is a 400; the function lowercases it. Answers
     *  `{ ok: true }`, also for an address already enrolled, which stays as
     *  it was, role included: changing a role is `setRole`. */
    enrol: async event => {
        const claims = requireClaims(event);
        const edition = editionOf(event.params.edition);
        const form = await event.request.formData();
        const email = text(form, 'email');
        const role = text(form, 'role') || 'student';
        if (!email.includes('@')) return fail(400, { error: 'Enrol by email address.' });
        if (!['student', 'assistant', 'owner'].includes(role)) return fail(400, { error: 'Unknown role.' });
        try {
            await withContext(ctx => asUser(ctx.sql, claims, tx => tx`select app.enrol(${edition}, ${email}, ${role}::app.edition_role)`));
        } catch (e) {
            return failing(e);
        }
        return { ok: true };
    },
    /** Changes the role of the enrolment of `email` to `role` through
     *  `app.set_edition_role`, owners only; an edition keeps at least one
     *  owner (a 409), and an address not enrolled is a 404. Answers
     *  `{ ok: true }`. */
    setRole: async event => {
        const claims = requireClaims(event);
        const edition = editionOf(event.params.edition);
        const form = await event.request.formData();
        const email = text(form, 'email');
        const role = text(form, 'role');
        if (!['student', 'assistant', 'owner'].includes(role)) return fail(400, { error: 'Unknown role.' });
        try {
            await withContext(ctx => asUser(ctx.sql, claims, tx => tx`select app.set_edition_role(${edition}, ${email}, ${role}::app.edition_role)`));
        } catch (e) {
            return failing(e);
        }
        return { ok: true };
    },
    /** Removes the enrolment of `email` through `app.unenrol`, owners only.
     *  Removing the edition's last owner is a 409. Answers `{ ok: true }`,
     *  also for an address that is not enrolled, which changes nothing. */
    unenrol: async event => {
        const claims = requireClaims(event);
        const edition = editionOf(event.params.edition);
        const form = await event.request.formData();
        const email = text(form, 'email');
        try {
            await withContext(ctx => asUser(ctx.sql, claims, tx => tx`select app.unenrol(${edition}, ${email})`));
        } catch (e) {
            return failing(e);
        }
        return { ok: true };
    },
    /** A new project in this edition, from `slug` (lowercased; letters,
     *  digits and dashes, starting with a letter or digit, at most 64),
     *  `title` and `kind` (one of `KINDS`), inserted under the project
     *  policy, which takes it only from those who may edit the edition's
     *  projects. A slug the edition has is a 409. Answers with a 303 to the
     *  new project's page. */
    createProject: async event => {
        const claims = requireClaims(event);
        const edition = editionOf(event.params.edition);
        const form = await event.request.formData();
        const slug = text(form, 'slug').toLowerCase();
        const title = text(form, 'title');
        const kind = text(form, 'kind');
        if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) return fail(400, { error: 'A slug is lowercase letters, digits and dashes: it names the folder students unpack.' });
        if (title === '') return fail(400, { error: 'A project needs a title.' });
        if (!(KINDS as readonly string[]).includes(kind)) return fail(400, { error: 'Unknown project kind.' });
        let id: string;
        try {
            id = await withContext(ctx =>
                asUser(ctx.sql, claims, async tx => {
                    const [row] = await tx<{ project_id: string }[]>`
            insert into project (edition_id, slug, title, kind) values (${edition}, ${slug}, ${title}, ${kind as Kind}::app.project_kind)
            returning project_id`;
                    if (row === undefined) throw new Error('insert returned nothing');
                    return row.project_id;
                }),
            );
        } catch (e) {
            // The one refusal a person can fix by typing something else: the
            // constraint's own sentence names an index, not the slug.
            if (statusOf(e).code === '23505') return fail(409, { error: `This edition already has a project called "${slug}". Choose another slug.` });
            return failing(e);
        }
        redirect(303, `/editions/${edition}/projects/${id}`);
    },
    /** A copy of this edition labelled `label`, through
     *  `app.duplicate_edition`, owners only. A label the course has is a
     *  409. Answers with a 303 to the new edition. */
    duplicate: async event => {
        const claims = requireClaims(event);
        const edition = editionOf(event.params.edition);
        const form = await event.request.formData();
        const label = text(form, 'label');
        if (label === '') return fail(400, { error: 'The new edition needs a label.' });
        let id: string;
        try {
            id = await withContext(ctx =>
                asUser(ctx.sql, claims, async tx => {
                    const [row] = await tx<{ id: string }[]>`select app.duplicate_edition(${edition}, ${label}) as id`;
                    if (row === undefined) throw new Error('duplicate returned nothing');
                    return row.id;
                }),
            );
        } catch (e) {
            return clashing(e, label, '');
        }
        redirect(303, `/editions/${id}`);
    },
    /** The edition's label and course name, and the code its course is
     *  listed under, from the Settings form. One transaction, so a code that
     *  is taken leaves the names as they were too. The code is only written
     *  when it changed: it is the course's, shared with editions this owner
     *  may not be in, and the audit log should not show it set to itself. */
    details: async event => {
        const claims = requireClaims(event);
        const edition = editionOf(event.params.edition);
        const form = await event.request.formData();
        const label = text(form, 'label');
        const title = text(form, 'title');
        const code = text(form, 'code');
        if (label === '' || title === '' || code === '') return fail(400, { error: 'An edition needs a label, a course name and a course code.' });
        try {
            await withContext(ctx =>
                asUser(ctx.sql, claims, async tx => {
                    await tx`select app.update_edition(${edition}, ${label}, ${title})`;
                    const [course] = await tx<{ course_id: string; code: string }[]>`
            select c.course_id, c.code from course_edition e join course c on c.course_id = e.course_id
            where e.edition_id = ${edition}`;
                    if (course !== undefined && course.code !== code) await tx`select app.set_course_code(${course.course_id}, ${code})`;
                }),
            );
        } catch (e) {
            return clashing(e, label, code);
        }
        return { ok: true };
    },
    /** Archives the edition when the form's `archived` is `true`, and
     *  restores it otherwise, through `app.archive_edition`, owners only.
     *  Answers `{ ok: true }`. */
    archive: async event => {
        const claims = requireClaims(event);
        const edition = editionOf(event.params.edition);
        const form = await event.request.formData();
        const archived = form.get('archived') === 'true';
        try {
            await withContext(ctx => asUser(ctx.sql, claims, tx => tx`select app.archive_edition(${edition}, ${archived})`));
        } catch (e) {
            return failing(e);
        }
        return { ok: true };
    },
};
