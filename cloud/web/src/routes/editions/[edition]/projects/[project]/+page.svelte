<script lang="ts">
  import { page } from '$app/state';
  import Tabs from '#lib/Tabs.svelte';
  import Chip from '#lib/Chip.svelte';
  import Confirm from '#lib/Confirm.svelte';
  import Empty from '#lib/Empty.svelte';
  import CodeBlock from '#lib/CodeBlock.svelte';
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
  const cli = $derived(`$ yukibana publish --project ${p.project_id}`);
  // The templates a new project can start from: an owner's, where the GitHub App is configured.
  const templates = $derived(gh !== null && data.owner ? gh.templates : []);
  // The ways this person may publish, the recommended first. A link needs the GitHub App, a token an owner, the CLI
  // someone who may edit the edition's projects.
  const methods = $derived([
    ...(gh !== null ? [{ id: 'github', title: 'GitHub repository', blurb: 'Link it; every tag pushed publishes. No secret to copy.' }] : []),
    ...(data.owner ? [{ id: 'token', title: 'A token in CI secrets', blurb: 'For any CI, GitHub Actions included, without a link.' }] : []),
    ...(p.can_edit ? [{ id: 'cli', title: 'CLI', blurb: 'Publish from a checkout on your own machine.' }] : []),
  ]);
  // Which card each choice starts on: what the address asks (`?source=new`, `?method=token`), so a link can open a
  // choice and a token form's answer comes back to the token panel; else the first. A token just made is on the token
  // panel whatever the address says, since its secret is shown there once.
  const source = $derived(page.url.searchParams.get('source') === 'new' && templates.length > 0 ? 'new' : 'existing');
  const method = $derived.by(() => {
    const asked = form?.token ? 'token' : page.url.searchParams.get('method');
    return methods.find((m) => m.id === asked)?.id ?? methods[0]?.id ?? '';
  });
  // A form on the token panel posts to an address that comes back to it (#lib/tabs `actionIn`, with `method`).
  const inMethod = (m: string, action: string): string => `?tab=releases&method=${m}&/${action}`;
  // The workflow for publishing with a token from GitHub Actions; `${{ }}` built here, not in the markup.
  const tokenWorkflow = $derived(`name: Publish to Yukibana
on:
  push:
    tags: ['*']
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Yukibana-Ed/Yukibana/action@main
        with:
          url: ${data.origin}
          project: \${{ vars.YUKIBANA_PROJECT }}
          token: \${{ secrets.YUKIBANA_TOKEN }}
          label: \${{ github.ref_name }}`);
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
                <!-- A release from a linked repository links its commit on GitHub: `published_from` is the repository's
                     owner/name as GitHub's token said it. The label is whatever the workflow passed, not surely a tag,
                     so only the commit is linked. -->
                <td>
                  {#if r.commit_sha === null}—{:else if r.published_from !== null}<a href="https://github.com/{r.published_from}/commit/{r.commit_sha}" target="_blank" rel="noreferrer"><code>{r.commit_sha.slice(0, 12)}</code></a>{:else}<code>{r.commit_sha.slice(0, 12)}</code>{/if}
                </td>
                <td>{r.uploader ?? ''}{#if r.via_token} <Chip>token</Chip>{/if}</td>
                <td><a href="/api/releases/{r.release_id}/starter">{kb(r.starter_size)}</a></td>
                <td><a href="/api/releases/{r.release_id}/teacher">{kb(r.teacher_size)}</a></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}

  <!-- How releases get here, in two choices: where the project comes from (a repository that exists, or a new one
       from a template), and, for one that exists, how it publishes. Each choice is a row of radio cards and shows only
       the panel of the card chosen, by CSS (`:has`), so it works without JavaScript and nothing else is on screen. The
       first choice is left out where there are no templates to offer. -->
  {#if p.can_edit || gh !== null}
    <section class="publishing">
      <h2>Publishing</h2>
      {#if data.releases.length === 0}
        <p class="note">
          No releases yet. A release is two archives built from the project's repository: the starter students get, and
          the whole project for staff.
        </p>
      {/if}

      {#if templates.length > 0}
        <fieldset class="choices">
          <legend>Start from</legend>
          <label class="choice">
            <input type="radio" name="source" value="existing" checked={source === 'existing'} />
            <b>Publish an existing project</b>
            <span>The project is already in a repository.</span>
          </label>
          <label class="choice">
            <input type="radio" name="source" value="new" checked={source === 'new'} />
            <b>Create a new project</b>
            <span>Start a repository from a template.</span>
          </label>
        </fieldset>
      {/if}

      {#if templates.length > 0}
        <div class="panel" data-source="new">
          <ul class="templates">
            {#each templates as t (t.repository)}
              <li>
                <div>
                  <strong>{t.name}</strong> <span class="note">{t.repository}</span>
                  <p class="note">{t.description}</p>
                </div>
                <a class="yk-btn yk-btn--secondary" href={useTemplateUrl(t)} target="_blank" rel="noreferrer" aria-label="Use template {t.name}">Use template</a>
              </li>
            {/each}
          </ul>
          <p class="note">
            GitHub makes the repository, under your account or an organisation, with the publishing workflow already in it.
            Then come back, choose <b>Publish an existing project</b>, and link it.
          </p>
        </div>
      {/if}

      <div class="panel" data-source="existing">
        <fieldset class="choices">
          <legend>Publish with</legend>
          {#each methods as m (m.id)}
            <label class="choice">
              <input type="radio" name="method" value={m.id} checked={method === m.id} />
              <b>{m.title}{#if m.id === 'github'} <Chip tone="info">recommended</Chip>{/if}</b>
              <span>{m.blurb}</span>
            </label>
          {/each}
        </fieldset>

        {#if gh !== null}
          <div class="panel" data-method="github" id="repository">
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
              <p class="note">No repository is linked. An owner of this edition who administers or maintains it on GitHub can link one.</p>
            {/if}

            {#if choosing}
              {#if gh.relink && gh.link !== null}
                <p>Choose the repository to link instead of <code>{gh.link.repository}</code>. <a href="?tab=releases#repository">Keep the current link</a></p>
              {:else}
                <p>
                  Link the repository and every tag pushed there publishes a release here. The workflow proves where it runs
                  with GitHub's own token, so there is no secret to copy.
                </p>
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
                <!-- The list is the signed-in person's own (#lib/server/github-link `pickerFor`): an owner of the edition
                     who has no admin or maintain on the course repository yet, or no longer, sees nothing here. -->
                <p class="note">
                  GitHub shows no repository you administer or maintain. You need admin or maintain on the repository
                  yourself: ask its administrators, or, if you have it, give the App access to it below.
                </p>
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
                      Only repositories you administer or maintain yourself are listed, wherever the App is installed. If
                      you have that access and it is still missing, give the App access to it: install the App on the
                      repository's account, or add the repository to an existing installation, then refresh. In an
                      organisation an owner may have to approve.
                    </p>
                    <form method="POST" action={actionIn('releases', 'connectGithub')} class="row">
                      {#if gh.relink}<input type="hidden" name="relink" value="1" />{/if}
                      <button class="yk-btn yk-btn--secondary" name="install" value="1">Install the App or add repositories</button>
                      <a href="?tab=releases{gh.relink ? '&relink' : ''}#repository">Refresh the list</a>
                    </form>
                  </div>
                </details>
              {/if}
              <details>
                <summary>Set up the workflow</summary>
                <div class="body">
                  <p class="note">
                    Put this in <code>.github/workflows/publish.yml</code> (a template already has it). It needs no secret
                    (<code>id-token: write</code> lets it prove where it runs) and publishes to every project linked to the
                    repository; to publish only to some, give the Action <code>projects:</code>, their ids separated by
                    commas. Anyone who can push a tag can publish; protect tags with a ruleset where your plan allows it.
                  </p>
                  <CodeBlock code={workflow} language="yaml" title=".github/workflows/publish.yml" />
                </div>
              </details>
            </div>
          </div>
        {/if}

        {#if data.owner}
          <div class="panel" data-method="token">
            <p>
              Make a token and store it in the CI's secrets. It publishes releases to this project and nothing else, from
              any branch or tag. For GitHub Actions without a link, or any other CI.
            </p>
            {#if form?.token}
              <p class="ok">Token “{form.token.label}” created. Copy it now; it is not shown again.</p>
              <CodeBlock code={form.token.secret} />
            {/if}
            <form method="POST" action={inMethod('token', 'createToken')} class="row pick">
              <label class="sr-only" for="token-label">Label</label>
              <input id="token-label" class="yk-input" name="label" placeholder="Label, like “gitlab ci”" />
              <button class="yk-btn yk-btn--primary">Create a token</button>
            </form>
            {#if data.tokens.length > 0}
              <div class="scroll">
                <table class="yk-table">
                  <thead><tr><th>Token</th><th>Created</th><th>Last used</th><th></th></tr></thead>
                  <tbody>
                    {#each data.tokens as t (t.token_id)}
                      <tr>
                        <td>{t.label}</td>
                        <td>{when(t.created_at, viewer.zone)}</td>
                        <td>{#if t.revoked_at}<Chip>revoked</Chip>{:else}{when(t.last_used_at, viewer.zone)}{/if}</td>
                        <td>
                          {#if !t.revoked_at}
                            <Confirm label="Revoke" title="Revoke “{t.label}”?" action={inMethod('token', 'revokeToken')} fields={{ token_id: t.token_id }}>
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
            <div class="more">
              <details>
                <summary>Set up the workflow</summary>
                <div class="body">
                  <p class="note">
                    Store the token as the secret <code>YUKIBANA_TOKEN</code> and the project id as the variable
                    <code>YUKIBANA_PROJECT</code> (<code>{p.project_id}</code>). On GitHub Actions, this in
                    <code>.github/workflows/publish.yml</code> publishes every tag:
                  </p>
                  <CodeBlock code={tokenWorkflow} language="yaml" title=".github/workflows/publish.yml" />
                  <p class="note">
                    Another CI runs <code>yukibana publish</code> with <code>YUKIBANA_TOKEN</code>,
                    <code>YUKIBANA_PROJECT</code> and <code>YUKIBANA_URL</code> (<code>{data.origin}</code>) in its environment.
                  </p>
                </div>
              </details>
            </div>
          </div>
        {/if}

        {#if p.can_edit}
          <div class="panel" data-method="cli">
            <p>
              From a checkout of the project, logged in as staff, the CLI builds both archives and publishes them. There is
              no upload on this page: the release id has to travel inside the starter, and only the CLI puts it there.
            </p>
            <CodeBlock code={cli} language="shell" />
          </div>
        {/if}
      </div>
    </section>
  {/if}
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
