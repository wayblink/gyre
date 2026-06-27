declare module 'alasql' {
  export interface AlaSqlInstance {
    (sql: string, params?: unknown[]): unknown;
    tables: Record<string, { data: Array<Record<string, unknown>> }>;
  }

  const alasql: AlaSqlInstance;
  export default alasql;
}
