import * as z from 'zod';

export const bool = z.boolean();
export const on = bool.default(true);
export const flags = z.record(z.string(), bool);
export const paths = z.array(z.string());

/** A list of globs relative to the project root. */
export const globs = paths.check(
    z.refine((list: string[]) => list.every(s => s !== ''), 'must be a list of paths'),
    z.refine((list: string[]) => !list.some(s => s.startsWith('/') || s.split('/').includes('..')), 'paths are relative to the project root'),
);
