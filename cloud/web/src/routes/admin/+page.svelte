<script lang="ts">
  import { page } from '$app/state';
  import Tabs from '#lib/Tabs.svelte';
  import Chip from '#lib/Chip.svelte';
  import CopyButton from '#lib/CopyButton.svelte';
  import Empty from '#lib/Empty.svelte';
  import { when } from '#lib/format.ts';
  import { viewer } from '#lib/viewer.svelte.ts';
  import { actionIn, tabOf, type Tab } from '#lib/tabs.ts';
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  const tabs = $derived<Tab[]>([
    { id: 'roles', label: 'Roles', count: data.staff.length },
    { id: 'invites', label: 'Invites', count: data.invites.length },
    { id: 'audit', label: 'Audit log' },
  ]);
  const tab = $derived(tabOf(page.url, tabs));
</script>

<div class="head">
  <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Courses</a><span>Administration</span></nav>
  <h1>Administration</h1>
  <p>Who may create courses, and everything the platform has been asked to do.</p>
</div>

<Tabs {tabs} current={tab} />

{#if tab === 'roles'}
  <section>
    <h2>Change a platform role</h2>
    <form method="POST" action={actionIn('roles', 'setRole')} class="stack">
      <label>Address <input class="yk-input" name="email" type="email" required placeholder="teacher@school.example" /></label>
      <label>Role
        <select class="yk-input" name="role">
          <option value="teacher">teacher</option>
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
      </label>
      <button class="yk-btn yk-btn--primary">Set role</button>
    </form>
    <p class="note">The person must have logged in once, so there is an account to change. For someone who has not, create an invite link in the Invites tab.</p>
  </section>

  <section>
    <h2>Teachers and admins</h2>
    {#if data.staff.length === 0}
      <Empty title="Nobody but you">Set a role above to make somebody a teacher or an admin.</Empty>
    {:else}
      <div class="scroll">
        <table class="yk-table">
          <thead><tr><th>Person</th><th>Role</th></tr></thead>
          <tbody>
            {#each data.staff as s (s.user_id)}
              <tr>
                <td>{s.full_name ?? ''} {#if s.github_login}<span class="muted">@{s.github_login}</span>{/if}</td>
                <td><Chip>{s.role}</Chip></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

{:else if tab === 'invites'}
  {#if form && 'invite' in form}
    <section>
      <h2>New invite link</h2>
      <p class="ok">Invite{form.invite.label === '' ? '' : ` for ${form.invite.label}`} created. Copy the link now: it will not be shown again.</p>
      <pre>{form.invite.link}</pre>
      <CopyButton text={form.invite.link} label="Copy link" />
    </section>
  {/if}
  <section>
    <h2>Invite a teacher</h2>
    <p>The person who accepts the link gets teacher rights and can create courses. If they have no account, they create one when they sign in. Each link works once.</p>
    <form method="POST" action={actionIn('invites', 'createInvite')} class="stack">
      <label>For <input name="label" maxlength="200" placeholder="Prof. Rossi, Operating Systems" /></label>
      <button>Create invite link</button>
    </form>
  </section>

  <section>
    <h2>Unused invites</h2>
    {#if data.invites.length === 0}
      <p class="empty">No unused invites.</p>
    {:else}
      <div class="scroll">
        <table>
          <thead><tr><th>For</th><th>Created by</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {#each data.invites as i (i.invite_id)}
              <tr>
                <td>{i.label}</td>
                <td>{i.created_by ?? ''}</td>
                <td>{when(i.created_at, viewer.zone)}</td>
                <td>
                  <form method="POST" action={actionIn('invites', 'revokeInvite')} class="inline">
                    <input type="hidden" name="invite_id" value={i.invite_id} />
                    <button>Remove</button>
                  </form>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

{:else}
  <section>
    <h2>Audit log</h2>
    {#if data.audit.length === 0}
      <Empty title="Nothing has happened yet">Every change anybody makes is listed here.</Empty>
    {:else}
      <div class="scroll">
        <table class="yk-table">
          <thead><tr><th>When</th><th>Action</th><th>Subject</th></tr></thead>
          <tbody>
            {#each data.audit as a, i (i)}
              <tr>
                <td>{when(a.at, viewer.zone)}</td>
                <td><Chip>{a.action}</Chip></td>
                <td><code>{a.subject}</code></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
{/if}
