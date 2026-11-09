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

<div class="hand-ins-groups">
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
</div>
