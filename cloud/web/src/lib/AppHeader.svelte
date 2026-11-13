<script lang="ts">
  import { page } from '$app/state';
  import Icon from './Icon.svelte';
  import ThemeSwitch from './ThemeSwitch.svelte';
  import { placeMenu } from './popover';
  import type { Membership } from './memberships';

  /** The cloud's bar (yk-header): the brand, the course switcher, the avatar, and nothing else. The switcher names the
   *  edition the page is in, or "Courses", and lists the person's editions; the avatar opens who they are signed in as,
   *  the theme (ThemeSwitch) and Log out. Signed out, the bar holds the brand and Log in. */
  let { user, memberships }: { user: { readonly email: string | null } | null; memberships: readonly Membership[] } = $props();

  const here = $derived(memberships.find((m) => m.edition_id === page.params['edition']) ?? null);
  const active = $derived(memberships.filter((m) => !m.archived));
  const archived = $derived(memberships.filter((m) => m.archived));
  const initial = $derived((user?.email ?? '?').charAt(0));
  const close = (e: Event) => (e.currentTarget as Element).closest<HTMLElement>('[popover]')?.hidePopover();
</script>

<header class="yk-header">
  <div class="start">
    <a href="/" class="yk-header__brand"><img src="/logo-64.png" alt="" width="24" height="24" />Yukibana</a>
    {#if user}
      <span class="sep" aria-hidden="true">/</span>
      <button type="button" class="yk-btn yk-btn--ghost course" popovertarget="course-menu">
        <span>{here === null ? 'Courses' : `${here.code} ${here.label}`}</span><Icon name="chevron-down" />
      </button>
      <div class="menu" id="course-menu" popover ontoggle={(e) => placeMenu(e, 'start')}>
        <a href="/" onclick={close} aria-current={page.url.pathname === '/' ? 'page' : undefined}>All courses</a>
        {#if active.length > 0}<hr />{/if}
        {#each active as m (m.edition_id)}
          <a href="/editions/{m.edition_id}" onclick={close} aria-current={m === here ? 'page' : undefined}>{m.code} {m.label}</a>
        {/each}
        {#if archived.length > 0}
          <div class="group">Archived</div>
          {#each archived as m (m.edition_id)}
            <a href="/editions/{m.edition_id}" onclick={close} aria-current={m === here ? 'page' : undefined}>{m.code} {m.label}</a>
          {/each}
        {/if}
      </div>
    {/if}
  </div>
  <div class="yk-header__end">
    {#if user}
      <button type="button" class="avatar" popovertarget="account-menu" aria-label="Account: {user.email ?? 'signed in'}">{initial}</button>
      <div class="menu" id="account-menu" popover ontoggle={(e) => placeMenu(e)}>
        <div class="who">Signed in as {user.email ?? 'an account without an address'}</div>
        <hr />
        <ThemeSwitch />
        <hr />
        <form method="POST" action="/auth/logout"><button>Log out</button></form>
      </div>
    {:else}
      <a class="yk-btn yk-btn--secondary" href="/auth/login">Log in</a>
    {/if}
  </div>
</header>
