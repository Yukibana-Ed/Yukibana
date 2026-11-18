/** What a CI job may publish to, asked of the database with the facts of a
 *  verified token (#lib/server/oidc), and turned into sentences.
 *
 *  `app.ci_projects` decides; this module only says what its verdicts mean,
 *  in the words a job log shows. The same sentences are the database's when
 *  `app.publish_release_with_repository` refuses, so a job reads the same
 *  reason whether it asked first or not.
 */

import type { CiProjectJson, CiProjectsJson } from '#lib/api.ts';
import { trustId, type ProjectId } from '#lib/ids.ts';
import { asPublisher } from './db';
import type { CiIdentity } from './oidc';
import type { Context } from './context';

/** One row of `app.ci_projects`, as the database answers it. For a moved
 *  repository every field but `owner_matches` is null. */
export interface CiLinkRow {
    /** The linked project's id; null for a moved repository. */
    readonly project_id: string | null;
    /** The project's slug; null for a moved repository. */
    readonly project_slug: string | null;
    /** The project's title; null for a moved repository. */
    readonly project_title: string | null;
    /** The title of the project's edition (the course name); null for a moved repository. */
    readonly edition_title: string | null;
    /** The edition's label (`2026 autumn`); null for a moved repository. */
    readonly edition_label: string | null;
    /** True iff the link was made with the owner id the token names; false
     *  for the one row that stands for every link of a moved repository. */
    readonly owner_matches: boolean;
    /** True iff the run is at a tag; null for a moved repository. */
    readonly ref_matches: boolean | null;
    /** True iff whoever made the link still owns the edition; null for a moved repository. */
    readonly owner_current: boolean | null;
}

/** The sentence for a repository whose links were made under another owner. */
export const MOVED = 'This repository moved to another owner; link it again on the project page.';
/** The sentence for a project this repository is not linked to. */
export const NOT_LINKED = 'This repository is not linked to that project; an owner can link it on the project page.';
/** The sentence for a link whose maker no longer owns the edition. */
export const OWNER_GONE = 'The person who linked this repository is no longer an owner of this edition; an owner must link it again.';
/** The sentence for a run that is not at a tag. */
export const onlyTags = (ref: string): string => `Only tags publish; this run is at ${ref}.`;

/** Why the job at `ref` may not publish through the link `row` describes, or
 *  null when it may: the first of the database's verdicts that fails, in
 *  the order the database checks them (owner, ref, linking owner). Pure. */
export function ciRefusal(row: CiLinkRow, ref: string): string | null {
    if (!row.owner_matches) return MOVED;
    if (row.ref_matches !== true) return onlyTags(ref);
    if (row.owner_current !== true) return OWNER_GONE;
    return null;
}

/** Returns the answer of `GET /api/ci/projects` for `rows`, what
 *  `app.ci_projects` said about the job `identity` describes: the projects
 *  whose link matches, in the database's order, each with the reason it
 *  would be refused or null, and the one sentence about moving when any
 *  link was made under another owner. Pure. */
export function ciProjectsOf(identity: CiIdentity, rows: readonly CiLinkRow[]): CiProjectsJson {
    const projects: CiProjectJson[] = [];
    let moved: string | null = null;
    for (const row of rows) {
        if (!row.owner_matches || row.project_id === null) {
            moved = MOVED;
            continue;
        }
        projects.push({
            id: row.project_id,
            slug: row.project_slug ?? '',
            title: row.project_title ?? '',
            edition: [row.edition_title, row.edition_label].filter(s => s !== null && s !== '').join(', '),
            refused: ciRefusal(row, identity.ref),
        });
    }
    return { repository: identity.repository, ref: identity.ref, sha: identity.sha, moved, projects };
}

/** Asks `app.ci_projects`, as the publisher, about every link of the
 *  repository `identity` names. Throws what the database throws. */
export async function ciLinks(ctx: Context, identity: CiIdentity): Promise<CiLinkRow[]> {
    return asPublisher(ctx.sql, async tx => [
        ...(await tx<CiLinkRow[]>`
    select project_id, project_slug, project_title, edition_title, edition_label, owner_matches, ref_matches, owner_current
    from app.ci_projects(${identity.repositoryId}, ${identity.ownerId}, ${identity.ref})`),
    ]);
}

/** Returns why the job `identity` describes may not publish to `project`,
 *  or null when the database would accept it: not linked (or linked to
 *  another repository), moved, not a tag, or a linking owner no longer an
 *  owner. Asked before a byte is stored, so a refused job leaves nothing
 *  in the bucket; the database checks the same again when the row is
 *  written. */
export async function ciRefusalFor(ctx: Context, identity: CiIdentity, project: ProjectId): Promise<string | null> {
    const rows = await ciLinks(ctx, identity);
    const row = rows.find(r => r.project_id !== null && trustId<ProjectId>(r.project_id) === project);
    if (row !== undefined) return ciRefusal(row, identity.ref);
    return rows.some(r => !r.owner_matches) ? MOVED : NOT_LINKED;
}
