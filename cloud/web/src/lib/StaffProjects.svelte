<script module lang="ts">
  import type { EditionId, ProjectId } from './ids';

  /** One project as staff see it in an edition's list: a row of the edition
   *  page's load, field names the database's. */
  export interface StaffProject {
    /** The project, and the row's key: the list holds each id once. */
    readonly project_id: ProjectId;
    /** Its title, the row's link text. */
    readonly title: string;
    /** Its kind, one of `KINDS` (#lib/kinds), as text, shown as a chip. */
    readonly kind: string;
    /** When students may first see and submit to it; null for a draft,
     *  which is shown as one. */
    readonly available_after: Date | null;
    /** Its deadline, or null for none. */
    readonly deadline: Date | null;
    /** When submissions stop, or null for never. */
    readonly closes_at: Date | null;
    /** How many releases it has, ever. */
    readonly releases: number;
    /** `true` iff the project has at least one release: `app.current_starter`
     *  asked as staff, who see a starter whatever the window. It says
     *  nothing about whether students can download one now. */
    readonly ready: boolean;
  }

  /** What the edition page passes in. */
  export interface StaffProjectsProps {
    /** The projects, in the order the server has them: `position`, then
     *  creation. Each new value replaces whatever order the screen had. */
    rows: readonly StaffProject[];
    /** The edition the rows are in, for their links. */
    editionId: EditionId;
    /** `true` iff the database would accept a move (`app.may_edit_projects`):
     *  only then are the handles drawn and moves sent. */
    reorder: boolean;
  }
</script>

