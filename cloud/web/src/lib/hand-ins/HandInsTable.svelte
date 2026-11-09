<script lang="ts">
  import { SvelteMap } from 'svelte/reactivity';
  import { when } from '../format';
  import { viewer } from '../viewer.svelte';
  import { search, subtitle, type Base, type HandIn, type StudentHandIns } from '../hand-ins';
  import type { SubmissionId } from '../ids';
  import { downloadAll as saveAll, downloadOne, findings, type ToAssemble } from './assembled';
  import BaseNote from './BaseNote.svelte';
  import StandingChip from './StandingChip.svelte';

  /** The staff's Submissions tab: one table row per student, with a
   *  search box over names, logins and addresses that forgives missing
   *  letters (#lib/hand-ins `search`). A student with several submissions
   *  has a dropdown in their row that picks which one the row shows; it
   *  starts on the newest, the one assessed. `newest` is the project's
   *  newest release (null before the first), `slug` the project's.
   *
   *  Download assembles the submission with the release it started from
   *  (the newest when unknown, as `yukibana download --assemble` does) in
   *  the browser, and says under the row what the assembly undid
   *  (./assembled). The arrow beside it downloads the archive as sent.
   *  Download all does the same for every student's latest submission,
   *  whatever the search shows, into one archive. */
  let { lines, newest, slug }: { lines: readonly StudentHandIns[]; newest: Base | null; slug: string } = $props();

  type Fetching = { readonly state: 'busy' } | { readonly state: 'done'; readonly findings: readonly string[] } | { readonly state: 'failed'; readonly why: string };
  // Each submission's assembly this visit, by id; absent for none yet.
  const assemblies = new SvelteMap<SubmissionId, Fetching>();
  // A submission is assembled with the release it started from, or the
  // newest when it did not say, as `yukibana download --assemble` does.
  const job = (l: StudentHandIns, s: HandIn, n: Base): ToAssemble => ({
    submission: s.submissionId,
    release: s.base?.releaseId ?? n.releaseId,
    submittedAt: s.submittedAt,
    key: l.key,
    name: l.name,
    githubLogin: l.githubLogin,
    email: l.email,
  });
  // Download all: every student's latest submission, the one assessed.
  const everyone = $derived(newest === null ? [] : lines.flatMap((l) => (l.latest === null ? [] : [job(l, l.latest, newest)])));
  type All = { readonly state: 'busy'; readonly done: number } | { readonly state: 'done'; readonly saved: number; readonly failed: readonly string[] };
  let all = $state<All | null>(null);
  async function downloadAll(): Promise<void> {
    all = { state: 'busy', done: 0 };
    for (const it of everyone) assemblies.set(it.submission, { state: 'busy' });
    const outcomes = await saveAll(slug, everyone, (done) => (all = { state: 'busy', done }));
    for (const o of outcomes) assemblies.set(o.submission, o.ok ? { state: 'done', findings: findings(o.report) } : { state: 'failed', why: o.why });
    all = { state: 'done', saved: outcomes.filter((o) => o.ok).length, failed: outcomes.flatMap((o) => (o.ok ? [] : [o.name])) };
  }

  async function download(l: StudentHandIns, s: HandIn, n: Base): Promise<void> {
    assemblies.set(s.submissionId, { state: 'busy' });
    const o = await downloadOne(slug, job(l, s, n));
    assemblies.set(s.submissionId, o.ok ? { state: 'done', findings: findings(o.report) } : { state: 'failed', why: o.why });
  }

  // Which submission each row shows, by the line's key; absent for the newest.
  const picked = new SvelteMap<string, SubmissionId>();
  let query = $state('');
  const found = $derived(search(lines, query));
  const shown = (l: StudentHandIns) => l.submissions.find((s) => s.submissionId === picked.get(l.key)) ?? l.latest;
</script>

<div class="hand-ins">
  <div class="toolbar">
    <label class="sr-only" for="hand-ins-search">Find a student</label>
    <input id="hand-ins-search" type="search" placeholder="Find a student by name or email" autocomplete="off" bind:value={query} />
    {#if everyone.length > 0}
      <button type="button" class="download" disabled={all?.state === 'busy'} onclick={downloadAll} title="Every student's latest submission, assembled with its release, in one archive">
        {all?.state === 'busy' ? `Assembling ${all.done} of ${everyone.length}…` : `Download all (${everyone.length})`}
      </button>
    {/if}
  </div>
  {#if all?.state === 'done'}
    {#if all.saved > 0}
      <p class="ok" role="status">Saved {all.saved} assembled submission{all.saved === 1 ? '' : 's'}{all.failed.length > 0 ? `; left out ${all.failed.join(', ')}, whose rows say why` : ''}.</p>
    {:else}
      <p class="error" role="alert">Nothing could be assembled; each row says why.</p>
    {/if}
  {/if}
  <div class="scroll">
    <table>
      <thead>
        <tr><th>Student</th><th>Status</th><th>Submission</th><th>Built on</th><th></th></tr>
      </thead>
      <tbody>
        {#each found as l (l.key)}
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
            <td>{#if s !== null && newest !== null}<BaseNote handIn={s} {newest} />{:else if s !== null}<span class="muted small">no release</span>{/if}</td>
            <td>
              {#if s !== null}
                {@const busy = assemblies.get(s.submissionId)?.state === 'busy'}
                {@const raw = `/api/submissions/${s.submissionId}`}
                <div class="actions">
                  {#if newest === null}
                    <a class="button" href={raw} download>Download</a>
                  {:else}
                    <div class="split-button">
                      <button type="button" class="download" disabled={busy} onclick={() => download(l, s, newest)} title="With the release's read-only and hidden files, ready to grade">
                        {busy ? 'Assembling…' : 'Download'}
                      </button>
                      <details class="menu">
                        <summary aria-label="More ways to download">▾</summary>
                        <div class="menu-items"><a href={raw} download>Download without assembly</a></div>
                      </details>
                    </div>
                  {/if}
                </div>
              {/if}
            </td>
          </tr>
          {#if s !== null}
            {@const a = assemblies.get(s.submissionId)}
            {#if a?.state === 'failed'}
              <tr class="assembly"><td colspan="5"><p class="error">{a.why}</p></td></tr>
            {:else if a?.state === 'done' && a.findings.length > 0}
              <tr class="assembly">
                <td colspan="5">
                  <ul class="note-strip" aria-label="What the assembly changed">
                    {#each a.findings as f (f)}<li>{f}</li>{/each}
                  </ul>
                </td>
              </tr>
            {/if}
          {/if}
        {:else}
          <tr><td colspan="5" class="muted">Nobody matches “{query}”.</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
