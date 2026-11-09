<script lang="ts">
  import { SvelteMap } from 'svelte/reactivity';
  import { kb, when } from '../format';
  import { viewer } from '../viewer.svelte';
  import { search, subtitle, type HandIn, type StudentHandIns } from '../hand-ins';
  import type { ReleaseId, SubmissionId } from '../ids';
  import { assemblyFolder, downloadAssembled, findings } from './assembled';
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
   *  (./assembled). "As sent" is the archive untouched. */
  let { lines, latest, newest, slug }: { lines: readonly StudentHandIns[]; latest: number; newest: ReleaseId | null; slug: string } = $props();

  type Fetching = { readonly state: 'busy' } | { readonly state: 'done'; readonly findings: readonly string[] } | { readonly state: 'failed'; readonly why: string };
  // Each submission's assembly this visit, by id; absent for none yet.
  const assemblies = new SvelteMap<SubmissionId, Fetching>();
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
  <label class="sr-only" for="hand-ins-search">Find a student</label>
  <input id="hand-ins-search" type="search" placeholder="Find a student by name or email" autocomplete="off" bind:value={query} />
  <div class="scroll">
    <table>
      <thead>
        <tr><th>Student</th><th>Status</th><th>Submission</th><th>Built on</th><th>Size</th><th></th></tr>
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
            <td>{#if s !== null}{kb(s.byteSize)}{/if}</td>
            <td>
              {#if s !== null}
                {@const a = assemblies.get(s.submissionId)}
                <div class="actions">
                  {#if newest !== null}
                    <button type="button" class="download" disabled={a?.state === 'busy'} onclick={() => download(l, s)} title="The student's work with the release's read-only and hidden files, ready to grade">
                      {a?.state === 'busy' ? 'Assembling…' : 'Download'}
                    </button>
                    <a class="small muted" href="/api/submissions/{s.submissionId}" download>as sent</a>
                  {:else}
                    <a class="button" href="/api/submissions/{s.submissionId}" download>Download</a>
                  {/if}
                </div>
              {/if}
            </td>
          </tr>
          {#if s !== null}
            {@const a = assemblies.get(s.submissionId)}
            {#if a?.state === 'failed'}
              <tr class="assembly"><td colspan="6"><p class="error">{a.why} “as sent” still downloads the archive untouched.</p></td></tr>
            {:else if a?.state === 'done' && a.findings.length > 0}
              <tr class="assembly">
                <td colspan="6">
                  <ul class="findings">
                    {#each a.findings as f (f)}<li>{f}</li>{/each}
                  </ul>
                </td>
              </tr>
            {/if}
          {/if}
        {:else}
          <tr><td colspan="6" class="muted">Nobody matches “{query}”.</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
