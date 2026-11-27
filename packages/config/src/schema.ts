import * as z from 'zod';
import { type $ZodType } from 'zod/v4/core';
import { fullStudentSchema, fullTeacherSchema } from './common.js';

/** Where the published JSON Schema of the file lives, as its `$id`: the
 *  registry serves it there, and a `yukibana.json` may name it as `$schema`. */
export const STUDENT_SCHEMA_URL = 'https://cloud.yukibana.dev/schema/yukibana_student.json';
export const TEACHER_SCHEMA_URL = 'https://cloud.yukibana.dev/schema/yukibana_teacher.json';

/** The file's name, at the project root, in the repository and in every
 *  starter. */
export const CONFIG_FILE = 'yukibana.json';

type JSONSchema = Record<string, unknown>;

function getJSONSchema<T extends $ZodType>(schema: T, url: string): JSONSchema {
    const generated = z.toJSONSchema(schema, { io: 'input', target: 'draft-2020-12' }) as JSONSchema;
    return {
        $schema: generated['$schema'],
        $id: url,
        title: CONFIG_FILE,
        description:
            "A project's configuration: its build system, what the student's IDE shows, which files the student may not change, what the student never receives, and what a submission holds. Lives at the project root. docs/cloud/yukibana-json.md in Yukibana-Ed/Yukibana is the prose.",
        ...generated,
    };
}

/** Returns the JSON Schema of the file, generated from `configSchema`, as
 *  `yukibana.schema.json` at the package root holds it (exported as
 *  `@yukibana/client/yukibana.schema.json`) and the registry serves it at
 *  `SCHEMA_URL`. A test fails when the committed file is not this. */
export function getJSONSchemas(): { student: JSONSchema; teacher: JSONSchema } {
    return {
        student: getJSONSchema(fullStudentSchema, STUDENT_SCHEMA_URL),
        teacher: getJSONSchema(fullTeacherSchema, TEACHER_SCHEMA_URL),
    };
}
