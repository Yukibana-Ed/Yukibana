/** What makes a migration's output exactly the next version's type, checked by the compiler.
 *
 *  TypeScript reports an excess property only on an object literal written where the type is expected. A key that
 *  arrives any other way, from a spread (`{ ...v1, removed: x }`), a variable, or a nested object built elsewhere, is
 *  accepted by structural typing, and `JSON.stringify` writes it into the student's file. A migration is exactly the
 *  code that builds the next version from the previous one with spreads, so it is where that gap would bite.
 *  `exact<B>()` closes it: its argument's inferred type is compared with `B` key by key, at every depth, and any key
 *  `B` does not have turns into `never`, which no value can be. Its result is `Checked<B>`, a brand nothing else in
 *  the package can produce, and `Migration<A, B>` must return one, so a migration that skips the check does not
 *  compile.
 *
 *  Imports nothing at run time: `exact` returns its argument unchanged.
 */

import type * as z from 'zod';

/** What `Exactly` treats as a leaf: compared as a whole, never looked into. */
type Leaf = string | number | boolean | bigint | symbol | null | undefined;

/**
 * `T` if it has no key `B` lacks, at any depth; otherwise `T` with each such key's type replaced by `never`, so that
 * `T & Exactly<B, T>` has no value and the call that needed it does not compile.
 *
 * - A leaf (a primitive, a zod brand) is `T` iff `T` is assignable to `B`, and `never` otherwise. The second half is
 *   what makes a union's wrong branch fail: a value of branch `a` checked against branch `b` has a discriminant that
 *   is not `b`'s, so that branch's mapping is `never` rather than a false fit.
 * - An array or tuple maps each element against `B`'s element type.
 * - An object maps each of `T`'s keys: one `B` has is checked against `B`'s type for it, one it lacks is `never`. A
 *   record's keys are all `B`'s, so only its values are checked.
 * - A union `B` distributes: `T` must fit one branch exactly, which is the only reading of "exactly a union". A union
 *   `T` (a field whose value is already of the union type) distributes too: each of its members must fit a branch.
 */
export type Exactly<B, T> = T extends unknown ? ExactlyOne<B, T> : never;

/** `Exactly` for one member `T` of a union, against every branch of `B`. */
type ExactlyOne<B, T> = [B] extends [Leaf]
    ? [T] extends [B]
        ? T
        : never
    : B extends z.core.$brand
      ? [T] extends [B]
          ? T
          : never
      : B extends readonly (infer E)[]
        ? T extends readonly unknown[]
            ? { [I in keyof T]: Exactly<E, T[I]> }
            : never
        : B extends object
          ? [T] extends [B]
              ? { [K in keyof T]: K extends keyof B ? Exactly<B[K], T[K]> : never }
              : never
          : [T] extends [B]
            ? T
            : never;

/** The brand only `exact()` puts on a value. Declared and never defined: it exists in types alone, and is not
 *  exported, so no other module can name it to forge a `Checked`. */
declare const checked: unique symbol;

/** A value of `B` that `exact<B>()` has seen to have exactly `B`'s keys. Assignable to `B` wherever `B` is needed;
 *  nothing but `exact` produces one. */
export type Checked<B> = B & { readonly [checked]: true };

/** One step of the chain: the file at one version, rewritten as the next. Must return through `exact<B>()`, and need
 *  not check anything at run time, because the compiler did: the input is a parsed, valid `A`. */
export type Migration<A, B> = (a: A) => Checked<B>;

/**
 * Returns the function that brands a value of `B` as `Checked<B>`, which compiles only when the value's inferred type
 * has no key `B` lacks, at any depth (`Exactly`). Curried so that `B` is written and the value's type inferred:
 * `exact<V2>()({ ...v1, added: [] })`.
 *
 * The value is returned as it is: no copy, and no check at run time.
 */
export function exact<B>(): <T extends B>(value: T & Exactly<B, T>) => Checked<B> {
    return value => value as Checked<B>;
}
