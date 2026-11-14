<script lang="ts">
  import { onMount } from 'svelte';
  import { cover, MAX_ZOOM, panned, zoomed, type View } from './crop';
  import { decode, encode } from './encode';

  /** The dialog in which a person frames the image they chose as their profile picture: drag to move it, the slider
   *  or the wheel to zoom, the round mask showing what others will see. Imported by a page only once a file is chosen
   *  (`import('#lib/picture/PictureCropper.svelte')`), so it, its styles and the encoder cost nothing until then.
   *
   *  `save` gets the finished WebP (`encode`) and resolves once it is stored, or rejects with a sentence for the
   *  person, which is shown here and keeps the dialog open; `close` is called when the person cancels, and after a
   *  save that succeeded. */
  let { file, save, close }: { file: File; save: (picture: Blob) => Promise<void>; close: () => void } = $props();

  /** The preview's side in CSS pixels; the canvas has as many device pixels as the screen does. */
  const FRAME = 288;
  let dialog: HTMLDialogElement;
  let canvas: HTMLCanvasElement | undefined = $state();
  let image: ImageBitmap | null = $state(null);
  let view: View | null = $state(null);
  let problem = $state('');
  let busy = $state(false);
  let drag: { id: number; x: number; y: number } | null = null;

  onMount(() => {
    dialog.showModal();
    let cancelled = false;
    decode(file).then(
      (bitmap) => {
        if (cancelled) return bitmap.close();
        image = bitmap;
        view = cover(bitmap.width, bitmap.height);
      },
      (e: unknown) => (problem = e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
      image?.close();
    };
  });

  $effect(() => {
    if (canvas === undefined || image === null || view === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, view.x, view.y, view.side, view.side, 0, 0, canvas.width, canvas.height);
  });

  /** Moves the image by (`dx`, `dy`) CSS pixels on screen. */
  function move(dx: number, dy: number): void {
    if (image === null || view === null) return;
    const scale = view.side / FRAME;
    view = panned(view, image.width, image.height, dx * scale, dy * scale);
  }

  function zoom(to: number): void {
    if (image !== null && view !== null) view = zoomed(view, image.width, image.height, to);
  }

  function pointerdown(e: PointerEvent): void {
    if (drag !== null) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }

  function pointermove(e: PointerEvent): void {
    if (drag?.id !== e.pointerId) return;
    move(e.clientX - drag.x, e.clientY - drag.y);
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }

  function pointerup(e: PointerEvent): void {
    if (drag?.id === e.pointerId) drag = null;
  }

  function wheel(e: WheelEvent): void {
    if (view === null) return;
    e.preventDefault();
    zoom(view.zoom * Math.exp(-e.deltaY * 0.002));
  }

  function keydown(e: KeyboardEvent): void {
    const step = e.shiftKey ? 40 : 8;
    const by: Record<string, () => void> = {
      ArrowLeft: () => move(step, 0),
      ArrowRight: () => move(-step, 0),
      ArrowUp: () => move(0, step),
      ArrowDown: () => move(0, -step),
      '+': () => zoom((view?.zoom ?? 1) * 1.1),
      '=': () => zoom((view?.zoom ?? 1) * 1.1),
      '-': () => zoom((view?.zoom ?? 1) / 1.1),
    };
    const act = by[e.key];
    if (act === undefined) return;
    e.preventDefault();
    act();
  }

  async function submit(e: SubmitEvent): Promise<void> {
    // Saving keeps the dialog open until the picture is stored; Cancel is a plain button that closes it.
    e.preventDefault();
    if (image === null || view === null || busy) return;
    busy = true;
    problem = '';
    try {
      await save(await encode(image, view));
      dialog.close();
    } catch (err) {
      problem = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<dialog class="cropper" bind:this={dialog} onclose={close} aria-labelledby="cropper-title">
  <form method="dialog" onsubmit={submit}>
    <h2 id="cropper-title">Frame your picture</h2>
    <div class="frame" style:--frame="{FRAME}px">
      {#if image !== null}
        <canvas
          bind:this={canvas}
          width={Math.round(FRAME * (globalThis.devicePixelRatio ?? 1))}
          height={Math.round(FRAME * (globalThis.devicePixelRatio ?? 1))}
          tabindex="0"
          aria-label="The picture. Drag it, or use the arrow keys, to move it; plus and minus zoom."
          onpointerdown={pointerdown}
          onpointermove={pointermove}
          onpointerup={pointerup}
          onpointercancel={pointerup}
          onwheel={wheel}
          onkeydown={keydown}
        ></canvas>
        <div class="mask" aria-hidden="true"></div>
      {:else if problem === ''}
        <p class="loading">Opening the picture…</p>
      {/if}
    </div>
    <label class="zoom">
      <span>Zoom</span>
      <input
        type="range"
        min="1"
        max={MAX_ZOOM}
        step="0.01"
        value={view?.zoom ?? 1}
        disabled={view === null}
        oninput={(e) => zoom(Number(e.currentTarget.value))}
      />
    </label>
    {#if problem !== ''}<p class="problem" role="alert">{problem}</p>{/if}
    <div class="buttons">
      <button type="button" class="yk-btn yk-btn--ghost" onclick={() => dialog.close()}>Cancel</button>
      <button type="submit" class="yk-btn yk-btn--primary" disabled={view === null || busy}>{busy ? 'Saving…' : 'Save picture'}</button>
    </div>
  </form>
</dialog>

<style>
  .cropper {
    max-width: min(24rem, calc(100vw - 2rem));
    padding: var(--yk-space-6);
    border: 1px solid var(--yk-line);
    border-radius: var(--yk-radius-lg);
    background: var(--yk-surface);
    color: var(--yk-ink);
  }
  .cropper::backdrop {
    background: oklch(15% 0.02 260 / 0.45);
  }
  h2 {
    margin: 0 0 var(--yk-space-4);
  }
  .frame {
    position: relative;
    width: min(var(--frame), calc(100vw - 6rem));
    aspect-ratio: 1;
    margin-inline: auto;
    overflow: hidden;
    border-radius: var(--yk-radius-md);
    background: var(--yk-sunken);
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    cursor: grab;
    touch-action: none;
  }
  canvas:active {
    cursor: grabbing;
  }
  canvas:focus-visible {
    outline-offset: calc(-1 * var(--yk-focus-width));
  }
  /* What others see: the circle the avatar is drawn in, the rest dimmed. */
  .mask {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    box-shadow: 0 0 0 100vmax oklch(15% 0.02 260 / 0.5);
    pointer-events: none;
  }
  .loading {
    display: grid;
    place-items: center;
    height: 100%;
    margin: 0;
    color: var(--yk-soft);
  }
  .zoom {
    display: flex;
    align-items: center;
    gap: var(--yk-space-3);
    margin-top: var(--yk-space-4);
  }
  .zoom input {
    flex: 1;
    accent-color: var(--yk-accent);
  }
  .problem {
    margin: var(--yk-space-3) 0 0;
    color: var(--yk-danger);
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: var(--yk-space-2);
    margin-top: var(--yk-space-4);
  }
</style>
