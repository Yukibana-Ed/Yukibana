/** A teacher's commands for a course repository: check it, build the two
 *  archives, publish them as a release. */

import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { build, commitOf, newReleaseId } from '../build.js';
import { sha256Hex, YukibanaClient } from '@yukibana/client';
import { isProjectId } from '@yukibana/client/config';
import { ciPlanOf, publishModeOf } from '../lib/publish.js';
import { requestOidcToken } from '../oidc.js';
import { accessTokenFor, configProjectOf, fail, projectOf, registryUrl, type Invocation } from './common.js';

/** `check`, `build` and `publish`: the same build, then nothing, a write,
 *  or an upload. */
export async function release(command: 'check' | 'build' | 'publish', inv: Invocation): Promise<void> {
    const dir = resolve(inv.args[0] ?? '.');
    const folder = inv.options.folder ?? basename(dir);
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(folder)) fail(`--folder must be lowercase letters, digits and dashes; "${folder}" is not (it names the directory students unpack)`);

    // CI mode is decided first, before a single project is resolved: under
    // --ci the registry says where the release goes, and a project named
    // anywhere else must not be taken for it.
    if (inv.options.ci === true && command !== 'publish') fail(`--ci is only for publish; ${command} builds without asking the registry anything`);
    if (command === 'publish') {
        const mode = publishModeOf({
            ci: inv.options.ci === true,
            token: inv.options.token,
            project: inv.options.project,
            projects: inv.options.projects,
            envToken: inv.env['YUKIBANA_TOKEN'],
            envProject: inv.env['YUKIBANA_PROJECT'],
            configProject: inv.options.ci === true ? await configProjectOf(dir) : null,
        });
        if (mode.kind === 'refused') fail(...mode.problems);
        if (mode.kind === 'ci') {
            for (const w of mode.warnings) console.error(`warning: ${w}`);
            await publishCi(inv, dir, folder, mode.named);
            return;
        }
    }

    const projectId =
        command === 'publish'
            ? await projectOf(inv, inv.options.project, dir).catch(() => fail('--project (or YUKIBANA_PROJECT) is required to publish'))
            : (inv.options.project ?? inv.env['YUKIBANA_PROJECT'] ?? '');
    // Not for `check`, whose starter nobody receives: a YUKIBANA_PROJECT set for something else must not fail it.
    if (command !== 'check' && projectId !== '' && !isProjectId(projectId))
        fail(`"${projectId}" is not a project id, a uuidv7; the starter would carry it, and its yukibana.json would be refused`);

    // The id is chosen before the build so the starter can carry it, and the
    // publish below gives the row the same one. A check publishes nothing, so
    // its starter names no release; a `build` is for a look inside, and its id
    // names a release that will not exist.
    const releaseId = command === 'check' ? null : newReleaseId();
    const result = await build(dir, folder, projectId, releaseId);
    if (!result.ok) fail(...result.problems);
    if (!result.ok) return;
    const { built } = result;
    for (const w of built.warnings) console.error(`warning: ${w}`);
    if (command === 'build' && projectId === '') {
        console.error('warning: no --project, so the starter does not say where submissions go; students will have to name the project when they submit');
    }
    console.log(`${built.config.kind}: ${built.starterEntries} entries in the starter; ${built.hidden.length === 0 ? 'nothing hidden' : `hidden: ${built.hidden.join(', ')}`}`);
    console.log(`starter ${built.starter.byteLength} bytes sha256 ${sha256Hex(built.starter).slice(0, 12)}; teacher ${built.teacher.byteLength} bytes`);
    if (command === 'check') return;

    if (command === 'build') {
        const out = resolve(inv.options.out ?? join(dir, '.yukibana'));
        await mkdir(out, { recursive: true });
        await writeFile(join(out, 'starter.tar.gz'), built.starter);
        await writeFile(join(out, 'teacher.tar.gz'), built.teacher);
        console.log(`wrote ${join(out, 'starter.tar.gz')} and ${join(out, 'teacher.tar.gz')}`);
        return;
    }

    // A project token from CI, or the person logged in, who must own the project.
    const url = await registryUrl(inv);
    const token = inv.options.token ?? inv.env['YUKIBANA_TOKEN'] ?? (await accessTokenFor(inv)().catch(() => ''));
    if (token === '') fail('--token (or YUKIBANA_TOKEN) is required to publish, unless you are logged in as staff of the project');
    const commit = await commitOf(dir);
    const client = new YukibanaClient({ url, accessToken: () => token, ...fetchOf(inv) });
    const published = await client.publishRelease(projectId, built.starter, built.teacher, inv.options.label ?? '', commit, releaseId);
    console.log(`published release ${published.releaseId}${commit === null ? '' : ` at ${commit.slice(0, 12)}`}`);
}

