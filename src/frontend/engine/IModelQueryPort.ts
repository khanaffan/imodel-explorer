import { QueryBinder, QueryOptions, QueryRowFormat } from "@itwin/core-common";
import type { SchemaView } from "@itwin/ecschema-metadata";

/** The structural subset of `ECSqlReader` the engine relies on. */
type RowReader = AsyncIterable<{ toRow(): any }>;

/** Satisfied by both the frontend `IModelConnection` and the backend `IModelDb`, which is what lets
 * the engine run unchanged in the app and in Node tests. */
export interface QuerySource {
  createQueryReader(ecsql: string, params?: QueryBinder, config?: QueryOptions): RowReader;
  getSchemaView(): Promise<SchemaView>;
}

export type Row = Record<string, any>;

export interface IModelQueryPort {
  query(ecsql: string, binder?: QueryBinder, options?: { limit?: number }): Promise<Row[]>;
  getSchemaView(): Promise<SchemaView>;
}

export function createQueryPort(source: QuerySource): IModelQueryPort {
  return {
    async query(ecsql, binder, options) {
      const rows: Row[] = [];
      const reader = source.createQueryReader(ecsql, binder, {
        rowFormat: QueryRowFormat.UseECSqlPropertyNames,
        abbreviateBlobs: true,
        limit: options?.limit !== undefined ? { count: options.limit } : undefined,
      });
      for await (const row of reader)
        rows.push(row.toRow());
      return rows;
    },
    getSchemaView: async () => source.getSchemaView(),
  };
}
