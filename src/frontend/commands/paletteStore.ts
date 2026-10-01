import { create } from "zustand";

interface PaletteState {
  readonly open: boolean;
}

export const usePaletteStore = create<PaletteState>(() => ({ open: false }));

export const paletteActions = {
  open: () => usePaletteStore.setState({ open: true }),
  close: () => usePaletteStore.setState({ open: false }),
  toggle: () => usePaletteStore.setState((s) => ({ open: !s.open })),
};
