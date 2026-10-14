import type { ReactNode } from 'react';
import type { ViewerMode } from './CanvasHeader';
import type { PopoverName } from './keymap';
import type { DrawSignal } from './useCanvasGeometry';

/**
 * What a shell (desktop or phone) lays out. The session owns state and actions; `viewer` is the
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
  /** Fires after every viewer draw (overlays re-measure the engraving). */
  draws: DrawSignal;
  onPlay(): void;
  onSave(): void;
  onExport(): void;
  onOpen(file: File): void;
  /** Opens a new empty score (after the discard prompt when there are unsaved changes). */
  onNew(): void;
  onReport(): void;
};
