<script lang="ts">
  import { kb, when } from '../format';
  import { viewer } from '../viewer.svelte';
  import { subtitle, type StudentHandIns } from '../hand-ins';
  import BaseNote from './BaseNote.svelte';
  import StandingChip from './StandingChip.svelte';

  /** Design B: a card per student, coloured down its edge by how they
   *  stand. The card shows the newest submission; the earlier ones fold
   *  out underneath it, each with its own download. Easy to scan on a
   *  phone or for a small class. */
  let { lines, latest }: { lines: readonly StudentHandIns[]; latest: number } = $props();
</script>

<div class="hand-ins-cards">
  <ul class="cards">
    {#each lines as l (l.key)}
      <li class="card {l.standing}">
        <div class="top">
          <div>
            <strong>{l.name}</strong>
            <div class="muted small">{subtitle(l)}</div>
          </div>
          <StandingChip standing={l.standing} />
        </div>
        {#if l.latest === null}
          <p class="nothing">Nothing submitted yet.</p>
        {:else}
          {@const s = l.latest}
          <dl>
            <dt>Submitted</dt><dd>{when(s.submittedAt, viewer.zone)}</dd>
            <dt>Size</dt><dd>{kb(s.byteSize)}</dd>
            <dt>Built on</dt><dd><BaseNote handIn={s} {latest} /></dd>
          </dl>
          <a class="button" href="/api/submissions/{s.submissionId}" download>Download latest</a>
          {#if l.submissions.length > 1}
            <details>
              <summary>{l.submissions.length - 1} earlier submission{l.submissions.length === 2 ? '' : 's'}</summary>
              <ol>
                {#each l.submissions.slice(1) as o, i (o.submissionId)}
                  <li>
                    <span class="n">#{l.submissions.length - 1 - i}</span>
                    <span>{when(o.submittedAt, viewer.zone)}{#if o.late} <span class="chip late">late</span>{/if}</span>
                    <BaseNote handIn={o} {latest} quiet />
                    <span class="muted small">{kb(o.byteSize)}</span>
                    <a href="/api/submissions/{o.submissionId}" download>Download</a>
                  </li>
                {/each}
              </ol>
            </details>
          {/if}
        {/if}
      </li>
    {/each}
  </ul>
</div>
