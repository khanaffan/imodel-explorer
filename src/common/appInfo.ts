import { ECSchemaRpcInterface } from "@itwin/ecschema-rpcinterface-common";
import { PresentationRpcInterface } from "@itwin/presentation-common";
import { IModelReadRpcInterface, IModelTileRpcInterface, type RpcInterfaceDefinition, SnapshotIModelRpcInterface } from "@itwin/core-common";

export const APP_TITLE = "InstanceGraph";

/** Must be identical on both sides of the Electron bridge. */
export function getRpcInterfaces(): RpcInterfaceDefinition[] {
  // ECSchemaRpcInterface and PresentationRpcInterface serve the models/categories/classifications trees.
  return [IModelReadRpcInterface, IModelTileRpcInterface, SnapshotIModelRpcInterface, ECSchemaRpcInterface, PresentationRpcInterface];
}
