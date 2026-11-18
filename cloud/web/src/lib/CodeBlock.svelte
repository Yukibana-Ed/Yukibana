<script lang="ts">
  import Icon from './Icon.svelte';
  import { highlight, type Language } from './highlight.ts';
  /** A code block as an Expressive Code frame, the docs site's look (the design system's yk-code): with a `title` (a
   *  file) it has the dock bar with the file as its one tab and Copy at its end; without one (a command, a secret) no
   *  header, and Copy in the corner, shown on hover, on keyboard focus, and always on a touch screen.
   *
   *  Copy takes the code without a shell prompt, which the block draws but does not let be selected either. Its icon
   *  turns into a tick for two seconds and a screen reader hears "Copied"; where the browser refuses the clipboard it
   *  says "Copy failed", and the code stays on screen to be selected by hand. */
  let { code, language = 'text', title }: { code: string; language?: Language; title?: string } = $props();
  const lines = $derived(highlight(code, language));
  const copied = $derived(lines.map((l) => l.filter((t) => !t.prompt).map((t) => t.text).join('')).join('\n'));
  let state = $state<'idle' | 'done' | 'failed'>('idle');
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => () => clearTimeout(timer));
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(copied);
      state = 'done';
    } catch {
      state = 'failed';
    }
    clearTimeout(timer);
    timer = setTimeout(() => (state = 'idle'), 2000);
  }
  const label = $derived(state === 'done' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy');
</script>

{#snippet button()}
  <button type="button" class="yk-icon-btn" onclick={copy} aria-label={label} title={label}>
    <span class="sr-only" aria-live="polite">{state === 'idle' ? '' : label}</span>
    <Icon name={state === 'done' ? 'check' : 'copy'} />
  </button>
{/snippet}

<!-- The lines are one <pre> of <span>s, written on one line: whitespace between them would be shown. -->
<figure class="yk-code code-block" class:yk-code--terminal={title === undefined} dir="ltr">
  {#if title !== undefined}
    <div class="yk-dock"><span class="yk-dock-tab">{title}</span><span class="yk-dock-actions">{@render button()}</span></div>
  {/if}
  <pre>{#each lines as line, i (i)}<span>{#each line as t, j (j)}{#if t.prompt}<span class="tok-prompt">{t.text}</span>{:else if t.color === null}{t.text}{:else}<span style:color={t.color}>{t.text}</span>{/if}{/each}{line.every((t) => t.text === '') ? '\u200b' : ''}</span>{/each}</pre>
  <!-- After the code, so it paints above it (yk-code--terminal). -->
  {#if title === undefined}{@render button()}{/if}
</figure>