/** `publish --ci`: one build and one release per project the registry links
 *  to the job's repository and `named` (`--projects`) names, each with a fresh release id, the job's OIDC
 *  token as the bearer (asked of GitHub again for every request, for the
 *  audience `client.origin`, and never printed) and the token's commit.
 *  Prints the repository and every project, published or skipped with its
 *  reason, before it builds. A failure for one project does not stop the
 *  others; at the end it fails (`Failure`) naming every project not
 *  published and why, or that the repository publishes to nothing. A build
 *  that fails fails at once: its problems are the directory's, the same for
 *  every project. */
async function publishCi(inv: Invocation, dir: string, folder: string, named: readonly string[]): Promise<void> {
    const url = await registryUrl(inv);
    const fetchFn = inv.fetch ?? fetch;
    // The audience is the registry's origin, whatever path or trailing slash
    // the URL was given with, which is what the registry expects (its
    // canonical origin): a mismatch is refused with the one it expected.
    const client: YukibanaClient = new YukibanaClient({ url, accessToken: () => requestOidcToken(inv.env, client.origin, fetchFn), fetch: fetchFn });
    const answer = await client.ciProjects().catch((e: unknown) => fail(sentenceOf(e)));
    const plan = ciPlanOf(answer, named);
    for (const line of plan.lines) console.log(line);
    for (const w of plan.warnings) console.error(`warning: ${w}`);

    const failures: string[] = [];
    if (plan.targets.length > 0) {
        // The registry records the token's commit and refuses any other; say
        // so when the directory is checked out somewhere else, since the
        // archives are built from the directory.
        const checkedOut = await commitOf(dir);
        if (checkedOut !== null && checkedOut !== answer.sha)
            console.error(`warning: ${dir} is checked out at ${checkedOut.slice(0, 12)}, but the job runs at ${answer.sha.slice(0, 12)}, which is the commit the releases record`);
    }
    for (const project of plan.targets) {
        const releaseId = newReleaseId();
        const result = await build(dir, folder, project.id, releaseId);
        if (!result.ok) fail(...result.problems);
        if (!result.ok) return;
        const { built } = result;
        // The build's warnings and what it hid are the directory's, the same
        // for every project: printed once.
        if (project === plan.targets[0]) {
            for (const w of built.warnings) console.error(`warning: ${w}`);
            console.log(
                `${built.config.kind}: ${built.starterEntries} entries in the starter; ${built.hidden.length === 0 ? 'nothing hidden' : `hidden: ${built.hidden.join(', ')}`}`,
            );
        }
        try {
            const published = await client.publishRelease(project.id, built.starter, built.teacher, inv.options.label ?? '', answer.sha, releaseId);
            console.log(`published release ${published.releaseId} of ${project.slug} (${project.edition}) at ${answer.sha.slice(0, 12)}`);
        } catch (e) {
            failures.push(`not published to ${project.slug} (${project.edition}): ${sentenceOf(e)}`);
        }
    }
    const problems = [...plan.problems, ...failures];
    if (problems.length > 0) fail(...problems);
}

/** Returns what `e` says for the job log: the sentence of a refusal
 *  (`RegistryError`), of a token that could not be had (`OidcUnavailable`),
 *  or of any other error. */
function sentenceOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/** Returns the fetch option for a client: the invocation's, when a test gave one. */
const fetchOf = (inv: Invocation): { fetch?: typeof fetch } => (inv.fetch === undefined ? {} : { fetch: inv.fetch });
