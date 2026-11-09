/** The registry's API, as whoever the credentials say.
 *
 *  Everything a person may do from a terminal or an IDE goes through here,
 *  and the registry decides what that is: the same call lists every
 *  student's submissions for a teacher and only their own for a student,
 *  because the database's policies answer, not this class. Credentials are
 *  a function returning an access token, so the caller decides where they
 *  come from: `tokenProvider` over a stored session for the terminal, the
 *  IDE's own login for the extension.
 */

import type { SubmissionBundle } from './bundle.js';
import {
    Unexpected,
    decodeAccepted,
    decodeEdition,
    decodeList,
    decodeMe,
    decodeMember,
    decodePublished,
    decodeProject,
    decodeRelease,
    decodeSubmission,
    type Accepted,
    type Edition,
    type EditionRole,
    type Me,
    type Member,
    type Project,
    type Published,
    type Release,
    type Submission,
} from './lib/wire.js';

/** Where a `YukibanaClient` sends its requests, and as whom. */
export interface ClientOptions {
    /** The registry, like https://cloud.yukibana.dev */
    readonly url: string;
    /** An access token for the person, asked for before every request so a
     *  provider can refresh it. */
    readonly accessToken: () => Promise<string> | string;
    /** The fetch to send requests with; the global one when absent. */
    readonly fetch?: typeof fetch;
}

/** The registry refused, with the sentence it gave; or, for a download, the
 *  bucket the registry sent it to did ("the bucket answered ..."). */
export class RegistryError extends Error {
    /** Makes the error for a response with HTTP status `status`; `message` is
     *  the whole sentence to show. */
    constructor(
        /** The HTTP status. For the registry's own answers: 400 a request
         *  that cannot mean anything (an empty body, an id that is not a
         *  uuid), 401 log in again, 403 not allowed, 404 no such thing or
         *  not visible to you (the registry does not tell those apart), 409
         *  a conflict, 413 too large, 415 not gzip (only the magic bytes are
         *  checked), 5xx the server's fault. For a download whose message
         *  says "the bucket answered", the status is the bucket's, after the
         *  registry's redirect: the presigned download failed (a 403 is an
         *  expired or bad link, a 404 a missing object), which says nothing
         *  about the person's permission or whether they are logged in. */
        readonly status: number,
        message: string,
    ) {
        super(message);
    }
}

/** Which of a project's submissions `submissions` lists; every one the caller may see when empty. */
export interface SubmissionQuery {
    /** Only each author's newest submission: the ones that count. */
    readonly latest?: boolean;
    /** Only this author's, by user id. One that is not a uuid is refused
     *  with 400, not ignored. */
    readonly author?: string;
}

/** The registry's JSON API, as one person: each method is one request (a download also follows its redirect), whose
 *  answer is decoded and checked. A refusal is thrown as a `RegistryError`, an answer this version cannot read as
 *  `Unexpected`, and whatever `accessToken` or `fetch` throws is thrown as it is. */
export class YukibanaClient {
    /** The registry's origin, like https://cloud.yukibana.dev, without a path.
     *  Invariant: its scheme is `http:` or `https:`, so it is never the
     *  string "null" that `URL` gives an opaque origin. */
    readonly origin: string;
    readonly #token: () => Promise<string> | string;
    readonly #fetch: typeof fetch;

