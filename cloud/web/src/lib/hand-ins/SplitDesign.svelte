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

<style>
  .split {
    display: grid;
    grid-template-columns: minmax(13rem, 17rem) 1fr;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    overflow: hidden;
    min-height: 26rem;
  }
  aside {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.6rem;
    background: var(--sunken);
    border-inline-end: 1px solid var(--line);
  }
  aside ul {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    max-height: 32rem;
  }
  button.pick {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    padding: 0.45rem 0.55rem;
    background: transparent;
    color: var(--ink);
    font-weight: 500;
    text-align: start;
  }
  button.pick:hover {
    background: var(--surface);
  }
  button.pick[aria-current='true'] {
    background: var(--surface);
    border-color: var(--line);
    box-shadow: var(--shadow);
  }
  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    flex: none;
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: color-mix(in oklab, var(--ink-soft) 40%, transparent);
  }
  .dot.late {
    background: var(--bad);
  }
  .dot.on-time {
    background: var(--ok);
  }
  .flag {
    color: light-dark(#8a5300, #ffc66b);
  }
  .n {
    font-size: 0.75rem;
    color: var(--ink-soft);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0 0.4rem;
  }
  .none {
    padding: 0.5rem;
  }
  .detail {
    padding: 1rem 1.2rem;
    display: grid;
    gap: 0.9rem;
    align-content: start;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: start;
  }
  h3 {
    margin: 0;
  }
  header p {
    margin: 0.15rem 0 0;
  }
  .version {
    display: grid;
    gap: 0.25rem;
    max-width: 22rem;
    font-size: 0.85rem;
    color: var(--ink-soft);
  }
  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
    gap: 0.6rem;
  }
  .facts div {
    display: grid;
    gap: 0.2rem;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }
  .facts span {
    font-size: 0.78rem;
    color: var(--ink-soft);
  }
  .old {
    margin: 0;
    font-size: 0.9rem;
  }
  h4 {
    margin: 0.4rem 0 0;
    font-size: 0.9rem;
  }
  .history {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    font-size: 0.88rem;
  }
  .history li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem 0.7rem;
    padding: 0.35rem 0.4rem;
    border-top: 1px solid var(--line);
  }
  .history li.on {
    background: var(--accent-bg);
  }
  @media (max-width: 44rem) {
    .split {
      grid-template-columns: 1fr;
    }
    aside {
      border-inline-end: 0;
      border-bottom: 1px solid var(--line);
    }
    aside ul {
      max-height: 12rem;
    }
  }
</style>
