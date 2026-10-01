import { Button, Text } from "@itwin/itwinui-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";
import { useGraphStore } from "../state/graphStore";
import { formatShortcut } from "./registry";
import "./tour.css";

const SEEN_KEY = "instanceGraph.tourSeen";

interface TourStep {
  readonly title: string;
  readonly body: string;
  /** `data-tour` anchor; the card is centred when absent or not currently visible. */
  readonly anchor?: string;
}

const palette = formatShortcut({ key: "k", mod: true });
export const TOUR_STEPS: readonly TourStep[] = [
  { title: "Welcome to iModel Data Explorer", body: "A quick tour of the main panels. It takes a few seconds; press Escape to skip at any time." },
  { anchor: "seed", title: "Start from a query", body: "Run an ECSQL seed query, then click a result to centre the graph on it. Save queries you reuse." },
  { anchor: "graph", title: "Explore the graph", body: "Click a node to centre on it, use its + to expand, and double-click to pin it. Breadcrumbs above take you back." },
  { anchor: "tools", title: "Graph tools", body: "Pick a tool, then click a node or relationship to include or exclude it, or find a path between two instances." },
  { anchor: "properties", title: "Inspect properties", body: "The selected instance's properties appear here. You can also leave yourself a note on it." },
  { title: "Do anything from the keyboard", body: `Press ${palette} for the command palette: commands, recent files, saved queries and instances. Press ? for all shortcuts. Replay this tour from Help.` },
];

function seen(): boolean {
  return globalThis.localStorage?.getItem(SEEN_KEY) === "1";
}

export const useTourStore = create<{ readonly step?: number }>(() => ({}));
export const tourActions = {
  start: () => useTourStore.setState({ step: 0 }),
  /** Starts the tour unless it has been finished or skipped before. */
  startIfNew: () => { if (!seen() && useTourStore.getState().step === undefined) tourActions.start(); },
  go: (step: number) => useTourStore.setState({ step: Math.max(0, Math.min(TOUR_STEPS.length - 1, step)) }),
  end: () => {
    globalThis.localStorage?.setItem(SEEN_KEY, "1");
    useTourStore.setState({ step: undefined });
  },
};

function visibleRect(anchor: string | undefined): DOMRect | undefined {
  if (!anchor) return undefined;
  const rect = document.querySelector(`[data-tour="${anchor}"]`)?.getBoundingClientRect();
  return rect && rect.width > 0 && rect.height > 0 ? rect : undefined;
}

const CARD_WIDTH = 320;
const GAP = 12;

/** Places the card beside the target: right, then left, then below, then over it. */
function cardPosition(rect: DOMRect, cardHeight: number): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampTop = (t: number) => Math.max(GAP, Math.min(vh - cardHeight - GAP, t));
  const clampLeft = (l: number) => Math.max(GAP, Math.min(vw - CARD_WIDTH - GAP, l));
  if (rect.right + GAP + CARD_WIDTH <= vw - GAP) return { left: rect.right + GAP, top: clampTop(rect.top) };
  if (rect.left - GAP - CARD_WIDTH >= GAP) return { left: rect.left - GAP - CARD_WIDTH, top: clampTop(rect.top) };
  if (rect.bottom + GAP + cardHeight <= vh - GAP) return { left: clampLeft(rect.left), top: rect.bottom + GAP };
  return { left: clampLeft(rect.left + (rect.width - CARD_WIDTH) / 2), top: clampTop(rect.top + (rect.height - cardHeight) / 2) };
}

/** Coach marks shown once, the first time an iModel is opened; replayable from Help. */
export function FirstRunTour() {
  const step = useTourStore((s) => s.step);
  const connected = useGraphStore((s) => s.connection !== undefined);
  const card = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<Element | null>(null);
  const [rect, setRect] = useState<DOMRect>();
  const [cardHeight, setCardHeight] = useState(0);

  // Wait for the frontstage to lay out before the first coach mark.
  useEffect(() => {
    if (!connected) return;
    const timer = setTimeout(tourActions.startIfNew, 600);
    return () => clearTimeout(timer);
  }, [connected]);

  useEffect(() => {
    if (!connected && step !== undefined) useTourStore.setState({ step: undefined });
  }, [connected, step]);

  const current = step === undefined ? undefined : TOUR_STEPS[step];

  useLayoutEffect(() => {
    if (!current) return;
    const measure = () => {
      setRect(visibleRect(current.anchor));
      setCardHeight(card.current?.offsetHeight ?? 0);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [current]);

  useEffect(() => {
    if (step === undefined) return;
    if (!returnFocus.current) returnFocus.current = document.activeElement;
    next.current?.focus();
  }, [step]);

  useEffect(() => {
    if (step !== undefined) return;
    const el = returnFocus.current;
    returnFocus.current = null;
    if (el instanceof HTMLElement && el.isConnected) el.focus();
  }, [step]);

  if (step === undefined || !current || !connected) return null;
  const last = step === TOUR_STEPS.length - 1;
  const style = rect ? cardPosition(rect, cardHeight) : undefined;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") tourActions.end();
    else if (e.key === "ArrowRight") { if (last) tourActions.end(); else tourActions.go(step + 1); }
    else if (e.key === "ArrowLeft") tourActions.go(step - 1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="ig-tour" data-testid="tour">
      {rect && <div className="ig-tour__ring" aria-hidden="true"
        style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }} />}
      <div ref={card} role="dialog" aria-modal="false" aria-labelledby="ig-tour-title" aria-describedby="ig-tour-body"
        className={`ig-tour__card${style ? "" : " ig-tour__card--centred"}`} style={style} onKeyDown={onKeyDown}>
        <Text variant="small" isMuted>{step + 1} of {TOUR_STEPS.length}</Text>
        <Text variant="leading" id="ig-tour-title">{current.title}</Text>
        <Text id="ig-tour-body">{current.body}</Text>
        <div className="ig-tour__actions">
          <Button size="small" styleType="borderless" onClick={tourActions.end} data-testid="tour-skip">{last ? "Close" : "Skip tour"}</Button>
          <span className="ig-tour__spacer" />
          {step > 0 && <Button size="small" onClick={() => tourActions.go(step - 1)}>Back</Button>}
          <Button ref={next} size="small" styleType="high-visibility" data-testid="tour-next"
            onClick={() => (last ? tourActions.end() : tourActions.go(step + 1))}>{last ? "Done" : "Next"}</Button>
        </div>
      </div>
    </div>
  );
}
