import type { ReactNode } from 'react';
import type { ViewerMode } from './CanvasHeader';
import type { PopoverName } from './keymap';

/**
 * What a shell (desktop now, phone later) lays out. The session owns state and actions; `viewer` is the
 * engraving element and `banners` the read-only and notice banners, both placed by the shell.
 */
export type ShellProps = {
  viewer: ReactNode;
  banners: ReactNode;
  popover: PopoverName | null;
  closePopover(): void;
  playing: boolean;
  licence: { editable: boolean; checking: boolean; maxStaves: number };
  viewerMode: ViewerMode;
  setViewerMode(mode: ViewerMode): void;
  savedAt: Date | null;
  /** Changes after every viewer draw and highlight change (overlays re-measure the engraving). */
  drawn: unknown;
  onPlay(): void;
  onSave(): void;
  onExport(): void;
  onOpen(file: File): void;
  onReport(): void;
};
