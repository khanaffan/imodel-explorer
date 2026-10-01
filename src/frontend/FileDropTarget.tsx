import { SvgImodel } from "@itwin/itwinui-icons-react";
import { useEffect, useState } from "react";
import { notify } from "./commands/notify";
import { runCommand } from "./commands/registry";
import { appHost } from "./host/AppHost";
import { useGraphStore } from "./state/graphStore";

const carriesFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;

/** Opens an iModel dropped anywhere on the window. Listens in the capture phase and always
 * prevents the default so a dropped file never navigates the window away from the app. */
export function FileDropTarget() {
  const [over, setOver] = useState(false);
  const [opening, setOpening] = useState<string>();
  const hasIModel = useGraphStore((s) => s.connection !== undefined);

  useEffect(() => {
    let depth = 0;
    const open = async (files: FileList) => {
      if (files.length !== 1) {
        notify.error("Drop one iModel file at a time.");
        return;
      }
      const file = files[0];
      let path: string | undefined;
      try {
        path = appHost.pathForDroppedFile(file);
      } catch (e) {
        notify.error(e instanceof Error ? e.message : String(e));
        return;
      }
      if (!path) {
        notify.error(`${file.name} has no location on disk. Drop a file from your file manager.`);
        return;
      }
      setOpening(file.name);
      try {
        await runCommand("file.openPath", "ui", path);
      } finally {
        setOpening(undefined);
      }
    };
    const onEnter = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      depth++;
      setOver(true);
    };
    const onOver = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth = 0;
      setOver(false);
      if (e.dataTransfer) void open(e.dataTransfer.files);
    };
    const listeners = [["dragenter", onEnter], ["dragover", onOver], ["dragleave", onLeave], ["drop", onDrop]] as const;
    for (const [type, fn] of listeners) window.addEventListener(type, fn, true);
    return () => { for (const [type, fn] of listeners) window.removeEventListener(type, fn, true); };
  }, []);

  if (!over && !opening) return null;
  return (
    <div className="ig-drop" role="status" aria-live="polite">
      <div className="ig-drop__card">
        <SvgImodel width={32} height={32} aria-hidden="true" />
        {opening ? <span>Opening {opening}…</span>
          : <span>Drop an iModel to open it{hasIModel ? " (closes the current one)" : ""}</span>}
      </div>
    </div>
  );
}
