<script lang="ts">
  import { kb, when } from '../format';
  import { viewer } from '../viewer.svelte';
  import { outdated, subtitle, tally, type StudentHandIns } from '../hand-ins';
  import BaseNote from './BaseNote.svelte';

  /** Design C: the class at a glance, then the students grouped by how
   *  they stand (not submitted, late, on time), each group folding open.
   *  A student's line opens into a timeline of every submission they made.
   *  For the teacher who wants to know who to chase before who to grade. */
  let { lines, latest }: { lines: readonly StudentHandIns[]; latest: number } = $props();

  const t = $derived(tally(lines));
  const total = $derived(Math.max(1, lines.length));
  const groups = $derived(
    (
      [
        ['missing', 'Not submitted'],
        ['late', 'Late'],
        ['on-time', 'On time'],
      ] as const
    ).map(([standing, label]) => ({ standing, label, lines: lines.filter((l) => l.standing === standing) })),
  );
  const pct = (n: number) => `${(100 * n) / total}%`;
</script>

<div class="summary">
  <div class="bar" role="img" aria-label="{t['on-time']} on time, {t.late} late, {t.missing} not submitted">
    <span class="on-time" style:width={pct(t['on-time'])}></span>
    <span class="late" style:width={pct(t.late)}></span>
    <span class="missing" style:width={pct(t.missing)}></span>
  </div>
  <p class="legend">
    <span><i class="on-time"></i>{t['on-time']} on time</span>
    <span><i class="late"></i>{t.late} late</span>
    <span><i class="missing"></i>{t.missing} not submitted</span>
    {#if t.outdated > 0}<span class="warn">⚠ {t.outdated} on an older starter</span>{/if}
    <span class="muted">of {lines.length} students</span>
  </p>
</div>

{#each groups as g (g.standing)}
  {#if g.lines.length > 0}
    <details class="group {g.standing}" open={g.standing !== 'on-time' || g.lines.length <= 12}>
      <summary><h3>{g.label}</h3><span class="count">{g.lines.length}</span></summary>
      <ul>
        {#each g.lines as l (l.key)}
          <li>
            {#if l.latest === null}
              <div class="line">
                <span class="who"><strong>{l.name}</strong> <span class="muted small">{subtitle(l)}</span></span>
              </div>
            {:else}
              {@const s = l.latest}
              <details class="student">
                <summary class="line">
                  <span class="who"><strong>{l.name}</strong> <span class="muted small">{subtitle(l)}</span></span>
                  <span class="when">{when(s.submittedAt, viewer.zone)}</span>
                  <span class="base"><BaseNote handIn={s} {latest} quiet /></span>
                  <span class="many small">{l.submissions.length > 1 ? `${l.submissions.length} submissions ▾` : ''}</span>
                  <a class="button" href="/api/submissions/{s.submissionId}" download onclick={(e) => e.stopPropagation()}>Download</a>
                </summary>
                <ol class="timeline">
                  {#each l.submissions as o, i (o.submissionId)}
                    <li class:latest={i === 0} class:late={o.late} class:old={outdated(o)}>
                      <span>{when(o.submittedAt, viewer.zone)}</span>
                      <span class="muted small">{i === 0 ? 'latest · ' : ''}{o.late ? 'late' : 'on time'} · {kb(o.byteSize)} · <code>{o.sha256.slice(0, 10)}</code></span>
                      <BaseNote handIn={o} {latest} />
                      <a href="/api/submissions/{o.submissionId}" download>Download</a>
                    </li>
                  {/each}
                </ol>
              </details>
            {/if}
          </li>
        {/each}
      </ul>
    </details>
  {/if}
{/each}
<p class="note">Each student is counted by their latest submission, the one assessed: late if it came after the deadline.</p>

<style>
  .summary {
    display: grid;
    gap: 0.5rem;
    margin-bottom: 1.2rem;
  }
  .bar {
    display: flex;
    height: 0.7rem;
    border-radius: 999px;
    overflow: hidden;
    background: var(--sunken);
  }
  .bar span {
    display: block;
  }
  :is(.bar span, .legend i).on-time {
    background: var(--ok);
  }
  :is(.bar span, .legend i).late {
    background: var(--bad);
  }
  :is(.bar span, .legend i).missing {
    background: color-mix(in oklab, var(--ink-soft) 35%, transparent);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 1.1rem;
    margin: 0;
    font-size: 0.88rem;
  }
  .legend i {
    display: inline-block;
    width: 0.65rem;
    height: 0.65rem;
    border-radius: 50%;
    margin-inline-end: 0.35rem;
    vertical-align: baseline;
  }
  .warn {
    color: light-dark(#8a5300, #ffc66b);
  }
  .group {
    margin-top: 0.6rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .group > summary {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.6rem 0.9rem;
    cursor: pointer;
    background: var(--sunken);
    list-style: none;
  }
  .group > summary h3 {
    margin: 0;
    font-size: 0.95rem;
  }
  .group.late > summary h3 {
    color: var(--bad);
  }
  .group.on-time > summary h3 {
    color: var(--ok);
  }
  .count {
    padding: 0 0.45rem;
    border-radius: 999px;
    background: var(--surface);
    border: 1px solid var(--line);
    font-size: 0.78rem;
    font-weight: 600;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  ul > li + li {
    border-top: 1px solid var(--line);
  }
  .line {
    display: grid;
    grid-template-columns: minmax(10rem, 1.4fr) minmax(9rem, 1fr) minmax(8rem, 1.2fr) 7.5rem auto;
    gap: 0.4rem 0.8rem;
    align-items: center;
    padding: 0.55rem 0.9rem;
    font-size: 0.92rem;
  }
  summary.line {
    cursor: pointer;
    list-style: none;
  }
  summary.line::-webkit-details-marker,
  .group > summary::-webkit-details-marker {
    display: none;
  }
  summary.line:hover {
    background: color-mix(in oklab, var(--sunken) 60%, transparent);
  }
  .many {
    color: var(--accent);
  }
  .timeline {
    list-style: none;
    margin: 0 0.9rem 0.8rem 1.6rem;
    padding: 0 0 0 1rem;
    border-inline-start: 2px solid var(--line);
    display: grid;
    gap: 0.5rem;
    font-size: 0.88rem;
  }
  .timeline li {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem 0.7rem;
    align-items: center;
  }
  .timeline li::before {
    content: '';
    position: absolute;
    inset-inline-start: calc(-1rem - 6px);
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--ok);
  }
  .timeline li.late::before {
    background: var(--bad);
  }
  .timeline li.latest {
    font-weight: 600;
  }
  @media (max-width: 48rem) {
    .line {
      grid-template-columns: 1fr auto;
    }
    .line .when,
    .line .base,
    .line .many {
      grid-column: 1;
    }
  }
</style>
