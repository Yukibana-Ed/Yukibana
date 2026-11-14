/** A file format's versions as a chain: one strict schema per version and one migration between each two, so a file
 *  is parsed at the version it names and handed on as the latest. The program reading it only ever sees the latest
 *  type; a teacher's older file keeps working, and a newer one is refused naming both numbers instead of being read
 *  with fields dropped.
 *
 *  The chain's types are checked where it is written: version `N` is the `N`th schema (`Numbered`), and step `N`
 *  takes version `N`'s output to version `N + 1`'s (`Steps`), through `exact` (`Migration`). Nothing re-validates a
 *  migration's output at run time; the compiler has. */

import type * as z from 'zod';
import type { Migration } from './exact.js';
import { expectation, fieldOf } from './issues.js';

/** One version's schema: an object with a literal `version`. */
export type VersionSchema = z.ZodType<{ readonly version: number }>;

/** `S` iff its `N`th schema (from 1) is version `N`, with `version: N` its literal; `never` otherwise, so a chain
 *  with a version out of place does not compile. */
export type Numbered<S extends readonly VersionSchema[]> = S extends readonly [...infer Init extends readonly VersionSchema[], infer L extends VersionSchema]
    ? z.output<L>['version'] extends [...Init, L]['length']
        ? [...Init, L]['length'] extends z.output<L>['version']
            ? Numbered<Init> extends never
                ? never
                : S
            : never
        : never
    : S;

/** The migrations of a chain of schemas `S`: one per pair of neighbours, each from the first's output to the
 *  second's. Empty for a chain of one. */
export type Steps<S extends readonly VersionSchema[]> = S extends readonly [
    infer A extends VersionSchema,
    infer B extends VersionSchema,
    ...infer Rest extends readonly VersionSchema[],
]
    ? readonly [Migration<z.output<A>, z.output<B>>, ...Steps<readonly [B, ...Rest]>]
    : readonly [];

/** The latest version's output of a chain `S`. */
export type LatestOf<S extends readonly VersionSchema[]> = S extends readonly [...unknown[], infer L extends VersionSchema] ? z.output<L> : never;

/** Any version's output of a chain `S`: a union discriminated by `version`. */
export type AnyOf<S extends readonly VersionSchema[]> = z.output<S[number]>;

/** One thing wrong with a field of a file, as the teacher reads it. */
export interface FieldIssue {
    /** The field, as a path from the top: `submission.include[2]`; `''` for the file as a whole. */
    readonly field: string;
    /** What is wrong, as the end of a sentence after the field's name: "must be true or false". */
    readonly problem: string;
}

/** Why a file could not be read. Each host turns it into its own words (`describe` gives the default ones), which is
 *  why a newer version carries both numbers: the IDE offers its update, the CLI names the npm command. */
export type ReadError =
    | {
          /** The text is not JSON. */
          readonly kind: 'not-json';
          /** What the JSON parser said. */
          readonly reason: string;
      }
    | {
          /** The JSON is not an object (an array, a string, null, ...). */
          readonly kind: 'not-object';
      }
    | {
          /** The object has no `version` field. */
          readonly kind: 'no-version';
      }
    | {
          /** `version` is a whole number above the latest this package reads: the file needs a newer program. */
          readonly kind: 'newer';
          /** The version the file names. */
          readonly version: number;
          /** The latest version this package reads. */
          readonly latest: number;
      }
    | {
          /** `version` is something no release of this package has read: zero, negative, a fraction, not a number. */
          readonly kind: 'unknown-version';
          /** The `version` field as the file has it. */
          readonly version: unknown;
      }
    | {
          /** The file names a version this package reads, and is not valid at it. */
          readonly kind: 'fields';
          /** The version the file names. */
          readonly version: number;
          /** Every problem, each naming its field, in the order zod found them; never empty. */
          readonly issues: readonly [FieldIssue, ...FieldIssue[]];
      };

