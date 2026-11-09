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

<style>
  .cards {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
    gap: 0.9rem;
  }
  .card {
    display: grid;
    gap: 0.7rem;
    align-content: start;
    padding: 0.95rem 1rem;
    border: 1px solid var(--line);
    border-inline-start: 4px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }
  .card.late {
    border-inline-start-color: var(--bad);
  }
  .card.on-time {
    border-inline-start-color: var(--ok);
  }
  .card.missing {
    background: var(--sunken);
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: start;
    gap: 0.5rem;
  }
  .nothing {
    margin: 0;
    color: var(--ink-soft);
    font-size: 0.9rem;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.25rem 0.8rem;
    margin: 0;
    font-size: 0.9rem;
  }
  dt {
    color: var(--ink-soft);
  }
  dd {
    margin: 0;
  }
  .button {
    justify-self: start;
  }
  details summary {
    cursor: pointer;
    color: var(--accent);
    font-size: 0.88rem;
  }
  ol {
    list-style: none;
    margin: 0.5rem 0 0;
    padding: 0;
    display: grid;
    gap: 0.4rem;
    font-size: 0.86rem;
  }
  ol li {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem 0.6rem;
    align-items: center;
    padding-top: 0.4rem;
    border-top: 1px solid var(--line);
  }
  .n {
    color: var(--ink-soft);
    font-weight: 600;
  }
</style>
