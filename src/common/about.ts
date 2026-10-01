/** Project links, version details and feedback URLs for Help → About and the feedback commands. */

export const REPOSITORY_URL = "https://github.com/khanaffan/imodel-explorer";

export const ABOUT_LINKS = {
  repository: REPOSITORY_URL,
  license: `${REPOSITORY_URL}/blob/main/LICENSE`,
  itwinjs: "https://www.itwinjs.org/",
  itwinGitHub: "https://github.com/iTwin",
  bentley: "https://www.bentley.com/",
} as const;

/** What the backend knows about the running app; the renderer adds the iTwin.js version. */
export interface HostInfo {
  readonly appVersion: string;
  readonly electron: string;
  readonly chrome: string;
  readonly node: string;
  readonly platform: string;
  readonly arch: string;
  readonly osVersion: string;
}

export interface VersionInfo extends HostInfo {
  readonly appName: string;
  readonly itwinjs: string;
}

export function formatVersionInfo(v: VersionInfo): string {
  return [
    `${v.appName} ${v.appVersion}`,
    `iTwin.js ${v.itwinjs}`,
    `Electron ${v.electron} (Chromium ${v.chrome}, Node ${v.node})`,
    `OS ${v.platform} ${v.osVersion} (${v.arch})`,
  ].join("\n");
}

export type FeedbackKind = "bug" | "feature";

/** A prefilled "new issue" page; the version details help reproduce bugs. */
export function newIssueUrl(kind: FeedbackKind, v: VersionInfo): string {
  const body = kind === "bug"
    ? `### What happened?\n\n\n### Steps to reproduce\n1. \n\n### What did you expect?\n\n\n### Version\n\`\`\`\n${formatVersionInfo(v)}\n\`\`\`\n`
    : `### What would you like to do?\n\n\n### Why does it matter to you?\n\n\n### Version\n\`\`\`\n${formatVersionInfo(v)}\n\`\`\`\n`;
  const params = new URLSearchParams({ title: kind === "bug" ? "Bug: " : "Feature: ", body });
  return `${REPOSITORY_URL}/issues/new?${params.toString()}`;
}

const ALLOWED: ReadonlyArray<{ readonly origin: string; readonly pathPrefixes?: readonly string[] }> = [
  { origin: "https://github.com", pathPrefixes: ["/khanaffan/imodel-explorer", "/iTwin"] },
  { origin: "https://www.itwinjs.org" },
  { origin: "https://www.bentley.com" },
];

/** The backend opens only these in the system browser, so the renderer cannot launch arbitrary
 * URLs or other protocols. */
export function isAllowedExternalUrl(text: string): boolean {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  return ALLOWED.some((a) => url.origin === a.origin
    && (!a.pathPrefixes || a.pathPrefixes.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))));
}
