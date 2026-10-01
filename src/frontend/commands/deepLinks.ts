import { IpcApp } from "@itwin/core-frontend";
import { buildDeepLink, type DeepLink, parseDeepLink } from "../../common/deepLink";
import { DEEP_LINK_CHANNEL, DEEP_LINK_READY_CHANNEL } from "../../common/hostIpc";
import { parseNodeKey } from "../engine/GraphModel";
import { appHost } from "../host/AppHost";
import { openAndShow } from "../imodel/session";
import { listSessions } from "../services/sessionStore";
import { classGraphActions } from "../state/classGraphStore";
import { graphActions, useGraphStore } from "../state/graphStore";
import { runCommand } from "./registry";

/** A link to what the instance graph shows now; undefined when no iModel or centre. */
export function currentDeepLink(): string | undefined {
  const { fileName, graph } = useGraphStore.getState();
  if (!fileName || !graph.centreKey) return undefined;
  return buildDeepLink({ file: fileName, centre: parseNodeKey(graph.centreKey) });
}

function throwIfFailed() {
  const status = useGraphStore.getState().status;
  if (status.kind === "error") throw new Error(status.message);
}

/** Validates a link, then opens its file (only if not already open, and only once it is known to
 * exist, because opening closes the current iModel), restores its session and centres on its instance. */
export async function openDeepLink(text: string): Promise<DeepLink> {
  const link = parseDeepLink(text);
  const session = link.session === undefined ? undefined
    : listSessions().find((s) => s.fileName === link.file && s.name === link.session);
  if (link.session !== undefined && !session) throw new Error(`There is no saved session "${link.session}" for ${link.file.split(/[\\/]/).pop()}.`);
  if (useGraphStore.getState().fileName !== link.file) {
    if (!(await appHost.fileExists(link.file))) throw new Error(`${link.file} does not exist.`);
    await openAndShow(link.file);
  }
  classGraphActions.setMode("instances");
  if (session) await graphActions.restoreSession(session);
  if (link.centre && useGraphStore.getState().graph.centreKey !== `${link.centre.classId}:${link.centre.id}`) {
    if (session) await graphActions.centreOn(link.centre);
    else await graphActions.seedExternal(link.centre, { fit: true });
    throwIfFailed();
  }
  return link;
}

/** Listens for links the OS hands the backend, then tells it to send any it queued. Call once the
 * UI (and its toasts) are mounted. */
export function startDeepLinks(): () => void {
  const stop = IpcApp.addListener(DEEP_LINK_CHANNEL, (_evt, url: unknown) => {
    if (typeof url === "string") void runCommand("link.open", "ui", url);
  });
  IpcApp.send(DEEP_LINK_READY_CHANNEL);
  return stop;
}
