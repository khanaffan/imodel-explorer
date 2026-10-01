import { iModelPathProblem } from "./iModelFiles";

export const DEEP_LINK_PROTOCOL = "imodel-explorer";
const PREFIX = `${DEEP_LINK_PROTOCOL}://`;
const MAX_LINK_LENGTH = 4096;
const MAX_SESSION_NAME = 200;
const ID64 = /^0x[1-9a-f][0-9a-f]{0,15}$/;

export interface DeepLink {
  /** Absolute path of the iModel. */
  readonly file: string;
  readonly centre?: { readonly classId: string; readonly id: string };
  /** Name of a saved session for that file, restored after opening. */
  readonly session?: string;
}

/** Whether `text` claims to be a deep link (whether or not it is a valid one). */
export function looksLikeDeepLink(text: string): boolean {
  return text.trim().toLowerCase().startsWith(PREFIX);
}

const isAbsolutePath = (p: string) => p.startsWith("/") || /^[a-z]:[\\/]/i.test(p) || p.startsWith("\\\\");

/** Parses `imodel-explorer://open?file=<path>[&centre=<classId>:<id>][&session=<name>]`. Throws
 * an error saying what is wrong; never returns a partially valid link. */
export function parseDeepLink(text: string): DeepLink {
  const raw = text.trim();
  if (raw.length > MAX_LINK_LENGTH) throw new Error("The link is too long.");
  if (!looksLikeDeepLink(raw)) throw new Error(`Not an iModel Data Explorer link (expected ${PREFIX}open?file=…).`);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("The link is malformed.");
  }
  // Custom schemes put "open" in the host; tolerate a path form ("imodel-explorer:///open") too.
  const action = (url.host || url.pathname.replace(/^\/+/, "")).toLowerCase();
  if (action !== "open") throw new Error(`Unknown link action "${action || "(none)"}"; only "open" is supported.`);
  for (const key of url.searchParams.keys())
    if (key !== "file" && key !== "centre" && key !== "session") throw new Error(`Unknown link parameter "${key}".`);
  const once = (key: string) => {
    const all = url.searchParams.getAll(key);
    if (all.length > 1) throw new Error(`The link repeats "${key}".`);
    return all[0];
  };

  const file = once("file");
  if (!file) throw new Error("The link does not name a file.");
  if (!isAbsolutePath(file)) throw new Error("The link's file must be an absolute path.");
  const problem = iModelPathProblem(file);
  if (problem) throw new Error(problem);

  const centreText = once("centre");
  let centre: DeepLink["centre"];
  if (centreText !== undefined) {
    const [classId, id, extra] = centreText.toLowerCase().split(":");
    if (extra !== undefined || !classId || !id || !ID64.test(classId) || !ID64.test(id))
      throw new Error(`"${centreText}" is not an instance key (expected <classId>:<id>, both hex ids like 0x1a).`);
    centre = { classId, id };
  }

  const session = once("session");
  if (session !== undefined && (!session.trim() || session.length > MAX_SESSION_NAME))
    throw new Error("The link's session name is empty or too long.");

  return { file, ...(centre ? { centre } : {}), ...(session !== undefined ? { session } : {}) };
}

export function buildDeepLink(link: DeepLink): string {
  const params = new URLSearchParams({ file: link.file });
  if (link.centre) params.set("centre", `${link.centre.classId}:${link.centre.id}`);
  if (link.session) params.set("session", link.session);
  return `${PREFIX}open?${params.toString()}`;
}

/** The first deep link among command-line arguments (Windows/Linux pass the link this way). */
export function findDeepLinkArg(argv: readonly string[]): string | undefined {
  return argv.find((a) => looksLikeDeepLink(a));
}
