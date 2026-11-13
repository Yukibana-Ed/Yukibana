<script lang="ts" module>
  /** The icons the cloud draws: thin outlines, stroke 1.5, Lucide style. */
  export type IconName = 'check' | 'circle' | 'pencil' | 'alert' | 'clock' | 'chevron-down' | 'x' | 'monitor' | 'sun' | 'moon';

  const PATHS: Record<IconName, string> = {
    check: 'm5 12 5 5 9-10',
    circle: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18',
    pencil: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
    alert: 'M12 3 2 20h20zM12 10v4M12 17v.5',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M12 7v5l3 2',
    'chevron-down': 'm6 9 6 6 6-6',
    x: 'M6 6l12 12M18 6 6 18',
    monitor: 'M3 5h18v11H3zM8 20h8M12 16v4',
    sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
    moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5',
  };
</script>

<script lang="ts">
  /** One icon, in the text's colour. Decorative: the words beside it say what it means. */
  let { name }: { name: IconName } = $props();
</script>

<svg class="yk-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={PATHS[name]} /></svg>
