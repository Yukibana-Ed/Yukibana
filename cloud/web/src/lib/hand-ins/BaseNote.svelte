<script lang="ts">
  import Chip from '../Chip.svelte';
  import { outdated, versionName, type Base, type HandIn } from '../hand-ins';
  /** What a submission was built on: a warning naming the version when it
   *  is not the newest release, a quiet "latest" when it is, "starter
   *  unknown" when it did not say. The exact versions are in the tooltip,
   *  not the text. `newest` is the project's newest release. */
  let { handIn, newest }: { handIn: HandIn; newest: Base } = $props();
</script>

{#if handIn.base === null}
  <span class="muted small" title="The archive did not say which starter it was built on.">starter unknown</span>
{:else if outdated(handIn)}
  <Chip tone="warn" title="Built on {versionName(handIn.base)}; the newest release is {versionName(newest)}.">on {versionName(handIn.base)}</Chip>
{:else}
  <span class="muted small" title="Built on {versionName(handIn.base)}, the newest release.">latest</span>
{/if}
