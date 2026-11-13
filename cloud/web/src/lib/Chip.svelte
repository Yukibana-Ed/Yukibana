<script lang="ts" module>
  import type { IconName } from './Icon.svelte';

  /** What a chip says about its word: its hue, and for a status the icon that says it without colour. */
  export type ChipTone = 'plain' | 'done' | 'open' | 'draft' | 'late' | 'warn' | 'info';

  const LOOK: Record<ChipTone, { readonly hue: string; readonly icon: IconName | null }> = {
    plain: { hue: '', icon: null },
    // Green is also the accent, so success never relies on it: a check says it.
    done: { hue: 'yk-chip--green', icon: 'check' },
    open: { hue: 'yk-chip--yellow', icon: 'circle' },
    draft: { hue: '', icon: 'pencil' },
    late: { hue: 'yk-chip--danger', icon: 'clock' },
    warn: { hue: 'yk-chip--yellow', icon: 'alert' },
    info: { hue: 'yk-chip--blue', icon: null },
  };
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  /** A word that is a value rather than prose (a role, a state, a kind), as a tinted pill (yk-chip). */
  let { tone = 'plain', title, children }: { tone?: ChipTone; title?: string; children: Snippet } = $props();
  const look = $derived(LOOK[tone]);
</script>

<span class="yk-chip {look.hue}" {title}>{#if look.icon}<Icon name={look.icon} />{/if}{@render children()}</span>
