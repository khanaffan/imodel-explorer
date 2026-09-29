import { IModelReadRpcInterface, IModelTileRpcInterface, type RpcInterfaceDefinition, SnapshotIModelRpcInterface } from "@itwin/core-common";

export const APP_TITLE = "InstanceGraph";

/** Must be identical on both sides of the Electron bridge. */
export function getRpcInterfaces(): RpcInterfaceDefinition[] {
  return [IModelReadRpcInterface, IModelTileRpcInterface, SnapshotIModelRpcInterface];
}
