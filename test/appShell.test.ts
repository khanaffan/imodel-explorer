import { describe, expect, it } from "vitest";
import { matchesShortcut } from "../src/frontend/commands/registry";
import { EMPTY_FILTERS, filterCount } from "../src/frontend/engine/filters";
import { iModelPathProblem } from "../src/common/iModelFiles";
import { formatBytes, summarizeAppMemory } from "../src/common/appMemory";
import { ABOUT_LINKS, formatVersionInfo, isAllowedExternalUrl, newIssueUrl } from "../src/common/about";

describe("iModelPathProblem", () => {
  it("accepts iModel extensions in any case on either path style", () => {
    expect(iModelPathProblem("/data/plant.bim")).toBeUndefined();
    expect(iModelPathProblem("C:\\data\\Plant.IBIM")).toBeUndefined();
    expect(iModelPathProblem("/data/x.imodel")).toBeUndefined();
  });
  it("rejects other files, extensionless names and empty paths by name", () => {
    expect(iModelPathProblem("/data/package.json")).toMatch(/^package\.json is not an iModel \(expected \.bim, \.ibim, \.imodel\)/);
    expect(iModelPathProblem("/data.bim/readme")).toMatch(/^readme is not an iModel/);
    expect(iModelPathProblem("")).toBe("No file was given.");
  });
});

describe("filterCount", () => {
  it("counts entries across every dimension", () => {
    expect(filterCount(EMPTY_FILTERS)).toBe(0);
    expect(filterCount({
      models: { "0x1": "exclude" }, schemas: { BisCore: "exclude" },
      classes: { "A:B": { state: "include", polymorphic: true } }, relationships: { "A:R": { state: "exclude", polymorphic: false } },
    })).toBe(4);
  });
});

describe("symbol shortcuts", () => {
  it("match '?' whether or not the layout needs Shift, but not with ⌘", () => {
    const ev = (shiftKey: boolean, metaKey = false) => ({ key: "?", shiftKey, metaKey, ctrlKey: false, altKey: false });
    expect(matchesShortcut({ key: "?" }, ev(true), true)).toBe(true);
    expect(matchesShortcut({ key: "?" }, ev(false), true)).toBe(true);
    expect(matchesShortcut({ key: "?" }, ev(true, true), true)).toBe(false);
  });
});

describe("app memory", () => {
  it("sums every process in kilobytes and groups them by type in a fixed order", () => {
    const m = summarizeAppMemory([
      { type: "Tab", memory: { workingSetSize: 2048 } },
      { type: "Browser", memory: { workingSetSize: 1024 } },
      { type: "Utility", memory: { workingSetSize: 512 } },
      { type: "GPU", memory: { workingSetSize: 256 } },
      { type: "Zygote", memory: { workingSetSize: 512 } },
      { type: "Tab", memory: { workingSetSize: Number.NaN } },
    ]);
    expect(m.groups).toEqual([
      { label: "Main & iModel backend", bytes: 1024 * 1024 },
      { label: "Window", bytes: 2048 * 1024 },
      { label: "GPU", bytes: 256 * 1024 },
      { label: "Other", bytes: 1024 * 1024 },
    ]);
    expect(m.totalBytes).toBe((1024 + 2048 + 256 + 1024) * 1024);
    expect(summarizeAppMemory([])).toEqual({ totalBytes: 0, groups: [] });
  });

  it("formats as MB below a gigabyte and GB above", () => {
    expect(formatBytes(612.4 * 1024 * 1024)).toBe("612 MB");
    expect(formatBytes(1.5 * 1024 ** 3)).toBe("1.5 GB");
  });
});

describe("about and feedback links", () => {
  const info = { appName: "iModel Data Explorer", appVersion: "0.1.0", itwinjs: "5.14.0", electron: "44.4.5", chrome: "140.0", node: "22.1", platform: "darwin", arch: "arm64", osVersion: "25.0.0" };

  it("opens only project, iTwin and Bentley pages over https", () => {
    for (const ok of Object.values(ABOUT_LINKS)) expect(isAllowedExternalUrl(ok)).toBe(true);
    expect(isAllowedExternalUrl(newIssueUrl("bug", info))).toBe(true);
    for (const bad of ["http://github.com/khanaffan/imodel-explorer", "https://github.com/someone/else", "https://github.com/khanaffan/imodel-explorer-evil",
      "https://github.com.evil.com/iTwin", "https://user@github.com/iTwin", "file:///etc/passwd", "javascript:alert(1)", "https://www.bentley.com.evil.com/", "not a url"])
      expect(isAllowedExternalUrl(bad), bad).toBe(false);
  });

  it("prefills new issues with a title prefix and the version details", () => {
    const url = new URL(newIssueUrl("bug", info));
    expect(url.pathname).toBe("/khanaffan/imodel-explorer/issues/new");
    expect(url.searchParams.get("title")).toBe("Bug: ");
    expect(url.searchParams.get("body")).toContain("Steps to reproduce");
    expect(url.searchParams.get("body")).toContain(formatVersionInfo(info));
    expect(new URL(newIssueUrl("feature", info)).searchParams.get("title")).toBe("Feature: ");
    expect(formatVersionInfo(info)).toBe("iModel Data Explorer 0.1.0\niTwin.js 5.14.0\nElectron 44.4.5 (Chromium 140.0, Node 22.1)\nOS darwin 25.0.0 (arm64)");
  });
});
