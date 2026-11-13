<script lang="ts">
  import Chip from '../Chip.svelte';
  import type { Standing } from '../hand-ins';
  /** How a student stands, as a chip: nothing yet, late, or on time. */
  let { standing }: { standing: Standing } = $props();
</script>

{#if standing === 'missing'}
  <Chip tone="open">not submitted</Chip>
{:else if standing === 'late'}
  <Chip tone="late">late</Chip>
{:else}
  <Chip tone="done">on time</Chip>
{/if}