    /** Makes a client for `options.url`; nothing is sent until a method is called.
     *
     *  - Requires: `options.url` is an absolute `http:` or `https:` URL.
     *    Enforced: what `new URL` cannot parse (a bare host) throws its
     *    `TypeError`; one that parses with another scheme throws a
     *    `TypeError` naming it. The second check is there because a
     *    schemeless `localhost:5173` parses, with `localhost:` read as the
     *    scheme and an origin of "null", and every request would then go to
     *    `null/api/...`. Its path, query and fragment are dropped; every
     *    request goes to the origin. */
    constructor(options: ClientOptions) {
        const url = new URL(options.url);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            throw new TypeError(`the registry's URL must start with http:// or https://, not ${JSON.stringify(options.url)}`);
        }
        this.origin = url.origin;
        this.#token = options.accessToken;
        this.#fetch = options.fetch ?? fetch;
    }

    /** Returns who the credentials are. */
    me(): Promise<Me> {
        return this.#json('GET', '/api/me', decodeMe);
    }

    /** Returns the editions the person is enrolled in, with their role in each. */
    editions(): Promise<Edition[]> {
        return this.#json('GET', '/api/editions', decodeList(decodeEdition, 'editions'));
    }

    /** Returns an edition's enrolments. Staff see everyone; a student sees
     *  their own. Fails with 404 for an edition the person is not in. */
    members(edition: string): Promise<Member[]> {
        return this.#json('GET', `/api/editions/${seg(edition)}/members`, decodeList(decodeMember, 'members'));
    }

    /** Enrols an address as `role` (owners only). Enrolling an address twice
     *  changes nothing, its role included. */
    async enrol(edition: string, email: string, role: EditionRole = 'student'): Promise<void> {
        await this.#json('POST', `/api/editions/${seg(edition)}/members`, () => undefined, { json: { email, role } });
    }

    /** Removes an enrolment (owners only). Submissions stay. */
    async unenrol(edition: string, email: string): Promise<void> {
        await this.#json('DELETE', `/api/editions/${seg(edition)}/members?email=${encodeURIComponent(email)}`, () => undefined);
    }

    /** Returns the projects the person can see: for a student, those of their
     *  editions whose window is open now; for staff, all of their editions',
     *  drafts included. `edition` narrows the list to one. */
    projects(edition?: string): Promise<Project[]> {
        const q = edition === undefined ? '' : `?edition=${encodeURIComponent(edition)}`;
        return this.#json('GET', `/api/projects${q}`, decodeList(decodeProject, 'projects'));
    }

    /** Returns the project `project` as the person sees it. Fails with 404 when it does not exist or the person may
     *  not see it, which the registry does not tell apart. */
    project(project: string): Promise<Project> {
        return this.#json('GET', `/api/projects/${seg(project)}`, decodeProject);
    }

    /** Returns submissions to a project, newest first, narrowed by `query`.
     *  A `query.author` that is not a user id (a uuid) fails with 400.
     *  Staff see everyone's; a student sees their own, also once the
     *  project's window has closed. Fails with 404 when the person can see
     *  neither the project nor a submission to it. */
    submissions(project: string, query: SubmissionQuery = {}): Promise<Submission[]> {
        const q = new URLSearchParams();
        if (query.latest === true) q.set('latest', 'true');
        if (query.author !== undefined) q.set('author', query.author);
        const qs = q.size === 0 ? '' : `?${q.toString()}`;
        return this.#json('GET', `/api/projects/${seg(project)}/submissions${qs}`, decodeList(decodeSubmission, 'submissions'));
    }

    /** Returns a project's releases, newest first. Only staff are listed any:
     *  a student gets an empty list for a project they can see, and a 404
     *  for one they cannot. */
    releases(project: string): Promise<Release[]> {
        return this.#json('GET', `/api/projects/${seg(project)}/releases`, decodeList(decodeRelease, 'releases'));
    }

    /** Sends a bundle as a new submission to `project` (the one the bundle
     *  names, by default), with the release the bundle says it started from,
     *  and returns the registry's receipt.
     *
     *  - Requires: the bundle has no `problems`, and there is a project
     *    (neither null nor ''). Enforced: each throws a plain `Error`,
     *    without sending. */
    async submit(bundle: SubmissionBundle, project: string | null = bundle.projectId): Promise<Accepted> {
        if (bundle.problems.length > 0) throw new Error(`not submitted: ${bundle.problems.join('; ')}`);
        if (project === null || project === '') throw new Error('not submitted: the folder names no project; give one');
        return this.submitArchive(project, await bundle.archive(), bundle.releaseId);
    }

    /** Sends an archive made elsewhere (a `.tar.gz`) as a new submission, and
     *  returns the registry's receipt. The archive is sent as it is, and the
     *  registry does not look inside it. It refuses an empty one (400), one
     *  over its limit (413) or one that is not gzip (415), and a submission
     *  the person may not make now (403, with the reason: not a student of
     *  the edition, or the window not open or closed, also when it closes
     *  during the upload).
     *  `release` is the release the work started from, as the folder's
     *  yukibana.json says; null when it says none. One that is not a uuid
     *  is a 400; one that names no release of the project is recorded as
     *  none. */
    submitArchive(project: string, archive: Uint8Array, release: string | null = null): Promise<Accepted> {
        const q = release === null ? '' : `?release=${encodeURIComponent(release)}`;
        return this.#json('POST', `/api/projects/${seg(project)}/submissions${q}`, decodeAccepted, { bytes: archive, contentType: 'application/gzip' });
    }

    /** Uploads `starter` and `teacher`, the two gzipped tars a release is made of, as one release of `project`, and
     *  returns what the registry recorded. The credentials may be a person's (an owner or assistant of the project) or a
     *  project token (`yk_…`, from CI), which publishes only to the project it names. `label` is for people (a tag, a
     *  branch; may be ''); `commit` is the commit the archives were built from, or null outside git; `release` is the id
     *  the starter carries (see the CLI's `build`), which the release row is given, or null for archives that carry
     *  none and let the registry choose. A taken id is refused with 409 and nothing is stored. */
    publishRelease(project: string, starter: Uint8Array, teacher: Uint8Array, label: string, commit: string | null, release: string | null): Promise<Published> {
        const form = new FormData();
        form.set('starter', new Blob([starter.slice().buffer], { type: 'application/gzip' }), 'starter.tar.gz');
        form.set('teacher', new Blob([teacher.slice().buffer], { type: 'application/gzip' }), 'teacher.tar.gz');
        form.set('label', label);
        if (commit !== null) form.set('commit', commit);
        if (release !== null) form.set('release', release);
        return this.#json('POST', `/api/projects/${seg(project)}/releases`, decodePublished, { form });
    }

    /** Returns a submission's archive, as sent (a `.tar.gz`). */
    downloadSubmission(submission: string): Promise<Uint8Array> {
        return this.#download(`/api/submissions/${seg(submission)}`);
    }

    /** Returns the starter of the project's newest release, which students
     *  get now (a `.tar.gz`). */
    downloadStarter(project: string): Promise<Uint8Array> {
        return this.#download(`/api/projects/${seg(project)}/starter`);
    }

    /** Returns one archive of a release (a `.tar.gz`). Staff may download either;
     *  a student only the starter, of a release of a project they may download
     *  from now, which is how an IDE fetches the base of an update. */
    downloadRelease(release: string, archive: 'starter' | 'teacher'): Promise<Uint8Array> {
        return this.#download(`/api/releases/${seg(release)}/${archive}`);
    }

    async #request(method: string, path: string, body?: Body): Promise<Response> {
        const headers: Record<string, string> = { authorization: `Bearer ${await this.#token()}`, accept: 'application/json' };
        let payload: BodyInit | undefined;
        if (body === undefined) {
            payload = undefined;
        } else if ('json' in body) {
            headers['content-type'] = 'application/json';
            payload = JSON.stringify(body.json);
        } else if ('bytes' in body) {
            headers['content-type'] = body.contentType;
            payload = new Blob([body.bytes.slice().buffer]);
        } else {
            payload = body.form; // fetch writes the multipart content type, boundary included
        }
        // The registry is a SvelteKit app, and SvelteKit refuses a cross-origin
        // write whose content type a browser form can produce (multipart among
        // them) as "cross-site POST form submissions are forbidden", before any
        // handler runs; a request without an Origin is refused too. A tool is
        // not a browser and says where it is posting. The endpoints take a
        // bearer and no cookie, so there is no ambient credential for a forged
        // form to ride on anyway. (The CLI's publish once sent no Origin, and
        // CI got that 403 after building both archives correctly.)
        if (method !== 'GET') headers['origin'] = this.origin;
        return this.#fetch(`${this.origin}${path}`, { method, headers, redirect: 'manual', ...(payload === undefined ? {} : { body: payload }) });
    }

    async #json<T>(method: string, path: string, decode: (v: unknown) => T, body?: Body): Promise<T> {
        const res = await this.#request(method, path, body);
        const text = await res.text();
        if (!res.ok) throw new RegistryError(res.status, `the registry answered ${res.status}: ${messageOf(text)}`);
        if (res.status === 204 || text === '') return decode(undefined);
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch {
            throw new Unexpected(`the registry answered ${method} ${path} with something other than JSON`);
        }
        return decode(parsed);
    }

    /** Follows the registry's redirect to a presigned URL itself, without the
     *  bearer: the URL is its own credential, and the bucket must not see the
     *  person's token. */
    async #download(path: string): Promise<Uint8Array> {
        const res = await this.#request('GET', path);
        const location = res.headers.get('location');
        if (res.status >= 300 && res.status < 400 && location !== null) {
            await res.body?.cancel();
            const file = await this.#fetch(new URL(location, this.origin));
            if (!file.ok) throw new RegistryError(file.status, `the bucket answered ${file.status} for ${path}`);
            return new Uint8Array(await file.arrayBuffer());
        }
        const text = await res.text();
        if (!res.ok) throw new RegistryError(res.status, `the registry answered ${res.status}: ${messageOf(text)}`);
        throw new Unexpected(`the registry answered ${path} without sending anywhere to download it from`);
    }
}

/** What a request carries: a JSON value, bytes of a content type, or a multipart form. */
type Body = { readonly json: unknown } | { readonly bytes: Uint8Array; readonly contentType: string } | { readonly form: FormData };

const seg = (id: string): string => encodeURIComponent(id);

/** Returns the sentence an error body gives as its `message`, or the whole text when it is not such a JSON body. */
function messageOf(text: string): string {
    try {
        const body = JSON.parse(text) as { message?: unknown };
        return typeof body.message === 'string' ? body.message : text;
    } catch {
        return text;
    }
}
