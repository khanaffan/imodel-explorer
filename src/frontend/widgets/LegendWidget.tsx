import { Button, Input, Select, Text } from "@itwin/itwinui-react";
import { useMemo, useState } from "react";
import { NODE_CATEGORIES, type NodeCategory } from "../engine/GraphModel";
import { CATEGORY_LABELS, type ColorRule, DEFAULT_THEME } from "../state/colorTheme";
import { graphActions, useGraphStore } from "../state/graphStore";
import "./widgets.css";

export function LegendWidget() {
  const theme = useGraphStore((s) => s.theme);
  const graph = useGraphStore((s) => s.graph);
  const [match, setMatch] = useState("");
  const [kind, setKind] = useState<ColorRule["kind"]>("class");
  const [color, setColor] = useState("#e91e63");

  const counts = useMemo(() => {
    const c = new Map<NodeCategory, number>();
    for (const n of graph.nodes.values()) if (!n.aggregate) c.set(n.category, (c.get(n.category) ?? 0) + 1);
    return c;
  }, [graph]);
  const edgeCounts = useMemo(() => {
    let nav = 0, link = 0;
    for (const e of graph.edges.values()) { if (e.kind === "navigation") nav++; else if (e.kind === "linkTable") link++; }
    return { nav, link };
  }, [graph]);

  const setCategory = (cat: NodeCategory, value: string) =>
    graphActions.setTheme({ ...theme, categories: { ...theme.categories, [cat]: value } });
  const setRules = (rules: ColorRule[]) => graphActions.setTheme({ ...theme, rules });
  const addRule = () => {
    const m = match.trim();
    if (!m) return;
    setRules([...theme.rules, { id: `${Date.now()}`, match: m, kind, polymorphic: true, color }]);
    setMatch("");
  };
  const move = (i: number, d: -1 | 1) => {
    const r = [...theme.rules];
    const j = i + d;
    if (j < 0 || j >= r.length) return;
    [r[i], r[j]] = [r[j], r[i]];
    setRules(r);
  };

  return (
    <div className="ig-widget">
      <Text variant="leading">Nodes</Text>
      {NODE_CATEGORIES.map((cat) => (
        <div key={cat} className="ig-legend-row">
          <input type="color" value={theme.categories[cat]} onChange={(e) => setCategory(cat, e.target.value)} title="Change colour" />
          <span>{CATEGORY_LABELS[cat]}</span>
          <span className="ig-muted">{counts.get(cat) ?? 0}</span>
        </div>
      ))}

      <Text variant="leading">Relationships</Text>
      <div className="ig-legend-row"><svg width="36" height="10"><line x1="0" y1="5" x2="36" y2="5" stroke="#d9822b" strokeWidth="2.2" /></svg><span>Link table (own instance, may have properties)</span><span className="ig-muted">{edgeCounts.link}</span></div>
      <div className="ig-legend-row"><svg width="36" height="10"><line x1="0" y1="5" x2="36" y2="5" stroke="#7a8ca3" strokeWidth="1.4" strokeDasharray="5 4" /></svg><span>Navigation property</span><span className="ig-muted">{edgeCounts.nav}</span></div>
      <div className="ig-legend-row"><svg width="36" height="10"><line x1="0" y1="5" x2="36" y2="5" stroke="#999" strokeWidth="1.4" strokeDasharray="2 4" /></svg><span>Summary (+N more)</span><span /></div>
      <Text variant="small" isMuted>Numbers at edge ends are the relationship constraint multiplicities.</Text>

      <Text variant="leading">Custom colour rules</Text>
      <Text variant="small" isMuted>First match wins; rules override category colours.</Text>
      {theme.rules.map((r, i) => (
        <div key={r.id} className="ig-legend-row">
          <input type="color" value={r.color} onChange={(e) => setRules(theme.rules.map((x) => (x.id === r.id ? { ...x, color: e.target.value } : x)))} />
          <span title={r.match}>{r.kind === "schema" ? "Schema " : ""}{r.match}{r.kind === "class" && r.polymorphic ? " +sub" : ""}</span>
          <span className="ig-row">
            <button className="ig-x" onClick={() => move(i, -1)} title="Up">↑</button>
            <button className="ig-x" onClick={() => move(i, 1)} title="Down">↓</button>
            <button className="ig-x" onClick={() => setRules(theme.rules.filter((x) => x.id !== r.id))} title="Remove">×</button>
          </span>
        </div>
      ))}
      <div className="ig-row">
        <div style={{ width: 90 }}>
          <Select<ColorRule["kind"]> size="small" value={kind} options={[{ value: "class", label: "Class" }, { value: "schema", label: "Schema" }]} onChange={setKind} />
        </div>
        <Input size="small" placeholder={kind === "class" ? "Schema:Class" : "SchemaName"} value={match} onChange={(e) => setMatch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addRule()} />
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        <Button size="small" onClick={addRule}>Add</Button>
      </div>
      <Button size="small" styleType="borderless" onClick={() => graphActions.setTheme(DEFAULT_THEME)}>Reset colours</Button>
    </div>
  );
}
