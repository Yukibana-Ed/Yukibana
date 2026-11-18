<script lang="ts">
  import { page } from '$app/state';
  import Tabs from '#lib/Tabs.svelte';
  import Chip from '#lib/Chip.svelte';
  import Confirm from '#lib/Confirm.svelte';
  import Empty from '#lib/Empty.svelte';
  import CopyButton from '#lib/CopyButton.svelte';
  import { kb, when } from '#lib/format.ts';
  import { viewer } from '#lib/viewer.svelte.ts';
  import { local } from '#lib/wall-time.ts';
  import { ideUrl } from '#lib/ide.ts';
  import { useTemplateUrl } from '#lib/templates.ts';
  import { hold, live, refresh } from '#lib/live.svelte.ts';
  import { actionIn, tabOf, type Tab } from '#lib/tabs.ts';
  import { handInsOf } from '#lib/hand-ins.ts';
  import HandInsTable from '#lib/hand-ins/HandInsTable.svelte';
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  const p = $derived(data.project);
  // Without a starter there is nothing to start from, so nothing to submit:
  // the page leaves submissions out until one is released. Submissions that
  // exist anyway (sent through the API before any release) stay visible.
  const submissions = $derived(p.ready || data.submissions.length > 0);
  const tabs = $derived<Tab[]>(data.staff
    ? [
        { id: 'overview', label: 'Overview' },
        ...(submissions ? [{ id: 'submissions', label: 'Submissions', count: data.submissions.length }] : []),
        // Releases and every way of publishing one, tokens among them: a token is one way to publish, not a place of its own.
        { id: 'releases', label: 'Releases', count: data.releases.length },
        ...(data.project.can_edit ? [{ id: 'settings', label: 'Settings' }] : []),
      ]
    : [
        { id: 'overview', label: 'Overview' },
        ...(submissions ? [{ id: 'submissions', label: 'My submissions', count: data.submissions.length }] : []),
      ]);
  const tab = $derived(tabOf(page.url, tabs));
  const times = $derived([
    ['available_after', 'Opens', p.available_after],
    ['deadline', 'Deadline', p.deadline],
    ['closes_at', 'Closes', p.closes_at],
  ] as const);
  const pastDeadline = $derived(p.deadline !== null && new Date(p.deadline).getTime() <= Date.now());
  const students = $derived(new Set(data.submissions.map((s) => s.authorId)).size);
  const late = $derived(data.submissions.filter((s) => s.late).length);
  // Staff see one line per student, including those who sent nothing.
  const lines = $derived(handInsOf(data.students, data.submissions));

  // The settings form follows the project live until somebody types in it.
  // From then on changes from others are held back, so the form is never
  // rewritten under the cursor, and the page says that it is out of date;
  // saving replaces their change, discarding loads it.
  let editing = $state(false);
  // Tabs are links within one page, so the page survives switching tabs but
  // the form does not: edits left behind on another tab are gone, and must
  // not go on holding the page back.
  $effect(() => {
    if (tab !== 'settings') editing = false;
  });
  $effect(() => (editing ? hold() : undefined));
  // Saving is a plain form post: the page stays on screen until the answer
  // arrives, and the save's own broadcast usually arrives first. It is news
  // about our change, not somebody else's, so while a save is on its way the
  // page does not say it is out of date. It used to, and every save flashed
  // the warning before "Saved.".
  let saving = $state(false);
  // The Save button says it worked, for two seconds, instead of a line above the form.
  let saved = $state(false);
  $effect(() => {
    if (form?.ok !== true) return;
    saved = true;
    const shown = setTimeout(() => (saved = false), 2000);
    return () => clearTimeout(shown);
  });
  function discard(): void {
    editing = false;
    refresh();
  }

  // The Repository section (Releases tab), present only where the GitHub App is configured.
  const gh = $derived(data.github);
  // Whether to show the picker: an owner whose project has no link, or who asked to change it.
  const choosing = $derived(gh !== null && data.owner && (gh.link === null || gh.relink));
  // The command that publishes this project from a checkout.
  const cli = $derived(`yukibana publish --project ${p.project_id}`);
  // Tokens that still publish, counted on the closed token disclosure so an owner sees they exist without opening it.
  const activeTokens = $derived(data.tokens.filter((t) => t.revoked_at === null).length);
  // The workflow a linked repository needs, to paste into .github/workflows/. Built here rather than written in the
  // markup, where its `${{ }}` would be read as Svelte.
  const workflow = $derived(`name: Publish to Yukibana
on:
  push:
    tags: ['*']
permissions:
  contents: read
  id-token: write
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Yukibana-Ed/Yukibana/action@main
        with:
          url: ${data.origin}
          label: \${{ github.ref_name }}`);
