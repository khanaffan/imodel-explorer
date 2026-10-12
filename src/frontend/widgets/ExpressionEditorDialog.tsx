import { Button, Modal, ModalButtonBar, ModalContent } from "@itwin/itwinui-react";
import {
  applyEdgeChanges, applyNodeChanges, Background, Controls, Handle, Position, ReactFlow,
  useNodesInitialized, useReactFlow, useUpdateNodeInternals, type NodeProps, type OnConnectEnd,
} from "@xyflow/react";
import ELK from "elkjs/lib/elk.bundled.js";
import { useEffect, useId, useMemo, useState } from "react";
import type { ClassRegistry } from "../engine/ClassRegistry";
import {
  expressionPreview, expressionPropertyNames, NODE_FIELDS, parseExpression, printExpression, validateExpressionProperties,
  type NodeExpr, type Scalar,
} from "../engine/nodeExpression";
import {
  compileExpressionGraph, expressionConnectionError, expressionInputs, expressionOutput, expressionToGraph,
  type ExpressionFlowNode, type ExpressionGraph, type ExpressionNodeData,
} from "../graph/expressionGraph";
import "@xyflow/react/dist/style.css";
import "./expressionEditor.css";

export interface ExpressionEditorDialogProps {
  expression?: NodeExpr;
  registry: ClassRegistry;
  onApply: (expression: NodeExpr | undefined) => void;
  onClose: () => void;
}

function nodeLabel(data: ExpressionNodeData): string {
  switch (data.kind) {
    case "field": return `node.${data.field}`;
    case "property": return data.property || "Choose a property";
    case "literal": return JSON.stringify(data.value);
    case "compare": return data.op;
    case "in": return `IN ${JSON.stringify(data.values)}`;
    case "isNull": return "IS NULL";
    case "isNotNull": return "IS NOT NULL";
    default: return data.kind.toUpperCase();
  }
}

function ExpressionNode({ id, data, selected }: NodeProps<ExpressionFlowNode>) {
  const inputs = expressionInputs(data);
  const output = expressionOutput(data);
  const updateInternals = useUpdateNodeInternals();
  const signature = inputs.map((port) => port.id).join(",");
  useEffect(() => { updateInternals(id); }, [id, signature, updateInternals]);
  return (
    <div className={`ig-expr-node${selected ? " ig-expr-node--selected" : ""}`} style={{ minHeight: Math.max(80, inputs.length * 30 + 30) }}>
      <strong>{data.kind === "compare" ? "Compare" : data.kind}</strong>
      <div className="ig-expr-node__label">{nodeLabel(data)}</div>
      {inputs.map((port, index) => (
        <div key={port.id} className="ig-expr-node__port" style={{ top: 35 + index * 30 }}>
          <span>{port.id} · {port.type}</span>
        </div>
      ))}
      {inputs.map((port, index) => (
        <Handle key={port.id} id={port.id} type="target" position={Position.Left}
          style={{ top: 43 + index * 30 }} title={`${port.id} input (${port.type})`}
          aria-label={`${port.id} input (${port.type})`} className={`ig-expr-port--${port.type}`} />
      ))}
      {output && <Handle id="out" type="source" position={Position.Right}
        title={`Output (${output.type}) — drag or click to connect`} aria-label={`Output (${output.type})`}
        className={`ig-expr-port--${output.type}`} />}
    </div>
  );
}
const nodeTypes = { expression: ExpressionNode };
const elk = new ELK();

function ExpressionViewport({ fitRequest }: { fitRequest: number }) {
  const initialized = useNodesInitialized();
  const { fitView } = useReactFlow<ExpressionFlowNode>();
  useEffect(() => {
    if (!initialized) return;
    const frame = requestAnimationFrame(() => {
      void fitView({ padding: 0.2, maxZoom: 1, duration: 0 });
    });
    return () => cancelAnimationFrame(frame);
  }, [fitRequest, initialized, fitView]);
  return null;
}

