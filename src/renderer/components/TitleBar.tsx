import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import appLogo from '../assets/mountain-river.png';

/** Keep in sync with main BrowserWindow titleBarOverlay.height */
export const TITLE_BAR_HEIGHT = 36;
/** Logo inset from title-bar top / bottom / left edge */
const TITLE_LOGO_INSET = 10;
/** 36 − 10 − 10 */
const TITLE_LOGO_SIZE = TITLE_BAR_HEIGHT - TITLE_LOGO_INSET * 2;

type MenuId = 'file' | 'view' | 'help';

type MenuItem =
  | { type: 'item'; label: string; onClick: () => void; danger?: boolean }
  | { type: 'sep' };

export interface TitleBarProps {
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  onOpenStyleStudio: () => void;
  onOpenTaskHistory: () => void;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
}

function MenuButton({
  id,
  label,
  open,
  anyOpen,
  onOpen,
  onClose,
  items,
}: {
  id: string;
  label: string;
  open: boolean;
  anyOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  items: MenuItem[];
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <div ref={ref} className="relative titlebar-no-drag flex h-full items-center">
      <button
        type="button"
        className={clsx(
          'inline-flex h-6 items-center justify-center px-2 rounded text-[12px] leading-none text-slate-700 hover:bg-slate-100',
          open && 'bg-slate-100'
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={`titlebar-menu-${id}`}
        onClick={() => (open ? onClose() : onOpen())}
        onMouseEnter={() => {
          if (anyOpen) onOpen();
        }}
      >
        {label}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-[100] mt-0.5 min-w-[200px] rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {items.map((item, i) =>
            item.type === 'sep' ? (
              <div key={`sep-${i}`} className="my-1 border-t border-slate-100" />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={clsx(
                  'flex w-full items-center px-3 py-1.5 text-left text-[12px] hover:bg-sky-50',
                  item.danger ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-800'
                )}
                onClick={() => {
                  onClose();
                  item.onClick();
                }}
              >
                {item.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

/** Thin Electron chrome row: logo + menus + drag area + OS window controls. */
export function TitleBar({
  onOpenSettings,
  onOpenHelp,
  onOpenStyleStudio,
  onOpenTaskHistory,
  onToggleLeftPanel,
  onToggleRightPanel,
}: TitleBarProps) {
  const { t } = useTranslation();
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const isMac = window.api.platform === 'darwin';
  const anyOpen = openMenu !== null;
  const closeMenus = () => setOpenMenu(null);

  const openOutput = async () => {
    const resolved = await window.api.resolveOutputDir();
    if (resolved.ok && resolved.data) await window.api.openFolder(resolved.data);
  };

  const fileItems: MenuItem[] = [
    { type: 'item', label: t('menu.openOutput'), onClick: () => void openOutput() },
    { type: 'item', label: t('menu.settings'), onClick: onOpenSettings },
    { type: 'sep' },
    {
      type: 'item',
      label: t('menu.quit'),
      onClick: () => void window.api.quit(),
      danger: true,
    },
  ];

  const viewItems: MenuItem[] = [
    { type: 'item', label: t('menu.toggleRegion'), onClick: onToggleLeftPanel },
    { type: 'item', label: t('menu.toggleTasks'), onClick: onToggleRightPanel },
    { type: 'sep' },
    { type: 'item', label: t('menu.styleStudio'), onClick: onOpenStyleStudio },
    { type: 'item', label: t('menu.allTasks'), onClick: onOpenTaskHistory },
  ];

  const helpItems: MenuItem[] = [
    { type: 'item', label: t('menu.helpGuide'), onClick: onOpenHelp },
  ];

  return (
    <div className="shrink-0">
      <div
        className="bg-white"
        style={{ height: `env(titlebar-area-height, ${TITLE_BAR_HEIGHT}px)` }}
      >
        <header
          className="titlebar-drag relative z-40 flex h-full items-center select-none"
          style={{
            width: isMac ? '100%' : `env(titlebar-area-width, 100%)`,
            marginLeft: isMac ? undefined : `env(titlebar-area-x, 0px)`,
          }}
          data-testid="titlebar"
        >
          {isMac ? <div className="w-[72px] shrink-0" aria-hidden /> : null}

          <div className="titlebar-no-drag flex h-full items-center">
            {/*
              36px bar → 10px inset (L/T/B) → 16px logo.
              No right padding so it doesn't stack with File's px-2.
            */}
            <div
              className="flex shrink-0 items-center box-border"
              style={{
                height: TITLE_BAR_HEIGHT,
                paddingTop: TITLE_LOGO_INSET,
                paddingBottom: TITLE_LOGO_INSET,
                paddingLeft: TITLE_LOGO_INSET,
                paddingRight: 0,
              }}
            >
              <img
                src={appLogo}
                alt=""
                width={TITLE_LOGO_SIZE}
                height={TITLE_LOGO_SIZE}
                className="rounded-sm object-cover ring-1 ring-slate-200/80"
                style={{ width: TITLE_LOGO_SIZE, height: TITLE_LOGO_SIZE }}
                draggable={false}
              />
            </div>
            <div className="flex h-full items-center gap-0.5">
              <MenuButton
                id="file"
                label={t('menu.file')}
                open={openMenu === 'file'}
                anyOpen={anyOpen}
                onOpen={() => setOpenMenu('file')}
                onClose={closeMenus}
                items={fileItems}
              />
              <MenuButton
                id="view"
                label={t('menu.view')}
                open={openMenu === 'view'}
                anyOpen={anyOpen}
                onOpen={() => setOpenMenu('view')}
                onClose={closeMenus}
                items={viewItems}
              />
              <MenuButton
                id="help"
                label={t('menu.help')}
                open={openMenu === 'help'}
                anyOpen={anyOpen}
                onOpen={() => setOpenMenu('help')}
                onClose={closeMenus}
                items={helpItems}
              />
            </div>
          </div>

          <div className="min-w-4 flex-1 self-stretch" aria-hidden />
        </header>
      </div>
      {/* Full-width rule below titleBarOverlay — border on the chrome row is covered by OS caption buttons. */}
      <div className="h-px w-full bg-slate-200" aria-hidden />
    </div>
  );
}
