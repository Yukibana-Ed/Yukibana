<script lang="ts">
  import { when } from './format';
  import { viewer } from './viewer.svelte';
  import { ideUrl } from './ide';
  import { followRow } from './row-link';
  import Chip, { type ChipTone } from './Chip.svelte';
  import Empty from './Empty.svelte';
  import { dueIn, PROGRESS_LABEL, progressOf, type Progress, type StudentProjectRow } from './progress';

  /** A student's projects as a table: where they stand with each, when it is
   *  due, and the three ways to get on with it (the IDE, the starter, the
   *  upload form). The IDE opens a project by fetching its starter, so the
   *  IDE link and the download appear together, once a starter has been
   *  released, as on the project's own page; offering the IDE alone once
   *  sent students to a project it could not open. `showCourse` adds the
   *  course, for a list across editions. `empty` is what an empty
   *  list says: a title and a sentence. */
  let { rows, showCourse = false, empty }: { rows: readonly StudentProjectRow[]; showCourse?: boolean; empty: { readonly title: string; readonly text: string } } = $props();

  // The clock the statuses are read against, taken again whenever the rows
  // are, so a page left open (and kept live) moves on to "overdue".
  const now = $derived.by(() => {
    void rows;
    return new Date();
  });
  // Each status's chip; the icon says it as well as the hue does.
  const tone: Record<Progress, ChipTone> = { submitted: 'done', late: 'late', todo: 'open', overdue: 'late', missed: 'plain' };
  const page = (r: StudentProjectRow): string => `/editions/${r.edition_id}/projects/${r.project_id}`;
</script>

{#if rows.length === 0}
  <Empty title={empty.title}>{empty.text}</Empty>
{:else}
  <div class="scroll">
    <table class="yk-table projects tasks">
      <thead>
        <tr><th>Project</th><th>Deadline</th><th>Status</th><th>Work on it</th></tr>
      </thead>
      <tbody>
        {#each rows as r (r.project_id)}
          {@const p = progressOf(r, now)}
          <tr data-href={page(r)} onclick={followRow}>
            <td>
              <a href={page(r)}>{r.title}</a>
              {#if showCourse}<div class="muted small">{r.course_code} · {r.edition_label}</div>{/if}
            </td>
            <td>
              {when(r.deadline, viewer.zone)}
              {#if p === 'todo' || p === 'overdue'}<div class="muted small">{dueIn(r.deadline, now)}</div>{/if}
            </td>
            <td>
              <Chip tone={tone[p]}>{PROGRESS_LABEL[p]}</Chip>
              {#if r.last_submitted_at !== null}<div class="muted small">last {when(r.last_submitted_at, viewer.zone)}{r.submissions > 1 ? ` · ${r.submissions} versions` : ''}</div>{/if}
            </td>
            <td>
              <div class="actions">
                {#if r.starter_ready}
                  <a class="yk-btn yk-btn--secondary" href={ideUrl(r.project_id)}>Open in IDE</a>
                  <a class="yk-btn yk-btn--secondary" href="/api/projects/{r.project_id}/starter">Download</a>
                {/if}
                {#if r.can_submit}<a class="yk-btn yk-btn--secondary" href="{page(r)}#submit">Submit</a>{/if}
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
