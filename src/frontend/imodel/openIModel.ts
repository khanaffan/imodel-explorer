import { BriefcaseConnection, type IModelConnection, SnapshotConnection } from "@itwin/core-frontend";

/** Opens a local file read-only. Tries it as a briefcase first (keeps local changesets and
 * txns visible), then as a snapshot. */
export async function openIModelFile(fileName: string): Promise<IModelConnection> {
  try {
    return await BriefcaseConnection.openFile({ fileName, readonly: true });
  } catch (briefcaseError) {
    try {
      return await SnapshotConnection.openFile(fileName);
    } catch {
      throw briefcaseError;
    }
  }
}

export async function closeIModel(connection: IModelConnection | undefined): Promise<void> {
  if (connection && !connection.isClosed)
    await connection.close();
}
