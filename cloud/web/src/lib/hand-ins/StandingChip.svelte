<script lang="ts">
  import type { Standing } from '../hand-ins';
  /** How a student stands, as a chip: nothing yet, late, or on time. */
  let { standing }: { standing: Standing } = $props();
</script>

{#if standing === 'missing'}
  <span class="chip">not submitted</span>
{:else if standing === 'late'}
  <span class="chip late">late</span>
{:else}
  <span class="chip good">on time</span>
{/if}
