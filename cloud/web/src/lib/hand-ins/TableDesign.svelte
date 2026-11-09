<script lang="ts">
  import { SvelteMap } from 'svelte/reactivity';
  import { kb, when } from '../format';
  import { viewer } from '../viewer.svelte';
  import { subtitle, type StudentHandIns } from '../hand-ins';
  import type { SubmissionId } from '../ids';
  import BaseNote from './BaseNote.svelte';
  import StandingChip from './StandingChip.svelte';

  /** Design A: one table row per student. A student with several
   *  submissions has a dropdown in their row that picks which one the row
   *  shows; it starts on the newest. Dense, and closest to the page as it
   *  was. */
  let { lines, latest }: { lines: readonly StudentHandIns[]; latest: number } = $props();

  // Which submission each row shows, by the line's key; absent for the newest.
  const picked = new SvelteMap<string, SubmissionId>();
  const shown = (l: StudentHandIns) => l.submissions.find((s) => s.submissionId === picked.get(l.key)) ?? l.latest;
</script>

<div class="hand-ins-table">
  <div class="scroll">
    <table>
      <thead>
        <tr><th>Student</th><th>Status</th><th>Submission</th><th>Built on</th><th>Size</th><th></th></tr>
      </thead>
      <tbody>
        {#each lines as l (l.key)}
          {@const s = shown(l)}
          <tr class:missing={s === null}>
            <td>
              <strong>{l.name}</strong>
              <div class="muted small">{subtitle(l)}</div>
            </td>
            <td><StandingChip standing={l.standing} /></td>
            <td>
              {#if s === null}
                <span class="muted">—</span>
              {:else if l.submissions.length > 1}
                <label class="sr-only" for="pick-{l.key}">Submission of {l.name}</label>
                <select id="pick-{l.key}" value={s.submissionId} onchange={(e) => picked.set(l.key, e.currentTarget.value as SubmissionId)}>
                  {#each l.submissions as o, i (o.submissionId)}
                    <option value={o.submissionId}>#{l.submissions.length - i} · {when(o.submittedAt, viewer.zone)}{o.late ? ' · late' : ''}{i === 0 ? ' (latest)' : ''}</option>
                  {/each}
                </select>
              {:else}
                {when(s.submittedAt, viewer.zone)}
              {/if}
              {#if s !== null && s !== l.latest && s.late}<span class="chip late">late</span>{/if}
            </td>
            <td>{#if s !== null}<BaseNote handIn={s} {latest} />{/if}</td>
            <td>{#if s !== null}{kb(s.byteSize)}{/if}</td>
            <td>
              {#if s !== null}<a class="button" href="/api/submissions/{s.submissionId}" download>Download</a>{/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