<script lang="ts">
  import { beforeNavigate } from '$app/navigation';
  import { tick } from 'svelte';
  import { postAction } from './action';
  import { when } from './format';
  import { viewer } from './viewer.svelte';
  import { changed, hold } from './live.svelte';
  import { move, movesTo, type Step } from './order';
  import { dismiss, toast, toasts } from './toast.svelte';
  import { followRow } from './row-link';
  import Chip from './Chip.svelte';
  import Empty from './Empty.svelte';

  /** An edition's projects for staff, in the order students see them.
   *
   *  With `reorder`, each row can be dragged, or moved with the arrow keys on
   *  its handle, and every move is saved as it is made: the list changes on
   *  screen first and goes back, with a toast saying why, if the server
   *  refuses. Moves are sent one after another, in the order they were made,
   *  because each is placed between neighbours as the server has them.
   *  Leaving while one is on its way asks first. Without `reorder` (the
   *  database said this person may not), none of that is drawn at all.
   *
   *  Changes others make arrive live (see live.svelte.ts), but not during a
   *  drag or while a move is unsaved: the list would jump under the pointer,
   *  or briefly show the server's older order.
   *
   *  - Requires: the page it is on is the edition page, whose `move`
   *    action every move is posted to (`?tab=projects&/move`, relative to
   *    the current address). Not checked: anywhere else the post fails and
   *    each move is undone with a toast. */
  let { rows, editionId, reorder }: StaffProjectsProps = $props();

  const byId = $derived(new Map(rows.map((p) => [p.project_id, p] as const)));
  // Follows `rows` whenever the page reloads, and is overridden by a move in
  // the meantime.
  let order = $derived(rows.map((p) => p.project_id));
  let dragging = $state<number | null>(null);
  let over = $state<number | null>(null);
  let saving = $state(0);
  let failed = false;
  let queue: Promise<void> = Promise.resolve();

  // Taken again whenever the rows are, so "late window" follows the clock on
  // a page left open.
  const now = $derived.by(() => {
    void rows;
    return Date.now();
  });
  const past = (d: Date | null): boolean => d !== null && new Date(d).getTime() <= now;

  // The order this person last made on screen: what Retry asks the server
  // for. Read when Retry is pressed, not when the move was refused, so a
  // retry after further moves sends the latest order and never an older one.
  let wanted: readonly ProjectId[] = [];

  function commit(from: number, to: number): void {
    const moved = move(order, from, to);
    const item = moved?.items[to];
    if (moved === null || item === undefined) return;
    send([{ ...moved, item }]);
  }

  /** Shows the last of `steps` at once and sends them all, one after
   *  another, behind any moves still on their way. */
  function send(steps: readonly Step<ProjectId>[]): void {
    const last = steps.at(-1);
    if (last === undefined) return;
    const previous = order;
    order = wanted = last.items;
    for (const step of steps) {
      saving += 1;
      queue = queue
        .then(() => postAction('?tab=projects&/move', { project: step.item, after: step.after ?? '', before: step.before ?? '' }))
        .catch((e: unknown) => {
          order = previous;
          failed = true;
          toast(`The new order was not saved: ${e instanceof Error ? e.message : String(e)}`, null, retry);
        })
        .finally(() => {
          saving -= 1;
          // Moves queued after a refused one were placed on top of it, so
          // undoing it on screen is only a guess; once the queue is empty,
          // show the order the server actually has.
          if (saving === 0 && failed) {
            failed = false;
            changed();
          }
        });
    }
  }

  /** Retry, on the toast of a refused move: sends what it takes to turn the
   *  order on screen now (the server's, once it has reloaded) into the
   *  latest one this person made. Projects added or deleted meanwhile are
   *  left where they are (#lib/order `movesTo`). */
  const retry = (): void => send(movesTo(order, wanted));

  // Retry posts to this page's action and moves this list: once the list is
  // gone it could do neither, so its toasts go with it.
  $effect(() => () => {
    for (const t of toasts.filter((t) => t.retry === retry)) dismiss(t.id);
  });

  async function onkey(e: KeyboardEvent, i: number): Promise<void> {
    const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : null;
    if (to === null) return;
    e.preventDefault();
    const id = order[i];
    commit(i, to);
    // The row is drawn again in its new place; keep the focus on its handle
    // so the next arrow key moves it further.
    await tick();
    document.querySelector<HTMLButtonElement>(`[data-handle="${id}"]`)?.focus();
  }

  /** What makes row `i` draggable: attributes and handlers, spread onto the
   *  row only when reordering is allowed. */
  function draggableRow(id: string, i: number) {
    return {
      draggable: true,
      ondragstart: (e: DragEvent) => {
        dragging = i;
        e.dataTransfer?.setData('text/plain', id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      },
      ondragover: (e: DragEvent) => {
        if (dragging === null) return;
        e.preventDefault();
        over = i;
      },
      ondrop: (e: DragEvent) => {
        e.preventDefault();
        if (dragging !== null) commit(dragging, i);
        dragging = over = null;
      },
      ondragend: () => {
        dragging = over = null;
      },
    };
  }

  // One boolean, so the hold is taken and released only at its edges: an
  // effect on `saving` itself would release and retake it on every move, and
  // a release with news waiting reloads the list mid-save.
  const busy = $derived(saving > 0 || dragging !== null);
  $effect(() => (busy ? hold() : undefined));

  // A tab being closed gets the browser's own question; a link inside the
  // site gets ours.
  beforeNavigate((nav) => {
    if (saving === 0) return;
    if (nav.type === 'leave') nav.cancel();
    else if (!confirm('The new order is still being saved. Leave anyway?')) nav.cancel();
  });
</script>

{#if order.length === 0}
  <Empty title="No projects yet">A project is one exercise: its starter, its tests and its dates.</Empty>
{:else}
  {#if reorder}<p class="note">Drag a project to change the order students see. Changes are saved as you drop.</p>{/if}
  <div class="scroll">
    <table class="yk-table projects">
      <thead>
        <tr>
          {#if reorder}<th><span class="sr-only">Order</span></th>{/if}
          <th>Project</th><th>Opens</th><th>Deadline</th><th>Closes</th><th>Releases</th>
        </tr>
      </thead>
      <tbody>
        {#each order as id, i (id)}
          {@const p = byId.get(id)}
          {#if p}
            <tr
              data-href="/editions/{editionId}/projects/{p.project_id}"
              onclick={followRow}
              {...(reorder ? draggableRow(id, i) : {})}
              class:dragging={dragging === i}
              class:over={over === i && dragging !== null && dragging !== i}
            >
              {#if reorder}
                <td class="grip">
                  <button type="button" class="handle" data-handle={id} aria-label="Move {p.title}: drag, or use the up and down arrow keys" title="Drag to reorder" onkeydown={(e) => onkey(e, i)}>⠿</button>
                </td>
              {/if}
              <td>
                <a href="/editions/{editionId}/projects/{p.project_id}">{p.title}</a>
                <Chip tone="info">{p.kind}</Chip>
                {#if p.available_after === null}<Chip tone="draft">draft</Chip>{/if}
                {#if !p.ready}<Chip>no starter yet</Chip>{/if}
              </td>
              <td>{when(p.available_after, viewer.zone)}</td>
              <td>{when(p.deadline, viewer.zone)}{#if past(p.deadline) && !past(p.closes_at)} <Chip tone="late">late window</Chip>{/if}</td>
              <td>{p.closes_at === null ? 'never' : when(p.closes_at, viewer.zone)}</td>
              <td>{p.releases}</td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </div>
{/if}
