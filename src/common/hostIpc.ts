/** Channels between the backend and the preload / renderer that are not part of the menu. */
export const FILE_EXISTS_CHANNEL = "imodel-explorer.file-exists";
/** Renderer → backend: memory used by every process of the app (an `AppMemory`). */
export const APP_MEMORY_CHANNEL = "imodel-explorer.app-memory";
/** Backend → renderer: a deep link the OS handed to the app. */
export const DEEP_LINK_CHANNEL = "imodel-explorer.deep-link";
/** Renderer → backend: links can be delivered now (sent once the listener is installed). */
export const DEEP_LINK_READY_CHANNEL = "imodel-explorer.deep-link-ready";
