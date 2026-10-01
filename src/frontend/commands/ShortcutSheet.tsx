import { Input, Modal, ModalContent, Text } from "@itwin/itwinui-react";
import { useMemo, useState } from "react";
import { create } from "zustand";
import "./palette.css";
import { COMMAND_GROUPS, formatShortcut, type Shortcut, useCommandStore } from "./registry";

export const useShortcutSheetStore = create<{ readonly open: boolean }>(() => ({ open: false }));
export const shortcutSheetActions = {
  toggle: () => useShortcutSheetStore.setState((s) => ({ open: !s.open })),
  close: () => useShortcutSheetStore.setState({ open: false }),
};

interface Row { readonly title: string; readonly keys: string }

const enter = formatShortcut({ key: "Enter" });
const shiftEnter = formatShortcut({ key: "Enter", shift: true });
const esc = formatShortcut({ key: "Escape" });
/** Keys handled inside a component rather than by a registered command. */
const IN_CONTEXT: ReadonlyArray<{ readonly group: string; readonly rows: readonly Row[] }> = [
  { group: "In the command palette", rows: [
    { title: "Run command or centre on instance", keys: enter },
    { title: "Find path from the centre to an instance", keys: shiftEnter },
    { title: "Move through results", keys: `${formatShortcut({ key: "ArrowUp" })} ${formatShortcut({ key: "ArrowDown" })}` },
    { title: "Close", keys: esc },
  ] },
  { group: "In Find in graph", rows: [
    { title: "Next / previous match", keys: `${enter} / ${shiftEnter}` },
    { title: "Close", keys: esc },
  ] },
];

/** Every keyboard shortcut, generated from the command registry, grouped and searchable. */
export function ShortcutSheet() {
  const open = useShortcutSheetStore((s) => s.open);
  const commands = useCommandStore((s) => s.commands);
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (r: Row) => !q || r.title.toLowerCase().includes(q) || r.keys.toLowerCase().includes(q);
    const registered = COMMAND_GROUPS.map((group) => ({
      group: group as string,
      rows: [...commands.values()].filter((c) => c.group === group && c.shortcut)
        .map((c) => ({ title: c.title, keys: formatShortcut(c.shortcut as Shortcut) })),
    }));
    return [...registered, ...IN_CONTEXT]
      .map((g) => ({ group: g.group, rows: g.rows.filter(match) }))
      .filter((g) => g.rows.length > 0);
  }, [commands, query]);

  return (
    <Modal isOpen={open} title="Keyboard shortcuts" onClose={() => { shortcutSheetActions.close(); setQuery(""); }} className="ig-shortcuts">
      <ModalContent>
        <Input size="small" placeholder="Search shortcuts" aria-label="Search shortcuts" value={query} autoFocus
          onChange={(e) => setQuery(e.target.value)} />
        <Text variant="small" isMuted className="ig-shortcuts__note">
          Shortcuts do not fire while you type in a field, except {formatShortcut({ key: "k", mod: true })},{" "}
          {formatShortcut({ key: "f", mod: true })} and {esc}.
        </Text>
        {groups.length === 0 && <Text isMuted>No shortcuts match "{query}".</Text>}
        {groups.map((g) => (
          <section key={g.group} className="ig-shortcuts__group" aria-label={g.group}>
            <Text variant="leading">{g.group}</Text>
            <dl>
              {g.rows.map((r) => (
                <div key={r.title} className="ig-shortcuts__row">
                  <dt>{r.title}</dt>
                  <dd><kbd>{r.keys}</kbd></dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </ModalContent>
    </Modal>
  );
}
