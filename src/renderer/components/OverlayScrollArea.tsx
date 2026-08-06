import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from 'react';
import { clsx } from 'clsx';

/**
 * Scroll container with a custom overlay scrollbar.
 * Native bar is hidden so content width never shifts; the thin thumb sits in
 * the existing right padding when overflow is needed.
 */
export function OverlayScrollArea({
  children,
  className,
  contentClassName,
}: {
  children: ReactNode;
  className?: string;
  /** Extra classes on the inner scrollport (e.g. padding / gap). */
  contentClassName?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ visible: boolean; top: number; height: number }>({
    visible: false,
    top: 0,
    height: 0,
  });

  const syncThumb = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const overflow = scrollHeight > clientHeight + 1;
    if (!overflow) {
      setThumb((prev) => (prev.visible ? { visible: false, top: 0, height: 0 } : prev));
      return;
    }
    const ratio = clientHeight / scrollHeight;
    const height = Math.max(16, Math.round(clientHeight * ratio));
    const maxTop = clientHeight - height;
    const top =
      scrollHeight === clientHeight
        ? 0
        : Math.round((scrollTop / (scrollHeight - clientHeight)) * maxTop);
    setThumb({ visible: true, top, height });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    syncThumb();
    const ro = new ResizeObserver(() => syncThumb());
    ro.observe(el);
    // Content size changes (task cards added/removed)
    const mo = new MutationObserver(() => syncThumb());
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [syncThumb]);

  const onScroll = (_e: UIEvent) => {
    syncThumb();
  };

  return (
    <div className={clsx('relative min-h-0 flex-1 overflow-hidden', className)}>
      <div
        ref={ref}
        onScroll={onScroll}
        className={clsx('overlay-scroll-host h-full overflow-y-auto', contentClassName)}
      >
        {children}
      </div>
      {thumb.visible ? (
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-3"
          aria-hidden
        >
          <div
            className="absolute right-0.5 w-0.5 rounded-full bg-slate-300/90"
            style={{ top: thumb.top, height: thumb.height }}
          />
        </div>
      ) : null}
    </div>
  );
}
