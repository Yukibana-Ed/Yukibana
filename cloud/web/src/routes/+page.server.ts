import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { uuidOf, type CourseId } from '#lib/ids.ts';
import { asUser, clashOf, refusalOf } from '#lib/server/db.ts';
import { text } from '#lib/server/form.ts';
import { requireClaims, withContext } from '#lib/server/context.ts';
import { studentProjects } from '#lib/server/student.ts';

interface EditionRow {
    edition_id: string;
    label: string;
    archived_at: Date | null;
    code: string;
    title: string;
    role: string;
}

/** What the home screen shows: the editions the person is in, a student's
 *  projects for the to-do list, and for a teacher the courses they may add
 *  an edition to, each named after the latest edition they can see
 *  (`app.course_name`). Every row comes through the policies, and which
 *  courses take a new edition is `app.may_add_edition`'s answer. An admin
 *  can read every edition; this page lists those they have a role in, and
 *  `/admin` lists them all. */
export const load: PageServerLoad = async event => {
    if (event.locals.claims === null) return { user: null, editions: [], courses: [], platformRole: null, tasks: [] };
    const claims = event.locals.claims;
    return withContext(ctx =>
        asUser(ctx.sql, claims, async tx => {
            const editions = await tx<EditionRow[]>`
        select e.edition_id, e.label, e.archived_at, c.code, e.title, app.role_in(e.edition_id)::text as role
        from course_edition e join course c on c.course_id = e.course_id
        where app.role_in(e.edition_id) is not null
        order by e.archived_at nulls first, c.code, e.label desc`;
            const [me] = await tx<{ role: string | null }[]>`select app.platform_role()::text as role`;
            const platformRole = me?.role ?? null;
            const courses =
                platformRole === 'teacher' || platformRole === 'admin'
                    ? await tx<{ course_id: string; code: string; title: string }[]>`
                select course_id, code, app.course_name(course_id) as title from course where app.may_add_edition(course_id) order by code`
                    : [];
            // The to-do list: every project the person has as a student, across
            // editions. The page sorts and splits it.
            const tasks = editions.some(e => e.role === 'student') ? await studentProjects(tx, claims, null) : [];
            return { user: claims.sub, editions, courses, platformRole, tasks };
        }),
    );
};

/** The home screen's forms, each a teacher's or an admin's. Every action
 *  requires a signed-in caller (`requireClaims`: otherwise the login page),
 *  answers `{ ok: true }` (or, for a new course, a redirect to its first
 *  edition), or a `fail` whose `error` is a sentence for the
 *  person: 400 for an empty field or a course id that is not a uuid, 409
 *  for a name already taken, the database's status and sentence for
 *  anything it refused, and a 500 with a fixed sentence (the failure
 *  itself reported, never shown) for anything else (`refusalOf`). */
export const actions: Actions = {
    /** A new course, by `code` and `title`, and its first edition, labelled
     *  `label`, owned by the caller, through `app.create_course`, which
     *  decides who may (teachers and admins) and audits. Redirects to the
     *  new edition (303). A code another course has is a 409 that does not
     *  say whose: the course is not the caller's to see. */
    createCourse: async event => {
        const claims = requireClaims(event);
        const form = await event.request.formData();
        const code = text(form, 'code');
        const title = text(form, 'title');
        const label = text(form, 'label');
        if (code === '' || title === '' || label === '') return fail(400, { error: 'A course needs a code, a title and the label of its first edition.' });
        let edition: string;
        try {
            edition = await withContext(ctx =>
                asUser(ctx.sql, claims, async tx => {
                    const [row] = await tx<{ id: string }[]>`select app.create_course(${code}, ${title}, ${label}) as id`;
                    if (row === undefined) throw new Error('app.create_course returned no row');
                    return row.id;
                }),
            );
        } catch (e) {
            if (clashOf(e) === 'course_code_key')
                return fail(409, { error: `The course code "${code}" is already taken. If it is your course, ask one of its owners to add you to an edition.` });
            const { status, message } = refusalOf('home', e);
            return fail(status, { error: message });
        }
        redirect(303, `/editions/${edition}`);
    },
    /** A new edition of the course `course_id`, labelled `label`, through
     *  `app.create_edition`, which decides who may and audits. A `course_id`
     *  that is empty or not a uuid is a 400 here: left to the database it
     *  was a 22P02, a 500 whose message quoted the value. A uuid that names
     *  no course the caller may add to is the database's refusal. */
    createEdition: async event => {
        const claims = requireClaims(event);
        const form = await event.request.formData();
        const course = uuidOf<CourseId>(text(form, 'course_id'));
        if (course === null) return fail(400, { error: 'Choose the course to add the edition to.' });
        const label = text(form, 'label');
        if (label === '') return fail(400, { error: 'An edition needs a label, like "2026 autumn".' });
        try {
            await withContext(ctx => asUser(ctx.sql, claims, tx => tx`select app.create_edition(${course}, ${label})`));
        } catch (e) {
            if (clashOf(e) === 'course_edition_course_id_label_key') return fail(409, { error: `This course already has an edition called "${label}". Choose another label.` });
            const { status, message } = refusalOf('home', e);
            return fail(status, { error: message });
        }
        return { ok: true };
    },
};
