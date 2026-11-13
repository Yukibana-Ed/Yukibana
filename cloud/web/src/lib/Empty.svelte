<script lang="ts">
  import type { Snippet } from 'svelte';
  /** What a list says when it has nothing in it (yk-empty): centred, a patch of the lattice, a title, one sentence,
   *  and at most one button. Said here, so no page invents its own way of being empty. */
  let { title, children, action }: { title: string; children?: Snippet; action?: Snippet } = $props();
</script>

<div class="yk-empty">
  <b>{title}</b>
  {#if children}<p>{@render children()}</p>{/if}
  {#if action}{@render action()}{/if}
</div>
