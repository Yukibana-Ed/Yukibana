<script lang="ts">
  import type { Component } from 'svelte';
  import { invalidateAll } from '$app/navigation';
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
  <p>How you appear to the people in your courses.</p>
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
    <p class="muted">Your picture is shown to you and to the people in your courses. Any image works: you frame it here, and only the square you keep is uploaded.</p>
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

{#if cropping !== null}
  <cropping.Cropper file={cropping.file} {save} close={() => (cropping = null)} />
{/if}
