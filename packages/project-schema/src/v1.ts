/** `yukibana.json` version 1: the contract between a course repository and Yukibana, at the project root. The
 *  student's IDE reads it for which widgets show, which files open and which are read-only; the CLI reads it for the
 *  build system, what a student must never receive and what a submission holds.
 *
 *  Frozen once released (`released.json`): from then on this file only gains comments, and a change in what the file
 *  means is version 2, with a migration from this one. Every field is required and no other is allowed, so a file
 *  says everything it means and a misspelt `"hiden"` is refused instead of shipping the hidden tests. `yukibana
 *  config init` (to come) writes a complete one. There are no defaults and no transforms: what a file says is what
 *  the program reads, and the schema's input type is its output type. */

import * as z from 'zod';
import { globsSchema } from './brands.js';

/** Where version 1's JSON Schema is served, and so what a version 1 file's `$schema` is, exactly. Served by the
 *  website (yukibana.dev), whose build copies the files of `schemas/` from this package; a released version's file
 *  never changes. */
export const SCHEMA_URL_V1 = 'https://yukibana.dev/schema/yukibana/v1.json';

/** Every project kind version 1 knows: the build system a project uses, which decides its build output and the
 *  manifest checks of a build. A new kind changes what files mean, so it is a new version. */
export const KINDS_V1 = ['rust-cargo', 'scala-sbt'] as const;

const flag = (text: string) => z.boolean().describe(text);
const flags = (text: string) => z.record(z.string(), z.boolean()).describe(text);

/** Version 1 of `yukibana.json`, strict at every depth. */
export const projectFileV1 = z
    .strictObject({
        $schema: z
            .literal(SCHEMA_URL_V1)
            .describe(`The URL of this schema, ${SCHEMA_URL_V1}, for an editor to check the file with. Names the version too, so it must match version.`),
        version: z.literal(1).describe('The shape of this file: 1. A file in a newer shape needs a newer IDE and CLI, which say so.'),
        kind: z.enum(KINDS_V1).describe('The build system. Chooses the build output no archive carries and the manifest checks the build makes.'),
        hidden: globsSchema.describe(
            "Globs of files the student never receives: removed from the starter, and from the starter's copy of this file. When a teacher assembles a submission they are put back from the teacher's version, like readOnly. A pattern naming a directory covers everything under it; * stays within a path segment, ** crosses segments, ? is one character. [] hides nothing.",
        ),
        assignmentFile: z.string().check(z.minLength(1)).describe('The file the IDE opens as the assignment, relative to the project root.'),
        features: z
            .strictObject({
                codeSuggestions: flag('Code completion in the editor.'),
                squiggles: flag('Error and warning underlines in the editor.'),
                codeLenses: flag('Inline actions in the editor.'),
                ai: flag("The IDE's AI features."),
            })
            .describe("Which of the IDE's helpers are on."),
        layout: z
            .strictObject({
                widgets: z
                    .strictObject({
                        files: flag('The file explorer.'),
                        search: flag('The search view.'),
                        vcs: flag('The source control view.'),
                        debug: flag('The debug view.'),
                        testing: flag('The test view.'),
                        outline: flag('The outline view.'),
                        aiChat: flag('The AI chat view.'),
                    })
                    .describe("Which of the IDE's own views show."),
                containers: flags('View containers by id, shown if true and hidden if false; one not named is left as it is. {} leaves them all.'),
                views: flags('Views by id, shown if true and hidden if false; one not named is left as it is. {} leaves them all.'),
            })
            .describe("How the IDE lays out the project's window."),
        openFiles: z.array(z.string()).describe('Files the IDE opens when the project opens, relative to the project root. Paths, not globs.'),
        readOnly: globsSchema.describe(
            "Globs of files the student receives but may not change. When a teacher assembles a submission, whatever the student sent under these paths is replaced by the teacher's version, and every change is reported. [] protects nothing.",
        ),
        submission: z
            .strictObject({
                include: globsSchema.describe('Only paths matching one of these globs are submitted, and yukibana.json always. ["**"] submits everything the other rules allow.'),
                exclude: globsSchema.describe("Globs never submitted, on top of the history, the IDE's state, node_modules and the kind's build output, which never are."),
                respectGitignore: z
                    .boolean()
                    .describe("Whether what the project's .gitignore files ignore is left out of a submission too, as git would leave it out of a commit."),
                target: z
                    .enum(['cloud', 'file'])
                    .describe('Where the IDE sends a submission: cloud, the registry, or file, an archive the student saves. The CLI always sends to the registry.'),
                filename: z
                    .string()
                    .check(z.refine((name: string) => name !== '' && !/[/\\]/.test(name), 'must be a file name, without a directory'))
                    .describe('What yukibana pack calls the archive it writes. The bytes are always a gzipped tar, whatever the name says.'),
                maxBytes: z
                    .number()
                    .check(z.int(), z.positive())
                    .describe('The largest submission this project expects, in bytes. The registry has its own cap above which this cannot go.'),
            })
            .describe('What a submission from this folder holds, and where the IDE sends it.'),
        telemetry: z
            .strictObject({
                liveTypingStats: flag('Whether to send live stats about what the student is typing in the IDE.'),
            })
            .describe('What telemetry the IDE sends.'),
    })
    .describe(
        "A project's configuration: its build system, what the student's IDE shows, which files the student may not change, what the student never receives, and what a submission holds. Lives at the project root as yukibana.json. Every field is required.",
    );

/** A `yukibana.json` at version 1, as parsed. */
export type ProjectFileV1 = z.output<typeof projectFileV1>;
