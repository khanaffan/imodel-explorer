import { useToaster } from "@itwin/itwinui-react";
import { useEffect } from "react";
import { setNotificationSink } from "./notify";

/** Shows `notify` messages as iTwinUI toasts. Mount once inside the theme provider. */
export function ToastBridge() {
  const toaster = useToaster();
  useEffect(() => {
    toaster.setSettings({ placement: "bottom-end" });
    setNotificationSink(({ kind, message }) => {
      const options = { hasCloseButton: true, duration: kind === "error" ? 10000 : 5000 };
      if (kind === "success") toaster.positive(message, options);
      else if (kind === "info") toaster.informational(message, options);
      else if (kind === "warning") toaster.warning(message, options);
      else toaster.negative(message, options);
    });
    return () => setNotificationSink(undefined);
  }, [toaster]);
  return null;
}
