<script lang="ts">
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import { when } from '../format';
  import { viewer } from '../viewer.svelte';
  import { search, subtitle, type HandIn, type StudentHandIns, type Variant } from '../hand-ins';
  import type { ReleaseId, SubmissionId } from '../ids';
  import { assemblyFolder, downloadAllAssembled, downloadAssembled, findings, type ToAssemble } from './assembled';
  import BaseNote from './BaseNote.svelte';
  import StandingChip from './StandingChip.svelte';

  /** The staff's Submissions tab: one table row per student, with a
   *  search box over names, logins and addresses that forgives missing
   *  letters (#lib/hand-ins `search`). A student with several submissions
   *  has a dropdown in their row that picks which one the row shows; it
   *  starts on the newest, the one assessed. `latest` is the newest
   *  release's version, `newest` its id (null before the first release),
   *  `slug` the project's.
   *
   *  Download assembles the submission with the release it started from
   *  (the newest when unknown, as `yukibana download --assemble` does) in
   *  the browser, and says under the row what the assembly undid
   *  (./assembled). "As sent" is the archive untouched. Download all does
   *  the same for every student's latest submission, whatever the search
   *  shows, into one archive.
   *
   *  `ui` is one of four drafts of where the plain download and the
   *  assembly's findings go (`VARIANTS`), while one is chosen. */
  let { lines, latest, newest, slug, ui }: { lines: readonly StudentHandIns[]; latest: number; newest: ReleaseId | null; slug: string; ui: Variant } = $props();
  // Which rows have their findings open, in the variant that folds them.
  const open = new SvelteSet<SubmissionId>();
  const toggle = (id: SubmissionId) => (open.has(id) ? open.delete(id) : open.add(id));

  type Fetching = { readonly state: 'busy' } | { readonly state: 'done'; readonly findings: readonly string[] } | { readonly state: 'failed'; readonly why: string };
  // Each submission's assembly this visit, by id; absent for none yet.
  const assemblies = new SvelteMap<SubmissionId, Fetching>();
  // Download all: every student's latest submission, the one assessed.
  const everyone = $derived(
    lines.flatMap((l): ToAssemble[] => {
      const s = l.latest;
      const release = s?.base?.releaseId ?? newest;
      if (s === null || release === null) return [];
      return [{ submission: s.submissionId, release, key: l.key, name: l.name, githubLogin: l.githubLogin, email: l.email, submittedAt: s.submittedAt, late: s.late }];
    }),
  );
  type All = { readonly state: 'busy'; readonly done: number } | { readonly state: 'done'; readonly saved: number; readonly failed: readonly string[] };
  let all = $state<All | null>(null);
  async function downloadAll(): Promise<void> {
    all = { state: 'busy', done: 0 };
    for (const it of everyone) assemblies.set(it.submission, { state: 'busy' });
    const outcomes = await downloadAllAssembled(slug, everyone, (done) => (all = { state: 'busy', done }));
    const saved = outcomes.some((o) => o.ok);
    for (const o of outcomes) {
      if (o.ok) assemblies.set(o.submission, { state: 'done', findings: findings(o.report) });
      else assemblies.set(o.submission, { state: 'failed', why: o.why });
    }
    all = { state: 'done', saved: saved ? outcomes.filter((o) => o.ok).length : 0, failed: outcomes.flatMap((o) => (o.ok ? [] : [o.name])) };
  }

  async function download(l: StudentHandIns, s: HandIn): Promise<void> {
    const release = s.base?.releaseId ?? newest;
    if (release === null) return;
    assemblies.set(s.submissionId, { state: 'busy' });
    try {
      const report = await downloadAssembled(s.submissionId, release, assemblyFolder(slug, l.githubLogin, s.submittedAt));
      assemblies.set(s.submissionId, { state: 'done', findings: findings(report) });
    } catch (e) {
      assemblies.set(s.submissionId, { state: 'failed', why: e instanceof Error ? e.message : String(e) });
    }
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
            <td>{#if s !== null}<BaseNote handIn={s} {latest} />{/if}</td>
            <td>
              {#if s !== null}
                {@const a = assemblies.get(s.submissionId)}
                {@const busy = a?.state === 'busy'}
                {@const raw = `/api/submissions/${s.submissionId}`}
                {#if newest === null}
                  <div class="actions"><a class="button" href={raw} download>Download</a></div>
                {:else if ui === 'split'}
                  <div class="actions">
                    <div class="split-button">
                      <button type="button" class="download" disabled={busy} onclick={() => download(l, s)}>{busy ? 'Assembling…' : 'Download'}</button>
                      <details class="menu">
                        <summary aria-label="More ways to download">▾</summary>
                        <div class="menu-items"><a href={raw} download>Download without assembly</a></div>
                      </details>
                    </div>
                  </div>
                {:else if ui === 'kebab'}
                  <div class="actions">
                    <button type="button" class="download" disabled={busy} onclick={() => download(l, s)}>{busy ? 'Assembling…' : 'Download'}</button>
                    <details class="menu">
                      <summary class="kebab" aria-label="More ways to download">⋯</summary>
                      <div class="menu-items"><a href={raw} download>Download without assembly</a></div>
                    </details>
                  </div>
                {:else if ui === 'stacked'}
                  <div class="stacked">
                    <div class="actions">
                      {#if a?.state === 'done' && a.findings.length > 0}
                        <details class="popover">
                          <summary class="badge" title="What the assembly changed">⚠ {a.findings.length}</summary>
                          <div class="popover-body"><ul>{#each a.findings as f (f)}<li>{f}</li>{/each}</ul></div>
                        </details>
                      {:else if a?.state === 'failed'}
                        <details class="popover">
                          <summary class="badge bad" title="Why it failed">✕</summary>
                          <div class="popover-body"><p>{a.why}</p></div>
                        </details>
                      {/if}
                      <button type="button" class="download" disabled={busy} onclick={() => download(l, s)}>{busy ? 'Assembling…' : 'Download'}</button>
                    </div>
                    <a class="small muted" href={raw} download>without assembly</a>
                  </div>
                {:else}
                  <div class="segmented" role="group" aria-label="Download">
                    <button type="button" disabled={busy} onclick={() => download(l, s)} title="With the release's read-only and hidden files, ready to grade">{busy ? 'Assembling…' : 'Assembled'}</button>
                    <a href={raw} download title="The archive exactly as the student sent it">Raw</a>
                  </div>
                {/if}
              {/if}
            </td>
          </tr>
          {#if s !== null && ui !== 'stacked'}
            {@const a = assemblies.get(s.submissionId)}
            {#if a?.state === 'failed'}
              <tr class="assembly"><td colspan="5"><p class="error">{a.why} Downloading without assembly still works.</p></td></tr>
            {:else if a?.state === 'done' && a.findings.length > 0}
              {#if ui === 'split'}
                <tr class="assembly">
                  <td colspan="5">
                    <div class="note-strip">
                      <strong>The assembly changed {a.findings.length === 1 ? 'one thing' : `${a.findings.length} things`}</strong>
                      <ul>{#each a.findings as f (f)}<li>{f}</li>{/each}</ul>
                    </div>
                  </td>
                </tr>
              {:else if ui === 'kebab'}
                <tr class="assembly">
                  <td colspan="5">
                    <ul class="plain-findings">{#each a.findings as f (f)}<li>{f}</li>{/each}</ul>
                  </td>
                </tr>
              {:else}
                <tr class="assembly">
                  <td colspan="5">
                    <button type="button" class="chip warn toggle" aria-expanded={open.has(s.submissionId)} onclick={() => toggle(s.submissionId)}>
                      ⚠ The assembly changed {a.findings.length === 1 ? 'one thing' : `${a.findings.length} things`} {open.has(s.submissionId) ? '▴' : '▾'}
                    </button>
                    {#if open.has(s.submissionId)}<ul class="findings">{#each a.findings as f (f)}<li>{f}</li>{/each}</ul>{/if}
                  </td>
                </tr>
              {/if}
            {/if}
          {/if}
        {:else}
          <tr><td colspan="5" class="muted">Nobody matches “{query}”.</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
