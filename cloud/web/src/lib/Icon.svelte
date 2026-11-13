<script lang="ts" module>
  /** The icons the cloud draws: thin outlines, stroke 1.5, Lucide style. */
  export type IconName = 'check' | 'circle' | 'pencil' | 'alert' | 'clock' | 'chevron-down' | 'x';

  const PATHS: Record<IconName, string> = {
    check: 'm5 12 5 5 9-10',
    circle: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18',
    pencil: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
    alert: 'M12 3 2 20h20zM12 10v4M12 17v.5',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M12 7v5l3 2',
    'chevron-down': 'm6 9 6 6 6-6',
    x: 'M6 6l12 12M18 6 6 18',
  };
</script>

<script lang="ts">
  /** One icon, in the text's colour. Decorative: the words beside it say what it means. */
  let { name }: { name: IconName } = $props();
</script>

<svg class="yk-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={PATHS[name]} /></svg>
