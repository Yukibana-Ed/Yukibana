import assert from 'node:assert/strict';
import { expect, test } from 'vitest';
import { getJSONSchemas, STUDENT_SCHEMA_URL, TEACHER_SCHEMA_URL } from '../src/schema.js';

test('the published JSON schema is the one the parser checks with, generated from it', async () => {
    // `pnpm --filter @yukibana/config schema` writes the file (vitest --update); anywhere else, and in
    // CI, a committed file that is not exactly this fails.
    const schemas = getJSONSchemas();
    await expect(JSON.stringify(schemas.student, null, 2) + '\n').toMatchFileSnapshot('../yukibana_student.schema.json');
    await expect(JSON.stringify(schemas.teacher, null, 2) + '\n').toMatchFileSnapshot('../yukibana_teacher.schema.json');
});

test('the schema says where it lives and what a file must have', () => {
    const schemas = getJSONSchemas();
    assert.equal(schemas.student['$id'], STUDENT_SCHEMA_URL);
    assert.equal(schemas.teacher['$id'], TEACHER_SCHEMA_URL);
});
