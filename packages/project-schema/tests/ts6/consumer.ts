// Compiled by TypeScript 6 (scripts/ts6.ts), not by the package's own tsc: it imports the built declarations, as
// cloud/web does, and uses each of the package's conditional types once.
import { exact, parseProjectFile, NO_PROJECT_FILE, type Migration, type ProjectFile, type ProjectFileV1 } from '@yukibana/project-schema';

const same: Migration<ProjectFileV1, ProjectFile> = v1 => exact<ProjectFile>()({ ...v1 });
const read = parseProjectFile('{}');
export const kind: string = read.ok ? read.file.kind : same(NO_PROJECT_FILE).kind;
