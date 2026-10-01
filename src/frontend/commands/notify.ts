/** Transient user notifications. Non-React code reports through here; `<ToastBridge>` shows them
 * with the iTwinUI toaster. Messages raised before the bridge mounts are kept until it does. */
export type NotifyKind = "success" | "info" | "warning" | "error";
export interface Notification { readonly kind: NotifyKind; readonly message: string }
type Sink = (n: Notification) => void;

let sink: Sink | undefined;
const pending: Notification[] = [];

function emit(kind: NotifyKind, message: string) {
  const n = { kind, message };
  if (sink) sink(n);
  else pending.push(n);
}

export const notify = {
  success: (message: string) => emit("success", message),
  info: (message: string) => emit("info", message),
  warning: (message: string) => emit("warning", message),
  error: (message: string) => emit("error", message),
};

export function setNotificationSink(next: Sink | undefined): void {
  sink = next;
  if (sink) for (const n of pending.splice(0)) sink(n);
}
