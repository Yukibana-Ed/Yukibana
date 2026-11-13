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
  <div class="segments">
    {#each THEMES as t (t)}
      <label>
        <input type="radio" name="theme" value={t} checked={theme === t} onchange={() => choose(t)} />
        <Icon name={ICON[t]} />{LABEL[t]}
      </label>
    {/each}
  </div>
</fieldset>

<style>
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
  .segments {
    display: flex;
  }
  /* One line between two segments, drawn once by the later one: overlapped borders come out uneven. */
  label {
    flex: 1 1 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 4px 8px;
    border: 1px solid var(--yk-line-strong);
    background: var(--yk-surface);
    color: var(--yk-soft);
    font-size: var(--yk-font-size-xs);
    font-weight: var(--yk-font-weight-semibold);
    white-space: nowrap;
    cursor: pointer;
    transition: background-color var(--yk-motion-fast);
  }
  label:not(:last-child) {
    border-right-width: 0;
  }
  label:first-child {
    border-radius: var(--yk-radius-sm) 0 0 var(--yk-radius-sm);
  }
  label:last-child {
    border-radius: 0 var(--yk-radius-sm) var(--yk-radius-sm) 0;
  }
  label:hover {
    background: var(--yk-sunken);
  }
  /* The chosen one, as a pressed toggle: filled, in ink, outlined in ink on all four sides. */
  label:has(input:checked) {
    border-color: var(--yk-ink);
    background: var(--yk-sunken);
    color: var(--yk-ink);
  }
  label:has(input:checked) + label {
    border-left-color: var(--yk-ink);
  }
  label:has(input:focus-visible) {
    position: relative;
    z-index: 1;
    outline: var(--yk-focus-width) solid var(--yk-ink);
    outline-offset: var(--yk-focus-offset);
  }
  input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
</style>