/** The outcome of reading a file at its version. */
export type Read<Latest, Any> =
    | {
          /** `true` iff the file is valid at the version it names. */
          readonly ok: true;
          /** The file migrated to the latest version: what a program acts on. */
          readonly file: Latest;
          /** The file as written, at its own version, discriminated by `version`: what a program writes back when the
           *  file must keep the teacher's version (a starter's copy). */
          readonly written: Any;
      }
    | {
          /** `true` iff the file is valid at the version it names. */
          readonly ok: false;
          /** Why it is not. */
          readonly error: ReadError;
      };

/** A file format whose every version a chain knows. */
export interface Format<Latest, Any> {
    /** The file's name, which `describe` puts in its sentences. */
    readonly name: string;
    /** The latest version, the length of the chain. */
    readonly latest: number;
    /** Returns `text` read at the version it names and migrated to the latest, or why it cannot be. Never throws. */
    read(text: string): Read<Latest, Any>;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Returns the format called `name` whose version `N` is `schemas[N - 1]` and whose step from `N` to `N + 1` is
 * `steps[N - 1]`.
 *
 * Requires: each schema has no transform, so a value it outputs parses again to itself (the brands of `brands.ts` are
 * the only refinements). Checked by the type tests that hold each version's input and output types equal.
 */
export function format<const S extends readonly [VersionSchema, ...VersionSchema[]]>(name: string, schemas: S & Numbered<S>, steps: Steps<S>): Format<LatestOf<S>, AnyOf<S>> {
    const latest = schemas.length;
    // The one place the chain's types are left to the compiler's word: `Steps` proved that each step takes what the
    // one before it gave, and a loop over a tuple of different function types has no other type to give them.
    const chain = steps as unknown as readonly ((value: unknown) => unknown)[];
    return {
        name,
        latest,
        read(text) {
            let raw: unknown;
            try {
                raw = JSON.parse(text);
            } catch (e) {
                return { ok: false, error: { kind: 'not-json', reason: e instanceof Error ? e.message : String(e) } };
            }
            if (!isObject(raw)) return { ok: false, error: { kind: 'not-object' } };
            if (!('version' in raw)) return { ok: false, error: { kind: 'no-version' } };
            const version = raw['version'];
            if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return { ok: false, error: { kind: 'unknown-version', version } };
            if (version > latest) return { ok: false, error: { kind: 'newer', version, latest } };
            const schema = schemas[version - 1] as VersionSchema;
            const parsed = schema.safeParse(raw);
            if (!parsed.success) {
                const [first, ...rest] = parsed.error.issues.map(issue => ({ field: fieldOf(issue.path), problem: expectation(issue) }));
                return { ok: false, error: { kind: 'fields', version, issues: first === undefined ? [{ field: '', problem: 'is not valid' }] : [first, ...rest] } };
            }
            const file = chain.slice(version - 1).reduce<unknown>((value, step) => step(value), parsed.data);
            return { ok: true, file: file as LatestOf<S>, written: parsed.data as AnyOf<S> };
        },
    };
}

/** Returns `error` as the sentences a teacher reads, naming `name`, the file: every field problem, joined by "; ",
 *  because the teacher fixes the file, and a file with three mistakes once took three runs. A host that has more to
 *  say about a newer version (where its update is) says that instead. */
export function describe(name: string, error: ReadError): string {
    switch (error.kind) {
        case 'not-json':
            return `${name} is not JSON: ${error.reason}`;
        case 'not-object':
            return `${name} must be an object`;
        case 'no-version':
            return `${name}: "version" is missing; it is the version of the file's shape, 1 for the first`;
        case 'newer':
            return `This project needs ${name} v${error.version}; this program reads up to v${error.latest}`;
        case 'unknown-version':
            return `${name}: "version" must be a whole number from 1, not ${JSON.stringify(error.version)}`;
        case 'fields':
            return error.issues.map(({ field, problem }) => (field === '' ? `${name} ${problem}` : `${name}: "${field}" ${problem}`)).join('; ');
    }
}
