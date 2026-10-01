import { ITWINJS_CORE_VERSION } from "@itwin/core-frontend";
import { Button, Modal, ModalButtonBar, ModalContent, Text } from "@itwin/itwinui-react";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { ABOUT_LINKS, formatVersionInfo, newIssueUrl, type VersionInfo } from "../../common/about";
import { APP_TITLE } from "../../common/appInfo";
import { appHost } from "../host/AppHost";
import { notify } from "./notify";
import "./palette.css";

export const useAboutStore = create<{ readonly open: boolean }>(() => ({ open: false }));
export const aboutActions = {
  open: () => useAboutStore.setState({ open: true }),
  close: () => useAboutStore.setState({ open: false }),
};

export async function versionInfo(): Promise<VersionInfo> {
  return { appName: APP_TITLE, itwinjs: ITWINJS_CORE_VERSION, ...(await appHost.hostInfo()) };
}

/** Opens a project link in the system browser, reporting failures as a toast. */
export function openProjectLink(url: string): void {
  appHost.openExternal(url).catch((e: unknown) => notify.error(`Could not open the link: ${e instanceof Error ? e.message : String(e)}`));
}

export async function openFeedback(kind: "bug" | "feature"): Promise<void> {
  await appHost.openExternal(newIssueUrl(kind, await versionInfo()));
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="ig-about__link" onClick={(e) => { e.preventDefault(); openProjectLink(href); }}>{children}</a>
  );
}

/** Help → About: versions, project and iTwin links, and ways to give feedback. */
export function AboutDialog() {
  const open = useAboutStore((s) => s.open);
  const [info, setInfo] = useState<VersionInfo>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open || info) return;
    let live = true;
    versionInfo().then((v) => { if (live) setInfo(v); }, (e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [open, info]);

  const copy = () => {
    if (!info) return;
    navigator.clipboard.writeText(formatVersionInfo(info)).then(
      () => notify.success("Version details copied."),
      (e: unknown) => notify.error(`Could not copy: ${e instanceof Error ? e.message : String(e)}`));
  };

  return (
    <Modal isOpen={open} title={`About ${APP_TITLE}`} onClose={aboutActions.close} className="ig-about">
      <ModalContent>
        <div data-testid="about">
          <Text variant="leading">{APP_TITLE} {info?.appVersion}</Text>
          <Text isMuted>Explore the instances and relationships in an iModel as a graph.</Text>
          {error && <div className="ig-error">{error}</div>}
          <dl className="ig-about__versions">
            <dt>iTwin.js</dt><dd>{ITWINJS_CORE_VERSION}</dd>
            {info && <>
              <dt>Electron</dt><dd>{info.electron}</dd>
              <dt>Chromium</dt><dd>{info.chrome}</dd>
              <dt>Node</dt><dd>{info.node}</dd>
              <dt>OS</dt><dd>{info.platform} {info.osVersion} ({info.arch})</dd>
            </>}
          </dl>
          <ul className="ig-about__links">
            <li><ExternalLink href={ABOUT_LINKS.repository}>Source code on GitHub</ExternalLink></li>
            <li><ExternalLink href={ABOUT_LINKS.license}>MIT licence</ExternalLink></li>
            <li>Built with <ExternalLink href={ABOUT_LINKS.itwinjs}>iTwin.js</ExternalLink> (<ExternalLink href={ABOUT_LINKS.itwinGitHub}>iTwin on GitHub</ExternalLink>)
              {" "}from <ExternalLink href={ABOUT_LINKS.bentley}>Bentley Systems, Incorporated</ExternalLink></li>
          </ul>
          <Text variant="small" isMuted>Enjoying it? A star on GitHub helps others find it. Found a problem or have an idea? Tell us.</Text>
        </div>
      </ModalContent>
      <ModalButtonBar>
        <Button styleType="borderless" disabled={!info} onClick={copy}>Copy version details</Button>
        <Button disabled={!info} onClick={() => void openFeedback("bug").catch((e: unknown) => notify.error(String(e instanceof Error ? e.message : e)))}>Report a bug</Button>
        <Button onClick={() => openProjectLink(ABOUT_LINKS.repository)}>⭐ Star on GitHub</Button>
        <Button styleType="high-visibility" onClick={aboutActions.close}>Close</Button>
      </ModalButtonBar>
    </Modal>
  );
}
