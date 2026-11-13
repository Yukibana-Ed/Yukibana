<script lang="ts">
  /** A button that puts `text` on the clipboard and says whether it did.
   *  Where the clipboard is out of reach (an insecure origin, a denied
   *  permission) it says so, and the text stays on screen beside it to be
   *  selected by hand.
   *
   *  `plain` draws it as the underlined text a notice's own buttons are
   *  (Retry, in yk-toast), rather than as a secondary button: the package
   *  leaves a yk-btn in a notice looking like itself. */
  let { text, label = 'Copy details', plain = false }: { text: string; label?: string; plain?: boolean } = $props();
  let said = $state('');

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      said = 'Copied';
    } catch {
      said = 'Could not copy; select the text instead';
    }
    setTimeout(() => (said = ''), 3000);
  }
</script>

<button type="button" class={plain ? undefined : 'yk-btn yk-btn--secondary'} data-done={said === 'Copied' ? '' : undefined} onclick={copy}>{said === '' ? label : said === 'Copied' ? '✓ Copied' : said}</button>