function isScalar(value: unknown): value is Scalar {
  return value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

function ScalarControl({ data, onChange, onError }: {
  data: Extract<ExpressionNodeData, { kind: "literal" | "in" }>;
  onChange: (data: ExpressionNodeData) => void;
  onError: (message: string | undefined) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(data.kind === "literal" ? data.value : data.values));
  const descriptionId = useId();
  const label = data.kind === "literal" ? "Value (JSON scalar)" : "Values (JSON scalar array)";
  return (
    <label>{label}
      <textarea aria-label={label} aria-describedby={descriptionId} value={text} rows={3} onChange={(event) => {
        const next = event.target.value;
        setText(next);
        try {
          const value: unknown = JSON.parse(next);
          if (data.kind === "literal") {
            if (!isScalar(value)) throw new Error("Use a string, finite number, boolean, or null.");
            onChange({ kind: "literal", value });
          } else {
            if (!Array.isArray(value) || !value.length || value.length > 100 || !value.every(isScalar))
              throw new Error("IN needs 1–100 strings, finite numbers, booleans, or nulls.");
            onChange({ kind: "in", values: value });
          }
          onError(undefined);
        } catch (error) {
          onError(error instanceof Error ? error.message : String(error));
        }
      }} />
      <small id={descriptionId}>Examples: "Pump", 5, true, null; IN: ["Pump", "Valve"]</small>
    </label>
  );
}

function NodeControls({ node, properties, onChange, onError }: {
  node: ExpressionFlowNode; properties: string[];
  onChange: (data: ExpressionNodeData) => void; onError: (message: string | undefined) => void;
}) {
  const propertyListId = useId();
  const data = node.data;
  switch (data.kind) {
    case "field": return <label>Node field<select value={data.field} onChange={(event) => {
      const field = NODE_FIELDS.find((value) => value === event.target.value);
      if (field) onChange({ kind: "field", field });
    }}>{NODE_FIELDS.map((field) => <option key={field}>{field}</option>)}</select></label>;
    case "property": return <label>EC property<input list={propertyListId} value={data.property} onChange={(event) => onChange({ kind: "property", property: event.target.value })} />
      <datalist id={propertyListId}>{properties.map((property) => <option key={property} value={property} />)}</datalist>
      <small>Search scalar properties, ECInstanceId, ECClassId, or navigation members such as Model.Id.</small>
    </label>;
    case "literal": case "in": return <ScalarControl data={data} onChange={onChange} onError={onError} />;
    case "compare": return <label>Operator<select value={data.op} onChange={(event) => {
      const op = event.target.value;
      if (op === "=" || op === "!=" || op === "<" || op === "<=" || op === ">" || op === ">=") onChange({ kind: "compare", op });
    }}>{["=", "!=", "<", "<=", ">", ">="].map((op) => <option key={op}>{op}</option>)}</select></label>;
    case "and": case "or": return <label>Predicate inputs<select value={data.inputCount} onChange={(event) => onChange({ kind: data.kind, inputCount: Number(event.target.value) })}>
      {Array.from({ length: Math.max(7, data.inputCount - 1) }, (_, i) => i + 2).map((count) => <option key={count}>{count}</option>)}
    </select></label>;
    default: return <p>Connect {data.kind === "result" ? "the final predicate" : "the required inputs"} using the colored ports.</p>;
  }
}

const palette: { label: string; data: ExpressionNodeData }[] = [
  { label: "Field", data: { kind: "field", field: "label" } },
  { label: "Property", data: { kind: "property", property: "" } },
  { label: "Literal", data: { kind: "literal", value: "" } },
  { label: "Compare", data: { kind: "compare", op: "=" } },
  { label: "LIKE", data: { kind: "like" } }, { label: "IN", data: { kind: "in", values: [""] } },
  { label: "IS NULL", data: { kind: "isNull" } }, { label: "IS NOT NULL", data: { kind: "isNotNull" } },
  { label: "AND", data: { kind: "and", inputCount: 2 } }, { label: "OR", data: { kind: "or", inputCount: 2 } },
  { label: "NOT", data: { kind: "not" } },
];

export function ExpressionEditorDialog({ expression, registry, onApply, onClose }: ExpressionEditorDialogProps) {
  const textDescriptionId = useId();
  const [graph, setGraph] = useState(() => expressionToGraph(expression));
  const [compiled, setCompiled] = useState(() => compileExpressionGraph(graph));
  const [text, setText] = useState(() => expression ? printExpression(expression) : "");
  const [textError, setTextError] = useState<string>();
  const [controlError, setControlError] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [notice, setNotice] = useState<string>();
  const [arranging, setArranging] = useState(false);
  const [fitRequest, setFitRequest] = useState(0);
  const properties = useMemo(() => expressionPropertyNames(registry), [registry]);
  const validationError = useMemo(() => {
    if (!compiled.ok || !compiled.expression) return undefined;
    try { validateExpressionProperties(compiled.expression, registry); }
    catch (error) { return error instanceof Error ? error.message : String(error); }
  }, [compiled, registry]);
  const errors = [...compiled.errors, textError, controlError, validationError].filter((error): error is string => !!error);
  const preview = compiled.ok && compiled.expression && !textError && !controlError && !validationError ? expressionPreview(compiled.expression) : "";
  const selected = graph.nodes.find((node) => node.id === selectedId);
  function changeGraph(next: ExpressionGraph, fit = false) {
    setGraph(next);
    if (fit) setFitRequest((request) => request + 1);
    setTextError(undefined);
    setNotice(undefined);
    const result = compileExpressionGraph(next);
    setCompiled(result);
    if (result.ok) setText(result.expression ? printExpression(result.expression) : "");
    else if (textError && compiled.ok) setText(compiled.expression ? printExpression(compiled.expression) : "");
  }
  function selectNode(id?: string) {
    setSelectedId(id);
    setControlError(undefined);
  }
  async function arrange() {
    setArranging(true);
    setNotice(undefined);
    try {
      const layout = await elk.layout({
        id: "expression", layoutOptions: { "elk.algorithm": "layered", "elk.direction": "RIGHT", "elk.spacing.nodeNode": "50" },
        children: graph.nodes.map((node) => ({ id: node.id, width: 190, height: Math.max(100, expressionInputs(node.data).length * 30 + 30) })),
        edges: graph.edges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
      });
      setGraph((current) => current !== graph ? current : {
        ...current, nodes: current.nodes.map((node) => {
          const position = layout.children?.find((child) => child.id === node.id);
          return position ? { ...node, position: { x: position.x ?? 0, y: position.y ?? 0 } } : node;
        }),
      });
      setFitRequest((request) => request + 1);
    } catch (error) { setNotice(`Layout failed: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setArranging(false); }
  }
  async function copyPreview() {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard access is unavailable in this environment.");
      await navigator.clipboard.writeText(preview);
      setNotice("Preview copied.");
    } catch (error) { setNotice(`Copy failed: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const connectionEnded: OnConnectEnd = (_event, state) => {
    if (state.isValid || !state.fromHandle) return;
    if (!state.toHandle) {
      setNotice("Connect a right-edge output circle to a matching left-edge input circle.");
      return;
    }
    const [source, target] = state.fromHandle.type === "source"
      ? [state.fromHandle, state.toHandle] : [state.toHandle, state.fromHandle];
    setNotice(expressionConnectionError(graph, {
      source: source.nodeId, sourceHandle: source.id ?? null,
      target: target.nodeId, targetHandle: target.id ?? null,
    }) ?? "Connect an output circle to an input circle.");
  };
  return (
    <Modal isOpen title="Node filter expression" onClose={onClose} closeOnExternalClick={false} closeOnEsc={false} className="ig-expression-editor">
      <ModalContent>
        <div className="ig-expr-toolbar">
          <label>Add node <select value={paletteIndex} onChange={(event) => setPaletteIndex(Number(event.target.value))}>
            {palette.map((entry, index) => <option key={entry.label} value={index}>{entry.label}</option>)}
          </select></label>
          <Button onClick={() => {
            const id = `new-${crypto.randomUUID()}`;
            changeGraph({ ...graph, nodes: [...graph.nodes, {
              id, type: "expression", data: { ...palette[paletteIndex].data },
              position: selected ? { x: selected.position.x - 240, y: selected.position.y + 140 } : { x: -240, y: graph.nodes.length * 110 },
            }] }, true);
            selectNode(id);
          }}>Add</Button>
          <Button disabled={arranging} onClick={() => void arrange()}>Arrange</Button>
          <Button onClick={() => { changeGraph(expressionToGraph(), true); selectNode(); }}>Clear expression</Button>
        </div>
        <p className="ig-expr-hint">Drag the circle on a node's right edge to a matching circle on the next node's left edge, or click the two circles. Blue = operand; green = predicate. Fields/properties/literals connect to Compare; Compare connects to Result. Select nodes to edit; select connections and press Delete/Backspace to remove them.</p>
        <div className="ig-expr-workspace">
          <div className="ig-expr-canvas">
            <ReactFlow<ExpressionFlowNode>
              nodes={graph.nodes} edges={graph.edges} nodeTypes={nodeTypes} fitView minZoom={0.15}
              connectOnClick connectionRadius={30}
              onConnectStart={() => setNotice(undefined)}
              onConnectEnd={connectionEnded}
              onClickConnectEnd={connectionEnded}
              onNodeClick={(_event, node) => selectNode(node.id)}
              onPaneClick={() => selectNode()}
              onNodesChange={(changes) => {
                const next = { ...graph, nodes: applyNodeChanges(changes, graph.nodes) };
                if (changes.some((change) => change.type === "remove")) {
                  next.edges = graph.edges.filter((edge) => next.nodes.some((node) => node.id === edge.source) && next.nodes.some((node) => node.id === edge.target));
                  changeGraph(next);
                  if (!next.nodes.some((node) => node.id === selectedId)) selectNode();
                } else setGraph((current) => ({ ...current, nodes: applyNodeChanges(changes, current.nodes) }));
              }}
              onEdgesChange={(changes) => {
                const next = { ...graph, edges: applyEdgeChanges(changes, graph.edges) };
                if (changes.some((change) => change.type === "remove")) changeGraph(next);
                else setGraph((current) => ({ ...current, edges: applyEdgeChanges(changes, current.edges) }));
              }}
              isValidConnection={(connection) => !expressionConnectionError(graph, connection)}
              onConnect={(connection) => {
                const error = expressionConnectionError(graph, connection);
                if (error) { setNotice(error); return; }
                changeGraph({ ...graph, edges: [...graph.edges, { ...connection, id: `edge-${crypto.randomUUID()}` }] });
              }}
              deleteKeyCode={["Backspace", "Delete"]}
            ><ExpressionViewport fitRequest={fitRequest} /><Background /><Controls /></ReactFlow>
          </div>
          <aside className="ig-expr-controls">
            <h3>{selected ? nodeLabel(selected.data) : "Node settings"}</h3>
            {selected ? <>
              <NodeControls key={selected.id} node={selected} properties={properties} onError={setControlError} onChange={(data) => {
                const ports = expressionInputs(data).map((port) => port.id);
                changeGraph({
                  nodes: graph.nodes.map((node) => node.id === selected.id ? { ...node, data } : node),
                  edges: graph.edges.filter((edge) => edge.target !== selected.id || ports.some((port) => port === edge.targetHandle)),
                }, expressionInputs(selected.data).length !== expressionInputs(data).length);
              }} />
              <Button disabled={selected.data.kind === "result"} onClick={() => {
                changeGraph({ nodes: graph.nodes.filter((node) => node.id !== selected.id), edges: graph.edges.filter((edge) => edge.source !== selected.id && edge.target !== selected.id) });
                selectNode();
              }}>Delete node</Button>
            </> : <p>Select a node to edit its value or operator.</p>}
            <Button disabled={!graph.edges.some((edge) => edge.selected)} onClick={() => changeGraph({ ...graph, edges: graph.edges.filter((edge) => !edge.selected) })}>Delete selected connections</Button>
          </aside>
        </div>
        <div className="ig-expr-errors" role="status" aria-live="polite">
          {errors.length ? <ul>{errors.map((error, index) => <li key={index}>{error}</li>)}</ul> : compiled.ok && !compiled.expression ? "No expression — Apply clears the filter." : "Expression is valid."}
          {!compiled.ok && <small>The text below is the last valid expression until all graph inputs are connected.</small>}
          {notice && <p>{notice}</p>}
        </div>
        <div className="ig-expr-panes">
          <label>Expression text<textarea aria-label="Expression text" aria-describedby={textDescriptionId} rows={5} value={text} spellCheck={false} onChange={(event) => {
            const next = event.target.value;
            setText(next);
            setNotice(undefined);
            try {
              const expr = next.trim() ? parseExpression(next) : undefined;
              const nextGraph = expressionToGraph(expr);
              setGraph(nextGraph);
              setCompiled(compileExpressionGraph(nextGraph));
              setFitRequest((request) => request + 1);
              setTextError(undefined);
              selectNode();
            } catch (error) { setTextError(error instanceof Error ? error.message : String(error)); }
          }} /><small id={textDescriptionId}>Example: node.label LIKE '%Pump%' AND CodeValue = 'P-1'</small></label>
          <div><label>ECSQL preview<textarea aria-label="ECSQL preview" rows={5} readOnly value={preview} /></label>
            <Button disabled={!preview} onClick={() => void copyPreview()}>Copy preview</Button>
          </div>
        </div>
        <p className="ig-expr-hint">Preview only; never executed. $-&gt; property access can omit rows whose class lacks the property, so this query is not equivalent to traversal filtering in those cases. Some node fields have no ECSQL equivalent. Missing properties are NULL during traversal. Capped group totals can include filtered-out nodes.</p>
      </ModalContent>
      <ModalButtonBar>
        <Button onClick={onClose}>Cancel</Button>
        <Button styleType="high-visibility" disabled={errors.length > 0} onClick={() => {
          if (compiled.ok && !errors.length) { onApply(compiled.expression); onClose(); }
        }}>Apply</Button>
      </ModalButtonBar>
    </Modal>
  );
}
