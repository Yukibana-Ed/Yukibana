<script lang="ts">
  import type { Snippet } from 'svelte';
  /** A button that asks first, for what cannot come back (revoking a token): the question in a dialog, with Cancel
   *  and the action spelt out again. The design system has everything that can come back done at once, with Undo;
   *  Undo needs the cloud to keep deleted rows (soft delete), which it does not yet, so nothing offers it today.
   *
   *  The dialog's form posts to `action` with `fields`, as the button would have; Cancel closes it without posting
   *  (`formmethod="dialog"`). */
  let {
    label,
    title,
    action,
    fields,
    children,
  }: { label: string; title: string; action: string; fields: Readonly<Record<string, string>>; children: Snippet } = $props();
  let dialog: HTMLDialogElement;
</script>

<button type="button" class="yk-btn yk-btn--secondary yk-btn--remove" onclick={() => dialog.showModal()}>{label}</button>
<dialog class="confirm" bind:this={dialog} aria-labelledby="confirm-title-{action}-{Object.values(fields).join('-')}">
  <form method="POST" {action}>
    {#each Object.entries(fields) as [name, value] (name)}<input type="hidden" {name} {value} />{/each}
    <h2 id="confirm-title-{action}-{Object.values(fields).join('-')}">{title}</h2>
    <p>{@render children()}</p>
    <div class="buttons">
      <button type="submit" formmethod="dialog" formnovalidate class="yk-btn yk-btn--ghost">Cancel</button>
      <button type="submit" class="yk-btn yk-btn--danger">{label}</button>
    </div>
  </form>
</dialog>
