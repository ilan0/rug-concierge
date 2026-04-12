export const CONCIERGE_LAYOUT = {
  contentMaxDesktopPx: 940,
  contentMaxTabletPx: 860,
  contentHorizontalInsetMobilePx: 24,
  contentHorizontalInsetTabletPx: 40,
  contentTopPaddingMobilePx: 64,
  contentTopPaddingDesktopPx: 72,
  contentBottomPaddingMobilePx: 172,
  contentBottomPaddingDesktopPx: 188,
  dockMaxHeightMobilePx: 104,
  dockMaxHeightDesktopPx: 112,
} as const;

export const CONCIERGE_CLASSNAMES = {
  focusRing:
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--active-accent,var(--accent-gold))] focus-visible:ring-offset-2",
  iconButton:
    "h-11 w-11 rounded-full border-[var(--active-border,var(--border-primary))] bg-[var(--active-surface,var(--surface))] text-[var(--active-text-soft,var(--text-secondary))] transition hover:border-[var(--active-border-strong,var(--border-interactive))] hover:bg-[var(--active-surface-2,var(--surface-2))]",
  utilityButton:
    "concierge-hoverable flex h-11 items-center justify-center gap-2 rounded-xl border border-[var(--active-border,var(--border-primary))] bg-[color:color-mix(in_srgb,var(--active-surface-2,var(--surface-2))_92%,white)] px-[14px] text-[14px] font-medium leading-5 tracking-[0.01em] text-[var(--active-text-soft,var(--text-secondary))] transition active:scale-[0.995]",
  assistantSurface:
    "rounded-[24px] border border-[var(--active-border,var(--border-primary))] bg-[var(--active-assistant,var(--assistant-bubble))] shadow-[var(--active-shadow-1,0_6px_18px_rgba(41,29,14,0.08))]",
  userSurface:
    "rounded-[24px] border border-[var(--active-border,var(--border-primary))] bg-[var(--active-user,var(--user-bubble))] shadow-[var(--active-shadow-1,0_6px_18px_rgba(41,29,14,0.08))]",
} as const;
