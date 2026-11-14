<script lang="ts">
  import type { Tab } from './tabs';
  /** The page's sections as links (yk-tabs). `current` is the one showing. */
  let { tabs, current }: { tabs: readonly Tab[]; current: string } = $props();
</script>

{#if tabs.length > 1}
  <nav class="yk-tabs" aria-label="Sections">
    {#each tabs as t (t.id)}
      <a href="?tab={t.id}" aria-current={t.id === current ? 'page' : undefined}>
        <span class="label" data-label={t.label}>{t.label}</span>{#if t.count !== undefined}<span class="yk-chip">{t.count}</span>{/if}
      </a>
    {/each}
  </nav>
{/if}
