<script lang="ts">
  import { outdated, versionName, type HandIn } from '../hand-ins';
  /** What a submission was built on, said only when it matters: a warning
   *  with the version when it is not the newest release, a quiet word
   *  otherwise. `latest` is the newest release's version. `quiet` leaves out
   *  the word for an up-to-date one, for a list where only the exceptions
   *  should catch the eye. */
  let { handIn, latest, quiet = false }: { handIn: HandIn; latest: number; quiet?: boolean } = $props();
</script>

{#if handIn.base === null}
  {#if !quiet}<span class="muted small" title="The archive did not say which starter it was built on.">starter unknown</span>{/if}
{:else if outdated(handIn)}
  <span class="chip warn" title="Built on {versionName(handIn.base)}; the newest release is v{latest}.">
    ⚠ on {versionName(handIn.base)} · latest v{latest}
  </span>
{:else if !quiet}
  <span class="muted small">latest starter (v{handIn.base.version})</span>
{/if}

<style>
  /* Not an error, and not the red of "late": amber, something to look at. */
  .chip.warn {
    background: light-dark(#fff4e0, #33250c);
    border-color: light-dark(#f0c36d, #6b4d14);
    color: light-dark(#8a5300, #ffc66b);
  }
</style>
