import { create } from "zustand";

interface PaletteState {
  readonly open: boolean;
  /** Text the palette starts with, e.g. a link prefix. */
  readonly initialQuery?: string;
}

export const usePaletteStore = create<PaletteState>(() => ({ open: false }));

export const paletteActions = {
  open: (initialQuery?: string) => usePaletteStore.setState({ open: true, initialQuery }),
  close: () => usePaletteStore.setState({ open: false }),
  toggle: () => usePaletteStore.setState((s) => ({ open: !s.open, initialQuery: undefined })),
};
