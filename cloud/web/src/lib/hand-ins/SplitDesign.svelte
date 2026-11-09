<script lang="ts">
  import { kb, when } from '../format';
  import { viewer } from '../viewer.svelte';
  import { outdated, subtitle, versionName, type StudentHandIns } from '../hand-ins';
  import type { SubmissionId } from '../ids';
  import BaseNote from './BaseNote.svelte';
  import StandingChip from './StandingChip.svelte';

  /** Design D: students down the left, one student's submissions on the
   *  right, like a mail client. The right shows the newest submission in
   *  full, a dropdown picks an earlier one, and the history underneath
   *  lists them all. For going through a class one student at a time. */
  let { lines, latest }: { lines: readonly StudentHandIns[]; latest: number } = $props();

  let query = $state('');
  let chosen = $state<string | null>(null);
  let pick = $state<SubmissionId | null>(null);
  const visible = $derived(
    lines.filter((l) => {
      const q = query.trim().toLowerCase();
      return q === '' || [l.name, l.githubLogin ?? '', l.email ?? ''].some((v) => v.toLowerCase().includes(q));
    }),
  );
  const current = $derived(lines.find((l) => l.key === chosen) ?? lines[0] ?? null);
  const shown = $derived(current?.submissions.find((s) => s.submissionId === pick) ?? current?.latest ?? null);
  function choose(key: string): void {
    chosen = key;
    pick = null;
  }
</script>

<div class="hand-ins-split">
  <div class="split">
    <aside>
      <label class="sr-only" for="who">Find a student</label>
      <input id="who" type="search" placeholder="Find a student" bind:value={query} />
      <ul>
        {#each visible as l (l.key)}
          <li>
            <button type="button" class="pick" aria-current={l.key === current?.key ? 'true' : undefined} onclick={() => choose(l.key)}>
              <i class="dot {l.standing}" aria-hidden="true"></i>
              <span class="name">{l.name}</span>
              {#if l.latest !== null && outdated(l.latest)}<span class="flag" title="Built on an older starter">⚠</span>{/if}
              {#if l.submissions.length > 1}<span class="n">{l.submissions.length}</span>{/if}
            </button>
          </li>
        {:else}
          <li class="muted small none">Nobody matches.</li>
        {/each}
      </ul>
    </aside>

    <div class="detail">
      {#if current === null}
        <p class="empty">No students.</p>
      {:else}
        <header>
          <div>
            <h3>{current.name}</h3>
            <p class="muted small">{subtitle(current)}</p>
          </div>
          <StandingChip standing={current.standing} />
        </header>

        {#if shown === null}
          <p class="empty">{current.name} has not submitted anything.</p>
        {:else}
          {#if current.submissions.length > 1}
            <label class="version">Submission
              <select value={shown.submissionId} onchange={(e) => (pick = e.currentTarget.value as SubmissionId)}>
                {#each current.submissions as o, i (o.submissionId)}
                  <option value={o.submissionId}>#{current.submissions.length - i} · {when(o.submittedAt, viewer.zone)}{i === 0 ? ' (latest)' : ''}</option>
                {/each}
              </select>
            </label>
          {/if}
          <div class="facts">
            <div><span>Submitted</span><strong>{when(shown.submittedAt, viewer.zone)}</strong></div>
            <div><span>Deadline</span><strong>{#if shown.late}<span class="chip late">late</span>{:else}<span class="chip good">on time</span>{/if}</strong></div>
            <div><span>Starter</span><strong>{shown.base === null ? 'unknown' : versionName(shown.base)}</strong></div>
            <div><span>Size</span><strong>{kb(shown.byteSize)}</strong></div>
          </div>
          {#if outdated(shown)}<p class="old"><BaseNote handIn={shown} {latest} /> This was built on an older version of the starter.</p>{/if}
          <p class="row">
            <a class="button" href="/api/submissions/{shown.submissionId}" download>Download this submission</a>
            <code class="muted small">SHA-256 {shown.sha256.slice(0, 16)}…</code>
          </p>

          {#if current.submissions.length > 1}
            <h4>History</h4>
            <ol class="history">
              {#each current.submissions as o, i (o.submissionId)}
                <li class:on={o.submissionId === shown.submissionId}>
                  <button type="button" class="quiet" onclick={() => (pick = o.submissionId)}>#{current.submissions.length - i}</button>
                  <span>{when(o.submittedAt, viewer.zone)}</span>
                  {#if o.late}<span class="chip late">late</span>{/if}
                  <BaseNote handIn={o} {latest} quiet />
                  <a href="/api/submissions/{o.submissionId}" download>Download</a>
                </li>
              {/each}
            </ol>
          {/if}
        {/if}
      {/if}
    </div>
  </div>
</div>
