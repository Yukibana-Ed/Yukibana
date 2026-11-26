import { FOCUS_BOOT } from '@yukibana/design/focus';
import { THEME_BOOT } from '@yukibana/design/theme';

/** The design system's boot scripts as one `<script>` element, for the root layout's `<svelte:head>`: the theme's shows
 *  the theme chosen in the account menu, shared with the other Yukibana sites, before anything paints; the focus one
 *  tells a click into a field from Tab, so a clicked field gets an ink border and not the ring. It is a string here
 *  and not in the layout because oxlint, finding `<script>` in a component's markup, reads it as the start of a script
 *  block. */
export const THEME_SCRIPT = `<script>${THEME_BOOT}${FOCUS_BOOT}</script>`;