</script>

<div class="head">
  <nav class="crumbs" aria-label="Breadcrumb">
    <a href="/">Courses</a>
    <a href="/editions/{p.edition_id}">{p.course_code} {p.edition_label}</a>
    <span>{p.title}</span>
  </nav>
  <h1>{p.title}</h1>
  <p class="row">
    <Chip tone="info">{p.kind}</Chip>
    {#if data.staff && p.available_after === null}<Chip tone="draft">draft</Chip>{/if}
    {#if pastDeadline}<Chip tone="late">past the deadline</Chip>{/if}
  </p>
</div>

<Tabs {tabs} current={tab} />

{#if tab === 'overview'}
  {#if form?.submitted}
    <p class="ok">Submission received: {kb(form.submitted.byteSize)}, SHA-256 {form.submitted.sha256.slice(0, 16)}…</p>
  {/if}
  <section>
    <h2>Dates</h2>
    <div class="stats">
      <div><strong>{when(p.available_after, viewer.zone)}</strong><span>Opens</span></div>
      <div><strong>{when(p.deadline, viewer.zone)}</strong><span>Deadline</span></div>
      <div><strong>{p.closes_at === null ? 'Never' : when(p.closes_at, viewer.zone)}</strong><span>Closes</span></div>
    </div>
    {#if submissions}
      <p class="note">
        Submissions after the deadline are accepted until the project closes, and are marked late.
      </p>
    {/if}
  </section>

  {#if data.staff}
    <section>
      <h2>At a glance</h2>
      <div class="stats">
        {#if submissions}
          <div><strong>{data.submissions.length}</strong><span>Submissions</span></div>
          <div><strong>{students}</strong><span>Students who submitted</span></div>
          <div><strong>{late}</strong><span>Late submissions</span></div>
        {/if}
        <div><strong>{data.releases.length}</strong><span>Releases</span></div>
      </div>
    </section>
  {/if}

  <section>
    <h2>{data.staff ? 'Starter' : 'Work on it'}</h2>
    {#if p.ready}
      <p class="row">
        <a class="yk-btn yk-btn--primary" href={ideUrl(p.project_id)}>Open in Yukibana IDE</a>
        <a class="yk-btn yk-btn--secondary" href="/api/projects/{p.project_id}/starter">Download {p.slug}.tar.gz</a>
      </p>
      {#if !data.staff}<p class="note">The IDE opens the project, downloading it if needed. Without the IDE, download the starter and work in that folder.</p>{/if}
    {:else}
      <Empty title="Nothing released yet">{data.staff ? 'Publish a release from the project’s repository; the Releases tab says how.' : 'The starter appears here once the teacher releases it.'}</Empty>
    {/if}
  </section>

  {#if !data.staff && p.ready}
    <section id="submit">
      <h2>Submit your solution</h2>
      {#if p.can_submit}
        {#if pastDeadline}<p class="error">The deadline has passed: a submission now is recorded as late.</p>{/if}
        <form method="POST" action={actionIn('overview', 'submit')} enctype="multipart/form-data" class="stack">
          <label>Your solution as .tar.gz
            <input class="yk-input" type="file" name="archive" accept=".gz,.tgz,application/gzip" required />
          </label>
          <!-- Secondary: the IDE is the way in (Open in Yukibana IDE, above) and submits for the student; this is the by-hand way. -->
          <button class="yk-btn yk-btn--secondary">Submit</button>
        </form>
        <p class="note">
          You can submit as many times as you like. Every version is kept; the latest version is the one assessed.
          The IDE's submit button sends the right archive for you; to make one by hand, run <code>yukibana pack</code> in the project folder.
        </p>
      {:else}
        <Empty title="Not accepting submissions">This project is not accepting submissions from you now.</Empty>
      {/if}
    </section>
  {/if}
{:else if tab === 'submissions'}
  {#if data.staff}
    <section>
      <h2>Submissions</h2>
      {#if lines.length === 0}
        <Empty title="No students yet">Submissions appear here, one row per student, once students are enrolled.</Empty>
      {:else}
        <HandInsTable {lines} releases={data.allReleases} slug={p.slug} />
      {/if}
    </section>
  {:else}
    <section>
      <h2>My submissions</h2>
      {#if data.submissions.length === 0}
        <Empty title="No submissions yet">Every version you submit is listed here.</Empty>
      {:else}
        <div class="scroll">
          <table class="yk-table">
            <thead>
              <tr><th>Submitted</th><th>Size</th><th>SHA-256</th><th></th></tr>
            </thead>
            <tbody>
              {#each data.submissions as s (s.submissionId)}
                <tr>
                  <td>{when(s.submittedAt, viewer.zone)}{#if s.late} <Chip tone="late">late</Chip>{/if}</td>
                  <td>{kb(s.byteSize)}</td>
                  <td><code>{s.sha256.slice(0, 12)}</code></td>
                  <td><a href="/api/submissions/{s.submissionId}">Download</a></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>
  {/if}
{:else if tab === 'releases'}
  {#if data.releases.length > 0}
    <section>
      <h2>Releases</h2>
      <div class="scroll">
        <table class="yk-table">
          <thead>
            <tr><th>Uploaded</th><th>Label</th><th>Commit</th><th>By</th><th>Starter</th><th>Teacher archive</th></tr>
          </thead>
          <tbody>
            {#each data.releases as r, i (r.release_id)}
              <tr>
                <td>{when(r.uploaded_at, viewer.zone)}{#if i === 0} <Chip tone="info">live</Chip>{/if}</td>
                <td>{r.label}</td>
                <td><code>{r.commit_sha?.slice(0, 12) ?? '—'}</code></td>
                <td>{r.uploader ?? ''}{#if r.via_token} <Chip>token</Chip>{/if}{#if r.published_from !== null} <Chip>from {r.published_from}</Chip>{/if}</td>
                <td><a href="/api/releases/{r.release_id}/starter">{kb(r.starter_size)}</a></td>
                <td><a href="/api/releases/{r.release_id}/teacher">{kb(r.teacher_size)}</a></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}

  <!-- How releases get here. One way is shown in full, the one most projects use: a linked GitHub repository, where a
       pushed tag publishes. Everything else (a template, a repository the App cannot list, the workflow file, the CLI, a
       token) waits behind a disclosure until somebody opens it, so the tab reads as one thing to do, not seven. -->
  <section class="publishing">
    <h2>Publishing</h2>
    {#if data.releases.length === 0}
      <p class="note">
        No releases yet. A release is two archives built from the project's repository: the starter students get, and the
        whole project for staff.
      </p>
    {/if}

    {#if gh !== null}
      <div id="repository" class="way">
        <h3>GitHub repository</h3>
        {#if form?.linked}<p class="ok">Linked to {form.linked}. Push a tag there to publish a release.</p>{/if}
        {#if form?.unlinked}<p class="ok">Unlinked. Releases already published stay.</p>{/if}

        {#if gh.link !== null && !gh.relink}
          <div class="linked">
            <div>
              <a href="https://github.com/{gh.link.repository}" target="_blank" rel="noreferrer"><code>{gh.link.repository}</code></a>
              <p class="note">
                Tags pushed there publish releases here. Linked{gh.link.linkedBy === null ? '' : ` by ${gh.link.linkedBy}`}, {when(gh.link.linkedAt, viewer.zone)}.
                {#if gh.link.lastPublish === null}
                  Nothing published from it yet.
                {:else}
                  Last published {when(gh.link.lastPublish.at, viewer.zone)}{gh.link.lastPublish.label === '' ? '' : ` as “${gh.link.lastPublish.label}”`}
                  from <code>{gh.link.lastPublish.from}</code>.
                {/if}
              </p>
            </div>
            {#if data.owner}
              <div class="row">
                <a class="yk-btn yk-btn--secondary" href="?tab=releases&relink#repository">Change</a>
                <Confirm label="Unlink" title="Unlink {gh.link.repository}?" action={actionIn('releases', 'unlinkRepository')} fields={{}}>
                  Tags pushed to {gh.link.repository} stop publishing to this project. Releases already published stay.
                </Confirm>
              </div>
            {/if}
          </div>
          {#if !gh.link.ownerCurrent}
            <p class="error">
              The person who linked this repository is no longer an owner of this edition, so it no longer publishes.
              An owner must link it again.
            </p>
          {/if}
        {:else if !data.owner}
          <p class="note">No repository is linked. An owner of this edition can link one, and a tag pushed there then publishes a release here.</p>
        {/if}

        {#if choosing}
          {#if gh.relink && gh.link !== null}
            <p>Choose the repository to link instead of <code>{gh.link.repository}</code>. <a href="?tab=releases#repository">Keep the current link</a></p>
          {:else}
            <p>Link the project's repository, and every tag pushed there publishes a release here. No token to copy.</p>
          {/if}

          {#if !gh.connected}
            <form method="POST" action={actionIn('releases', 'connectGithub')} class="row">
              {#if gh.relink}<input type="hidden" name="relink" value="1" />{/if}
              <button class="yk-btn yk-btn--primary">Connect GitHub</button>
              <span class="note">GitHub asks you to authorise the Yukibana Cloud App; you need admin or maintain on the repository.</span>
            </form>
          {:else if gh.picker !== null && gh.picker.failed !== null}
            <p class="error">{gh.picker.failed}</p>
          {:else if gh.picker !== null && gh.picker.repositories.length > 0}
            <form method="POST" action={actionIn('releases', 'linkRepository')} class="row pick">
              <label class="sr-only" for="repository-id">Repository</label>
              <select id="repository-id" class="yk-input" name="repository_id" required>
                {#each gh.picker.repositories as r (r.id)}
                  <option value={r.id}>{r.fullName}{r.private ? ' (private)' : ''}</option>
                {/each}
              </select>
              <button class="yk-btn yk-btn--primary">Link</button>
            </form>
          {:else}
            <p class="note">The App sees no repository you administer or maintain yet.</p>
          {/if}
        {/if}

        <div class="more">
          {#if choosing && gh.connected}
            <!-- Open by itself when there is nothing to pick from: then it is the only way forward. -->
            <details open={gh.picker !== null && gh.picker.failed === null && gh.picker.repositories.length === 0}>
              <summary>Repository not listed?{#if gh.picker?.truncated} <span class="muted">Not every repository is shown.</span>{/if}</summary>
              <div class="body">
                <form method="POST" action={actionIn('releases', 'linkRepository')} class="row pick">
                  <label class="sr-only" for="repository-name">Repository, as owner/name</label>
                  <input id="repository-name" class="yk-input" name="repository" placeholder="owner/name" required />
                  <button class="yk-btn yk-btn--secondary">Link</button>
                </form>
                <p class="note">
                  Or give the App access to it: install the App on the repository's account, or add the repository to an
                  existing installation, then refresh. In an organisation an owner may have to approve.
                </p>
                <form method="POST" action={actionIn('releases', 'connectGithub')} class="row">
                  {#if gh.relink}<input type="hidden" name="relink" value="1" />{/if}
                  <button class="yk-btn yk-btn--secondary" name="install" value="1">Install the App or add repositories</button>
                  <a href="?tab=releases{gh.relink ? '&relink' : ''}#repository">Refresh the list</a>
                </form>
              </div>
            </details>
          {/if}
          {#if choosing && gh.templates.length > 0}
            <details>
              <summary>No repository yet? Start from a template</summary>
              <div class="body">
                <p class="note">
                  GitHub makes the repository, under your account or an organisation, with the publishing workflow already
                  in it. Then come back and pick it{gh.connected ? '' : ' after connecting GitHub'}.
                </p>
                <ul class="templates">
                  {#each gh.templates as t (t.repository)}
                    <li>
                      <strong>{t.name}</strong> <span class="note">{t.repository}</span>
                      <span>{t.description}</span>
                      <a class="yk-btn yk-btn--secondary" href={useTemplateUrl(t)} target="_blank" rel="noreferrer">Create a repository from it</a>
                    </li>
                  {/each}
                </ul>
              </div>
            </details>
          {/if}
          <details>
            <summary>The workflow file the repository needs</summary>
            <div class="body">
              <p class="note">
                Put this in <code>.github/workflows/publish.yml</code> (a template already has it). It proves where it
                runs with GitHub's OIDC token (<code>id-token: write</code>), so it needs no secret, and publishes to
                every project linked to the repository. To publish only to some, give the Action <code>projects:</code>,
                their ids separated by commas. Anyone who can push a tag can publish; protect tags with a ruleset where
                your plan allows it.
              </p>
              <pre>{workflow}</pre>
              <CopyButton text={workflow} label="Copy the workflow" />
            </div>
          </details>
        </div>
      </div>
    {/if}

    {#if p.can_edit}
      <div class="way">
        <h3>{gh === null ? 'Ways to publish' : 'Other ways to publish'}</h3>
        <!-- One open at a time (`name`): each is a whole way of working, and two side by side is the clutter this
             replaced. The token way opens by itself only when a token was just made, since its secret is on it. -->
        <div class="more">
          <details name="publish-way" open={gh === null && form?.token === undefined}>
            <summary>From the command line</summary>
            <div class="body">
              <p class="note">
                From a checkout of the project, logged in as staff. The CLI builds both archives and publishes them;
                there is no upload on this page, because the release id has to travel inside the starter and only the
                CLI puts it there.
              </p>
              <pre>{cli}</pre>
              <CopyButton text={cli} label="Copy the command" />
            </div>
          </details>
          {#if data.owner}
            <details name="publish-way" open={form?.token !== undefined}>
              <summary>
                From CI, with a token
                {#if activeTokens > 0}<span class="muted">{activeTokens} active</span>{/if}
              </summary>
              <div class="body">
                {#if form?.token}
                  <p class="ok">Token “{form.token.label}” created. Copy it now; it is not shown again.</p>
                  <pre>{form.token.secret}</pre>
                  <CopyButton text={form.token.secret} label="Copy the token" />
                {/if}
                <p class="note">
                  For CI other than a linked GitHub repository. A token publishes releases to this project and nothing
                  else. Put it in the CI's secrets, with the project and the registry:
                </p>
                <pre>YUKIBANA_TOKEN   (the secret)
YUKIBANA_PROJECT {p.project_id}
YUKIBANA_URL     {data.origin}</pre>
                {#if data.tokens.length > 0}
                  <div class="scroll">
                    <table class="yk-table">
                      <thead><tr><th>Label</th><th>Created</th><th>Last used</th><th></th></tr></thead>
                      <tbody>
                        {#each data.tokens as t (t.token_id)}
                          <tr>
                            <td>{t.label}</td>
                            <td>{when(t.created_at, viewer.zone)}</td>
                            <td>{#if t.revoked_at}<Chip>revoked</Chip>{:else}{when(t.last_used_at, viewer.zone)}{/if}</td>
                            <td>
                              {#if !t.revoked_at}
                                <Confirm label="Revoke" title="Revoke “{t.label}”?" action={actionIn('releases', 'revokeToken')} fields={{ token_id: t.token_id }}>
                                  CI that publishes with this token stops working at once. A revoked token cannot be restored; make a new one instead.
                                </Confirm>
                              {/if}
                            </td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                {/if}
                <form method="POST" action={actionIn('releases', 'createToken')} class="row pick">
                  <label class="sr-only" for="token-label">Label</label>
                  <input id="token-label" class="yk-input" name="label" placeholder="Label, like “gitlab ci”" />
                  <button class="yk-btn yk-btn--secondary">Create a token</button>
                </form>
              </div>
            </details>
          {/if}
        </div>
      </div>
    {/if}
  </section>
{:else if tab === 'settings'}
  <section>
    <h2>Settings</h2>
    {#if editing && live.stale && !saving}
      <p class="error" role="alert">
        Somebody else changed this project while you were editing. Saving replaces their change.
        <button type="button" class="yk-btn yk-btn--secondary" onclick={discard}>Discard my edits and show theirs</button>
      </p>
    {/if}
    {#key p}
      <form method="POST" action={actionIn('settings', 'update')} class="stack" oninput={() => (editing = true)} onsubmit={() => (saving = true)}>
        <label>Title <input class="yk-input" name="title" value={p.title} required /></label>
        <!-- The zone the times below are written in, and the instants they
             were written from: the action reads the times in that zone, and
             keeps an instant whose time nobody changed (#lib/wall-time). -->
        <input type="hidden" name="zone" value={viewer.zone} />
        {#each times as [name, label, at] (name)}
          <input type="hidden" name="{name}_was" value={at === null ? '' : new Date(at).toISOString()} />
          <label>{label} <input class="yk-input" type="datetime-local" {name} value={local(at, viewer.zone)} /></label>
        {/each}
        <p class="note">Times are in {viewer.zone}{viewer.zone === 'UTC' ? '' : ', this browser’s time zone'}.</p>
        <button class="yk-btn yk-btn--primary" data-done={saved ? '' : undefined}>{saved ? '✓ Saved' : 'Save'}</button>
      </form>
    {/key}
    <p class="note">
      Without an opening date students cannot see the project at all. Between the deadline and the
      closing date, submissions are accepted and marked late; after closing, students no longer see
      the project. Without a closing date, late work is accepted indefinitely.
    </p>
  </section>
{/if}
