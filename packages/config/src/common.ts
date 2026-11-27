import * as z from 'zod';
import { assignmentSchema } from './assignment.js';
import { ideSchema } from './ide.js';
import { teacherSchema } from './teacher.js';

export const SCHEMA_VERSION = 1;

/** Every project kind this version knows: the build system a project uses, which decides its build output. */
export const KINDS = ['rust-cargo', 'scala-sbt'] as const;

/** A project kind, one of `KINDS`. */
export type Kind = (typeof KINDS)[number];

const baseConfigSchema = z.object({
    $schema: z.string().optional().describe('The URL of this schema, for an editor to check the file with. The IDE and the CLI ignore it.'),
    version: z.literal(SCHEMA_VERSION),
});

export const fullStudentSchema = z.object({
    ...baseConfigSchema.shape,
    ...ideSchema.shape,
    ...assignmentSchema.shape,
});
export type StudentConfig = z.infer<typeof fullStudentSchema>;

export const fullTeacherSchema = z.object({
    ...baseConfigSchema.shape,
    ...ideSchema.shape,
    ...assignmentSchema.shape,
    ...teacherSchema.shape,
});
export type TeacherConfig = z.infer<typeof fullTeacherSchema>;
