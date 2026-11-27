import * as z from 'zod';
import { globs, on } from './utils.js';

const KiB = 1024;
const MiB = 1024 * KiB;

/** The largest submission accepted when the file does not say. A source
 *  tree without build output is well under a megabyte; the cap is for the
 *  student who tars up `target/`. */
export const DEFAULT_MAX_BYTES = 32 * MiB;

/** What `submission.filename` is when the file does not say. */
export const DEFAULT_FILENAME = 'submission.tar.gz';

const projectIdSchema = z.uuidv7('must be a project id, a uuidv7');

const submissionSchema = z
    .object({
        include: globs.nullable().default(null).describe('When present, only paths matching these globs are submitted, and yukibana.json always.'),
        exclude: globs.default([]).describe("Globs never submitted, on top of the history, the IDE's state, node_modules and the kind's build output, which never are."),
        respectGitignore: on.describe("Whether what the project's .gitignore files ignore is left out of a submission too, as git would leave it out of a commit."),
        target: z
            .string()
            .default('cloud')
            .describe('Where the IDE sends a submission: cloud, the registry, or file, an archive the student saves. The CLI always sends to the registry.'),
        filename: z
            .string()
            .refine((name: string) => name !== '' && !/[/\\]/.test(name), 'must be a file name, without a directory')
            .default(DEFAULT_FILENAME)
            .describe('What yukibana pack calls the archive it writes. The bytes are always a gzipped tar, whatever the name says.'),
        maxBytes: z
            .int()
            .positive()
            .default(DEFAULT_MAX_BYTES)
            .describe('The largest submission this project expects, in bytes. The registry has its own cap above which this cannot go.'),
    })
    .describe('What a submission from this folder holds, and where the IDE sends it.');
export type SubmissionSettings = z.infer<typeof submissionSchema>;

export const assignmentSchema = z.object({
    projectId: projectIdSchema
        .nullable()
        .default(null)
        .describe(
            "Written by yukibana build and publish into the starter's copy of this file: the registry project a submission from this folder goes to. A course repository leaves it out.",
        ),
    submission: submissionSchema.prefault({}),
    releaseId: z
        .uuid()
        .nullable()
        .default(null)
        .describe(
            "Written by yukibana build and publish into the starter's copy of this file: the release this starter is, chosen before the upload so the release row has the same id. A submission sends it, so a teacher can tell which release it started from. A course repository leaves it out.",
        ),
});
export type AssignmentSettings = z.infer<typeof assignmentSchema>;
