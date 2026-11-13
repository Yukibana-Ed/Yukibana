<script lang="ts">
  import { page } from '$app/state';
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  // Logging in, or out and in again as someone else, comes back to this invite.
  const login = $derived(`/auth/login?next=${encodeURIComponent(page.url.pathname)}`);
  const accepted = $derived(form !== null && 'accepted' in form);
</script>

<svelte:head>
  <!-- The address holds the secret, so no other site may see it in a Referer. Not `no-referrer`: with it, the browser sends `Origin: null`
       with this page's own forms, and `forgery` refuses them. -->
  <meta name="referrer" content="same-origin" />
</svelte:head>

{#snippet switchAccount(label: string)}
  <form method="POST" action="/auth/logout">
    <input type="hidden" name="next" value={login} />
    <button class="yk-btn yk-btn--secondary">{label}</button>
  </form>
{/snippet}

<section class="login">
  <img class="mark" src="/logo-64.png" alt="" width="48" height="48" />

  {#if data.account === null}
    <h1>You're invited to teach</h1>
    <p class="muted">Log in to accept. If you don't have an account yet, logging in creates one.</p>
    <a class="yk-btn yk-btn--primary" href={login}>Log in to accept</a>
  {:else if accepted}
    <h1>You're a teacher now</h1>
    <p class="muted"><strong>{data.account.email}</strong> can now create courses, publish assignments and review submissions.</p>
    <a class="yk-btn yk-btn--primary" href="/">Go to your courses</a>
  {:else if data.account.role !== 'user'}
    <h1>You already have teacher rights</h1>
    <p class="muted">
      <strong>{data.account.email}</strong> is {data.account.role === 'admin' ? 'an admin' : 'a teacher'} and can already create courses, so
      this invite would change nothing. It stays unused, and the person it was meant for can still accept it.
    </p>
    {@render switchAccount('Accept with a different account')}
  {:else if !data.open}
    <h1>This invite is no longer valid</h1>
    <p class="muted">It was already accepted or removed. Ask the admin who sent it for a new one.</p>
    {@render switchAccount('Log in with a different account')}
  {:else}
    <h1>You're invited to teach</h1>
    <p class="muted">Accepting gives <strong>{data.account.email}</strong> teacher rights: you can create courses, publish assignments and review submissions.</p>
    <form method="POST" action="?/accept">
      <button class="yk-btn yk-btn--primary">Accept invite</button>
    </form>
    <div class="again">
      <span class="muted">Not your account?</span>
      {@render switchAccount('Use a different account')}
    </div>
  {/if}
</section>
