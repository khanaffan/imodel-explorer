import { SvgChevronDown, SvgChevronUp, SvgClose } from "@itwin/itwinui-icons-react";
import { IconButton, Input, Text } from "@itwin/itwinui-react";
import { Panel } from "@xyflow/react";
import { useEffect, useRef } from "react";

export function FindBar({ query, onQuery, count, current, onStep, onClose, focusRequest }: {
  query: string;
  onQuery: (q: string) => void;
  count: number;
  /** Index of the current match, -1 when there is none. */
  current: number;
  onStep: (delta: 1 | -1) => void;
  onClose: () => void;
  /** Bumped to refocus the field (e.g. ⌘F while already open). */
  focusRequest: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, [focusRequest]);
  return (
    <Panel position="top-right" className="ig-findbar" role="search">
      <Input ref={input} size="small" className="ig-findbar__input" placeholder="Find label, class or id" value={query} aria-label="Find in graph"
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); onStep(e.shiftKey ? -1 : 1); }
          else if (e.key === "Escape") { e.preventDefault(); onClose(); }
        }} />
      <Text variant="small" className="ig-findbar__count" role="status" aria-live="polite">
        {query.trim() ? (count ? `${current + 1} of ${count}` : "No matches") : ""}
      </Text>
      <IconButton size="small" styleType="borderless" label="Previous match (Shift+Enter)" disabled={!count} onClick={() => onStep(-1)}><SvgChevronUp /></IconButton>
      <IconButton size="small" styleType="borderless" label="Next match (Enter)" disabled={!count} onClick={() => onStep(1)}><SvgChevronDown /></IconButton>
      <IconButton size="small" styleType="borderless" label="Close (Esc)" onClick={onClose}><SvgClose /></IconButton>
    </Panel>
  );
}
