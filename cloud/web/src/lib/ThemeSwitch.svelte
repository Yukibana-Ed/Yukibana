<script lang="ts">
  import { onMount } from 'svelte';
  import Icon, { type IconName } from './Icon.svelte';
  import { THEMES, applyTheme, readTheme, writeTheme, type Theme } from './theme';

  /** The theme, in the account menu: System, Light or Dark, as one segmented control. Native radio buttons, so the
   *  arrow keys move between them and a screen reader hears one choice of three. The choice is this browser's
   *  (#lib/theme); app.html applied it before the page painted, and this only reads it back. */
  const LABEL: Record<Theme, string> = { system: 'System', light: 'Light', dark: 'Dark' };
  const ICON: Record<Theme, IconName> = { system: 'monitor', light: 'sun', dark: 'moon' };

  let theme = $state<Theme>('system');
  onMount(() => {
    theme = readTheme(storage());
  });

  function storage(): Storage | undefined {
    try {
      return window.localStorage;
    } catch {
      return undefined;
    }
  }

  function choose(next: Theme) {
    theme = next;
    writeTheme(storage(), next);
    applyTheme(document.documentElement, next);
  }
</script>

<fieldset class="theme-switch">
  <legend>Theme</legend>
  <div class="yk-segmented">
    {#each THEMES as t (t)}
      <label>
        <input type="radio" name="theme" value={t} checked={theme === t} onchange={() => choose(t)} />
        <Icon name={ICON[t]} />{LABEL[t]}
      </label>
    {/each}
  </div>
</fieldset>

<style>
  /* The segmented control is the package's (yk-segmented). What is the menu's own: the fieldset's frame and legend, the
     row as wide as the menu with three equal segments, and the menu's smaller type and padding. */
  .theme-switch {
    margin: 0;
    padding: 4px 10px 6px;
    border: 0;
    min-width: 0;
  }
  legend {
    padding: 0 0 6px;
    color: var(--yk-soft);
    font-size: var(--yk-font-size-xs);
  }
  .yk-segmented {
    display: flex;
  }
  .yk-segmented > label {
    flex: 1 1 0;
    gap: 4px;
    padding: 4px 8px;
    font-size: var(--yk-font-size-xs);
    line-height: inherit;
  }
</style>
