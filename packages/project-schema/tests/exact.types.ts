// Type tests, run by `tsc` in `typecheck` (nothing here runs): each `@ts-expect-error` is a negative, a line that must
// not compile, and the build fails if it does.
import * as z from 'zod';
import { exact, type Migration } from '../src/exact.js';
import { globsSchema, projectIdSchema, type Globs, type ProjectId } from '../src/brands.js';
import { projectFileV1, type ProjectFileV1 } from '../src/v1.js';
import { releaseFileV1 } from '../src/release-file.js';
import { format } from '../src/versions.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const holds = <T extends true>(): T => true as T;

interface Inner {
    readonly a: number;
}
interface Shape {
    readonly top: string;
    readonly nested: Inner;
    readonly list: readonly Inner[];
    readonly record: Readonly<Record<string, Inner>>;
    readonly either: Inner | { readonly b: string };
    readonly tagged: { readonly kind: 'x'; readonly x: number } | { readonly kind: 'y'; readonly y: number };
    readonly id: ProjectId;
    readonly globs: Globs;
}

declare const base: Shape;
declare const inner: Inner;
const toShape = exact<Shape>();

// The exact shape, built from spreads, compiles: every key is Shape's.
toShape({ ...base, nested: { ...inner } });

// @ts-expect-error A key Shape lacks, from a spread at the top level.
toShape({ ...base, extra: 1 });
// @ts-expect-error In a nested object.
toShape({ ...base, nested: { ...inner, extra: 1 } });
// @ts-expect-error In an array element.
toShape({ ...base, list: [{ ...inner, extra: 1 }] });
// @ts-expect-error In a record's value.
toShape({ ...base, record: { k: { ...inner, extra: 1 } } });
// @ts-expect-error In a union's first branch.
toShape({ ...base, either: { ...inner, extra: 1 } });
// @ts-expect-error In a union's second branch.
toShape({ ...base, either: { b: 's', extra: 1 } });
// @ts-expect-error In a discriminated union's first branch.
toShape({ ...base, tagged: { kind: 'x', x: 1, extra: 1 } });
// @ts-expect-error In its second branch.
toShape({ ...base, tagged: { kind: 'y', y: 1, extra: 1 } });
// @ts-expect-error A branch's key under the other branch's discriminant.
toShape({ ...base, tagged: { kind: 'x', x: 1, y: 1 } });

// Brands and primitives are leaves: a branded value passes as it is, and a plain one is no brand.
declare const id: ProjectId;
declare const globs: Globs;
toShape({ ...base, id, globs });
// @ts-expect-error A plain string is not a ProjectId.
toShape({ ...base, id: 'not-checked' });
// @ts-expect-error A plain list is not Globs.
toShape({ ...base, globs: ['**'] });

// A migration must return through exact(): a plain object of the right type does not compile.
// @ts-expect-error Not a Checked<Shape>.
export const unchecked: Migration<Shape, Shape> = s => ({ ...s });
export const checked: Migration<Shape, Shape> = s => exact<Shape>()({ ...s });

// No transforms or defaults: what a file says is what is read.
holds<Equal<z.input<typeof projectFileV1>, z.output<typeof projectFileV1>>>();
holds<Equal<z.input<typeof releaseFileV1>, z.output<typeof releaseFileV1>>>();
holds<Equal<z.input<typeof globsSchema>, z.output<typeof globsSchema>>>();
holds<Equal<z.input<typeof projectIdSchema>, z.output<typeof projectIdSchema>>>();

// A chain whose versions are out of place does not compile.
const v2 = z.strictObject({ version: z.literal(2) });
const v3 = z.strictObject({ version: z.literal(3) });
format('f', [projectFileV1, v2], [() => exact<{ version: 2 }>()({ version: 2 })]);
// @ts-expect-error Version 3 at index 1.
format('f', [projectFileV1, v3], [() => exact<{ version: 3 }>()({ version: 3 })]);
// @ts-expect-error A step missing.
format('f', [projectFileV1, v2], []);
// @ts-expect-error A step whose output is not the next version.
format('f', [projectFileV1, v2], [(v: ProjectFileV1) => exact<ProjectFileV1>()(v)]);
