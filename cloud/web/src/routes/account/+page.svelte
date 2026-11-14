<script lang="ts">
  import type { Component } from 'svelte';
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { AUDIENCES, AUDIENCE_LABEL, type Audience } from '#lib/audience.ts';
  import { postAction } from '#lib/action.ts';
  import { notify, toast } from '#lib/toast.svelte.ts';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();

  type Cropper = Component<{ file: File; save: (picture: Blob) => Promise<void>; close: () => void }>;
  /** The cropper and the file it frames, once one is chosen. The component, its styles and the encoder are fetched
   *  then, not with this page: most visits never change a picture. */
  let cropping: { file: File; Cropper: Cropper } | null = $state(null);
  let input: HTMLInputElement;

  const name = $derived(data.fullName ?? data.githubLogin ?? data.email ?? 'You');
  const initial = $derived((data.email ?? name).charAt(0));

  async function chosen(): Promise<void> {
    const file = input.files?.[0];
    input.value = ''; // so that choosing the same file again opens it again
    if (file === undefined) return;
    try {
      const { default: Cropper } = await import('#lib/picture/PictureCropper.svelte');
      cropping = { file, Cropper };
    } catch {
      toast('The picture editor could not be loaded. Check your connection and try again.');
    }
  }

  async function save(picture: Blob): Promise<void> {
    await postAction('?/picture', { picture });
    await invalidateAll();
    notify('Your picture is saved.');
  }
</script>

<svelte:head><title>Your account · Yukibana</title></svelte:head>

<div class="head">
  <h1>Your account</h1>
  <p>How you appear to others, and who sees it.</p>
</div>

<section class="profile">
  {#if data.picture !== null}
    <img class="picture" src={data.picture} alt="" width="96" height="96" />
  {:else}
    <span class="picture" aria-hidden="true">{initial}</span>
  {/if}
  <div class="who">
    <h2>{name}</h2>
    {#if data.email !== null}<p class="muted">{data.email}</p>{/if}
    <p class="muted">Any image works for your picture: you frame it here, and only the square you keep is uploaded.</p>
    <div class="actions">
      <input bind:this={input} type="file" accept="image/*" hidden onchange={chosen} />
      <button type="button" class="yk-btn yk-btn--primary" onclick={() => input.click()}>
        {data.picture === null ? 'Choose a picture' : 'Change picture'}
      </button>
      {#if data.picture !== null}
        <form method="POST" action="?/removePicture">
          <button class="yk-btn yk-btn--secondary">Remove picture</button>
        </form>
      {/if}
    </div>
  </div>
</section>

{#snippet audience(field: string, label: string, chosen: Audience)}
  <label
    >{label}
    <select class="yk-input" name={field}>
      {#each AUDIENCES as a (a)}<option value={a} selected={a === chosen}>{AUDIENCE_LABEL[a]}</option>{/each}
    </select>
  </label>
{/snippet}

<section>
  <h2>Name and visibility</h2>
  <form
    method="POST"
    action="?/profile"
    class="stack"
    use:enhance={() =>
      async ({ result, update }) => {
        await update({ reset: false });
        if (result.type === 'success') notify('Your profile is saved.');
      }}
  >
    <label
      >Name
      <input class="yk-input" name="name" maxlength="100" autocomplete="name" value={data.fullName ?? ''} placeholder={data.githubLogin ?? ''} />
    </label>
    {@render audience('name_audience', 'Who sees your name', data.nameAudience)}
    {@render audience('picture_audience', 'Who sees your picture', data.pictureAudience)}
    <p class="muted">
      The people in your courses are everyone who shares a course edition with you, its teachers included. Teachers always see the address you
      were enrolled with, whatever you choose here.
    </p>
    <button class="yk-btn yk-btn--primary">Save</button>
  </form>
</section>

{#if cropping !== null}
  <cropping.Cropper file={cropping.file} {save} close={() => (cropping = null)} />
{/if}
