import { themeBoot } from '@yukibana/design/theme';

/** The design system's theme boot script as a `<script>` element, for the root layout's `<svelte:head>`: it shows the
 *  theme chosen in the account menu, shared with the other Yukibana sites, before anything paints. It is a string here
 *  and not in the layout because oxlint, finding `<script>` in a component's markup, reads it as the start of a script
 *  block. */
export const THEME_SCRIPT = `<script>${themeBoot()}</script>`;
