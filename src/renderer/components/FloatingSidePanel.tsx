import type { ReactNode } from 'react';

const PANEL_MOTION = 'transition-transform duration-[280ms] ease-[cubic-bezier(0.4,0,0.2,1)] will-change-transform';

type Side = 'left' | 'right';

export function FloatingSidePanel({
  side,
  open,
  onToggle,
  width,
  label,
  children,
}: {
  side: Side;
  open: boolean;
  onToggle: () => void;
  width: number;
  /** Short label on the edge tab when collapsed */
  label: string;
  children: ReactNode;
}) {
  const isLeft = side === 'left';

  return (
    <div
      className={`absolute top-0 bottom-0 z-20 pointer-events-none ${isLeft ? 'left-0' : 'right-0'}`}
    >
      <div
        className={`flex h-full ${PANEL_MOTION} ${isLeft ? 'flex-row' : 'flex-row-reverse'}`}
        style={{
          transform: isLeft
            ? open
              ? 'translate3d(0,0,0)'
              : `translate3d(-${width}px,0,0)`
            : open
              ? 'translate3d(0,0,0)'
              : `translate3d(${width}px,0,0)`,
        }}
      >
        {/* Collapsed: no hit-testing on off-screen body so map stays interactive. */}
        <aside
          className={`h-full shrink-0 bg-white/95 backdrop-blur-md shadow-xl overflow-hidden ${
            open ? 'pointer-events-auto' : 'pointer-events-none'
          } ${isLeft ? 'border-r border-slate-200/80' : 'border-l border-slate-200/80'}`}
          style={{ width }}
          aria-hidden={!open}
        >
          <div className="h-full overflow-hidden flex flex-col">{children}</div>
        </aside>

        <button
          type="button"
          onClick={onToggle}
          className={`pointer-events-auto self-center flex flex-col items-center justify-center gap-[var(--ui-space-sm)] w-7 h-[4.5rem] text-[10px] font-medium text-slate-600 bg-white/95 backdrop-blur-md border border-slate-200/90 shadow-md hover:bg-white hover:text-slate-900 ${
            isLeft ? 'rounded-r-md border-l-0' : 'rounded-l-md border-r-0'
          }`}
          aria-expanded={open}
          aria-label={open ? `收起${label}` : `展开${label}`}
          title={open ? `收起${label}` : `展开${label}`}
        >
          <span className="text-base leading-none text-slate-500">{isLeft ? (open ? '‹' : '›') : open ? '›' : '‹'}</span>
          <span
            className="text-[9px] text-slate-400 tracking-tight"
            style={{ writingMode: 'vertical-rl' }}
          >
            {label}
          </span>
        </button>
      </div>
    </div>
  );
}
