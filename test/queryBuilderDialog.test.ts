// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ClassRegistry } from "../src/frontend/engine/ClassRegistry";
import { createQueryPort, type IModelQueryPort, type QuerySource } from "../src/frontend/engine/IModelQueryPort";
import { QueryBuilderDialog } from "../src/frontend/widgets/QueryBuilderDialog";
import { createFixture, type Fixture } from "./fixture";

let fx: Fixture;
let port: IModelQueryPort;
let registry: ClassRegistry;

beforeAll(async () => {
  fx = await createFixture();
  port = createQueryPort(fx.db as unknown as QuerySource);
  registry = await ClassRegistry.create(port);
});
afterAll(async () => fx?.close());

describe("QueryBuilderDialog", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", class { observe() { } unobserve() { } disconnect() { } });
    vi.stubGlobal("DOMMatrixReadOnly", class { readonly m22 = 1; });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const byLabel = <T extends Element>(tag: string, label: string) => {
    const el = Array.from(document.querySelectorAll(tag)).find((e) => e.getAttribute("aria-label") === label);
    if (!el) throw new Error(`Missing ${tag}[aria-label=${label}]`);
    return el as unknown as T;
  };
  const button = (text: string) => {
    const el = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);
    if (!el) throw new Error(`Missing button: ${text}`);
    return el;
  };
  const sql = () => byLabel<HTMLTextAreaElement>("textarea", "ECSQL text").value;
  const badge = () => document.querySelector(".ig-qb-badge")?.textContent ?? "";
  async function until(check: () => boolean, what: string) {
    for (let i = 0; i < 100; i++) {
      if (check()) return;
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    }
    throw new Error(`Timed out waiting for ${what}; badge: ${badge()}`);
  }
  function type(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
    act(() => { el.value = value; Simulate.change(el); });
  }
  async function open(initialEcsql: string, onUse = vi.fn()) {
    await act(async () => root.render(createElement(QueryBuilderDialog, { port, registry, initialEcsql, onUse, onClose: vi.fn() })));
    await until(() => badge() !== "Checking…", "analysis");
    return onUse;
  }

  it("starts from Element, joins a related class and keeps the query valid", async () => {
    await open("");
    expect(badge()).toBe("Valid ECSQL");
    expect(sql()).toMatch(/FROM BisCore\.Element/);
    const node = document.querySelector<HTMLElement>(".react-flow__node");
    act(() => node!.click());
    const suggestion = Array.from(document.querySelectorAll<HTMLButtonElement>(".ig-qb-sugs button")).find((b) => b.textContent?.includes("Model"));
    expect(suggestion).toBeDefined();
    act(() => suggestion!.click());
    act(() => button("Join").click());
    expect(sql()).toMatch(/JOIN/);
    await until(() => badge() !== "Checking…", "join analysis");
    expect(badge()).toBe("Valid ECSQL");
    expect(document.querySelectorAll(".react-flow__node").length).toBeGreaterThanOrEqual(2);
  });

  it("adds a typed filter and a column from the property list", async () => {
    await open("SELECT ECInstanceId, ECClassId FROM bis.Element");
    await until(() => !!document.querySelector(".react-flow__node"), "canvas");
    act(() => document.querySelector<HTMLElement>(".react-flow__node")!.click());
    act(() => byLabel<HTMLButtonElement>("button", "Filter on CodeValue").click());
    type(byLabel<HTMLInputElement>("input", "Value 1"), "it's");
    expect(sql()).toContain("WHERE CodeValue = 'it''s'");
    const userLabel = Array.from(document.querySelectorAll<HTMLLabelElement>(".ig-qb-field label")).find((l) => l.title === "UserLabel");
    act(() => userLabel!.querySelector("input")!.click());
    expect(sql()).toMatch(/SELECT ECInstanceId, ECClassId, UserLabel/);
    await until(() => badge() !== "Checking…", "analysis");
    expect(badge()).toBe("Valid ECSQL");
  });

  it("rebuilds CTEs from pasted text, keeps the text until a visual edit, and uses it", async () => {
    const text = "WITH c(Id) AS (SELECT ECInstanceId FROM bis.Element) SELECT Id AS ECInstanceId FROM c";
    const onUse = await open(text);
    await until(() => Array.from(document.querySelectorAll("button")).some((b) => b.textContent === "WITH c"), "CTE tab");
    expect(sql()).toBe(text);
    expect(document.querySelector(".ig-qb-banner--info")).not.toBeNull();
    act(() => button("Use & run").click());
    expect(onUse).toHaveBeenCalledWith(text, true);
    act(() => button("WITH c").click());
    expect(byLabel<HTMLInputElement>("input", "CTE columns").value).toBe("Id");
    act(() => button("Order / Limit").click());
    type(byLabel<HTMLInputElement>("input", "Limit"), "5");
    expect(sql()).toMatch(/^WITH c\(Id\) AS \(\n {2}SELECT ECInstanceId\n {2}FROM BisCore\.Element\n {2}LIMIT 5\n\)/);
  });

  it("reports invalid text and offers a fresh visual query", async () => {
    await open("SELECT Nope FROM bis.Element");
    expect(badge()).toMatch(/^Invalid: .*Nope/);
    act(() => button("start a new visual query").click());
    expect(sql()).toMatch(/FROM BisCore\.Element/);
  });

  it("keeps unsupported conditions as editable ECSQL chips", async () => {
    await open("SELECT ECInstanceId FROM bis.Element WHERE EXISTS (SELECT 1 FROM bis.Model m WHERE m.ECInstanceId = Model.Id)");
    await until(() => Array.from(document.querySelectorAll("button")).some((b) => b.textContent === "Where"), "clauses");
    act(() => button("Where").click());
    const chip = byLabel<HTMLInputElement>("input", "ECSQL condition");
    expect(chip.value).toMatch(/^EXISTS/);
  });
});
