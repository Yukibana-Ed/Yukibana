import * as z from 'zod';
import { globs } from './utils.js';

export const teacherSchema = z.object({
    hidden: globs
        .default([])
        .describe(
            "Globs of files the student never receives: removed from the starter, and from the starter's copy of this file.\n" +
                "When a teacher assembles a submission they are put back from the teacher's version, like readOnly.\n" +
                'A pattern naming a directory covers everything under it;\n' +
                '    * stays within a path segment,\n' +
                '    ** crosses segments,\n' +
                '    ? is one character.',
        ),
});
export type TeacherSettings = z.infer<typeof teacherSchema>;
