<script lang="ts">
  import { page } from '$app/state';
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  const login = $derived(`/auth/login?next=${encodeURIComponent(page.url.pathname)}`);
  const accepted = $derived(form !== null && 'accepted' in form && form.accepted === true);
</script>

<svelte:head>
  <!--
    The address holds the secret, so no other site this page links to may
    learn it from the Referer. `same-origin`, not `no-referrer`: under
    `no-referrer` the browser sends `Origin: null` with the page's own form,
    and the forgery check rightly refuses the "Accept" it then cannot place.
  -->
  <meta name="referrer" content="same-origin" />
</svelte:head>

<div class="head">
  <h1>Teach on Yukibana</h1>
</div>

<section>
  {#if accepted}
    <p class="ok">You are a teacher now, and may create courses.</p>
    <p><a href="/">Go to your courses</a></p>
  {:else if !data.signedIn}
    <p>You have been invited to teach on Yukibana: to create courses, publish assignments and see what students hand in.</p>
    <p>Log in to accept. If you have no account yet, logging in with your address or with GitHub makes one.</p>
    <p><a class="button" href={login}>Log in to accept</a></p>
  {:else if data.role === 'teacher' || data.role === 'admin'}
    <p>You are signed in as {data.email}, who is already {data.role === 'admin' ? 'an admin' : 'a teacher'}, so this invite has nothing to give you.</p>
    <p class="note">It stays unused, for the person it was meant for. If that is someone else, log out and let them open it.</p>
  {:else if data.status === 'open'}
    <p>You have been invited to teach on Yukibana. Accepting makes {data.email} a teacher, so you can create courses.</p>
    <form method="POST" action="?/accept">
      <button>Accept and become a teacher</button>
    </form>
    <p class="note">The link works once. If this is not your account, log out first.</p>
  {:else if data.status === 'expired'}
    <p>This invite has expired. Ask the admin who sent it for a new one.</p>
  {:else}
    <p>This invite was used already, or removed. Ask the admin who sent it for a new one.</p>
  {/if}
</section>
