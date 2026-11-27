import * as z from 'zod';
import { bool, flags, globs, on, paths } from './utils.js';

const featuresSchema = z
    .object({
        codeSuggestions: on.describe('Code completion in the editor.'),
        squiggles: on.describe('Error and warning underlines in the editor.'),
        codeLenses: on.describe('Inline actions in the editor.'),
        ai: on.describe("The IDE's AI features."),
    })
    .describe("Which of the IDE's helpers are on; each is on unless set false.");
export type Features = z.infer<typeof featuresSchema>;

const widgetsSchema = z
    .object({ files: on, search: on, vcs: on, debug: on, testing: on, outline: on, aiChat: on })
    .describe("Which of the IDE's views show; each shows unless set false.");
export type Widgets = z.infer<typeof widgetsSchema>;

const layoutSchema = z
    .object({
        widgets: widgetsSchema.prefault({}),
        containers: flags.default({}).describe('View containers by id, shown if true and hidden if false; one not named is left as it is.'),
        views: flags.default({}).describe('Views by id, shown if true and hidden if false; one not named is left as it is.'),
    })
    .describe("How the IDE lays out the project's window.");
export type Layout = z.infer<typeof layoutSchema>;

const telemetrySchema = z
    .object({
        liveTypingStats: bool.default(false).describe('Whether to send live stats about what the user is typing in the IDE.'),
    })
    .describe('What kind of telemetry should be sent.');
export type Telemetry = z.infer<typeof telemetrySchema>;

export const ideSchema = z.object({
    assignmentFile: z.string().default('ASSIGNMENT.md').describe('The file the IDE opens as the assignment, relative to the project root.'),
    features: featuresSchema.prefault({}),
    layout: layoutSchema.prefault({}),
    openFiles: paths.default([]).describe('Files the IDE opens when the project opens, relative to the project root.'),
    readOnly: globs
        .default([])
        .describe(
            "Globs of files the student receives but may not change. When a teacher assembles a submission, whatever the student sent under these paths is replaced by the teacher's version, and every change is reported.",
        ),
    telemetry: telemetrySchema.prefault({}),
});
export type IDESettings = z.infer<typeof ideSchema>;
