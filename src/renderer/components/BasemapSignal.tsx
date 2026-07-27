/** Bar heights (px): left tallest → right shortest. */
const BAR_HEIGHTS = [12, 10, 8, 6, 4] as const;
const BAR_COUNT = BAR_HEIGHTS.length;

/** Total width of the 5-bar indicator (must match ROW_GRID signal column). */
export const SIGNAL_BARS_WIDTH_PX = 14;

export type BasemapProbeStatus = { ok: boolean; latency: number };

type BarTone = 'idle' | 'green' | 'red';

const TONE_CLASS: Record<BarTone, string> = {
  idle: 'bg-slate-200',
  green: 'bg-emerald-500',
  red: 'bg-rose-500',
};

/**
 * Good latency: fill from left with green (more bars = faster).
 * Bad / timeout: only right short bars red, tall left bars stay idle gray.
 */
export function getBarTones(status?: BasemapProbeStatus): BarTone[] {
  const idle = (): BarTone[] => Array(BAR_COUNT).fill('idle');

  if (!status) return idle();

  if (!status.ok || status.latency < 0) {
    return ['idle', 'idle', 'idle', 'red', 'red'];
  }

  const ms = status.latency;
  if (ms < 150) return ['green', 'green', 'green', 'green', 'green'];
  if (ms < 400) return ['green', 'green', 'green', 'green', 'idle'];
  if (ms < 800) return ['green', 'green', 'green', 'idle', 'idle'];
  if (ms < 1500) return ['green', 'green', 'idle', 'idle', 'idle'];
  if (ms < 3000) return ['green', 'idle', 'idle', 'idle', 'idle'];
  return ['idle', 'idle', 'idle', 'red', 'red'];
}

export function formatProbeLatency(status?: BasemapProbeStatus): string {
  if (!status) return '—';
  if (!status.ok || status.latency < 0) return '超时';
  return `${status.latency} ms`;
}

/** Five vertical bars — signal strength indicator only (no latency text). */
export function SignalBars({
  status,
  className = '',
}: {
  status?: BasemapProbeStatus;
  className?: string;
}) {
  const tones = getBarTones(status);
  const lit = tones.filter((t) => t !== 'idle').length;

  return (
    <div
      className={`grid grid-cols-5 gap-px h-3.5 shrink-0 items-end ${className}`}
      style={{ width: SIGNAL_BARS_WIDTH_PX }}
      aria-label={lit ? `信号 ${lit}/${BAR_COUNT}` : '未测速'}
      title={status ? formatProbeLatency(status) : undefined}
    >
      {BAR_HEIGHTS.map((h, i) => (
        <span
          key={i}
          className={`w-full min-w-0 rounded-[1px] ${TONE_CLASS[tones[i]]}`}
          style={{ height: h }}
        />
      ))}
    </div>
  );
}
