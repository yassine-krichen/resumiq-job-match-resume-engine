// Raw SQL cannot use Prisma's `schema=` URL parameter the way generated queries do: through a pooler such as
// Neon's PgBouncer the session `search_path` is not reliable, so the table is named with its schema. The schema
// comes from the validated database URL; this is the only place it is turned into SQL text, and it is checked here too.

const SCHEMA_NAME = /^[a-z_][a-z0-9_]*$/;
const TABLE_NAME = /^[A-Za-z][A-Za-z0-9]*$/;

export function qualifiedTable(schema: string, table: string): string {
  if (!SCHEMA_NAME.test(schema)) throw new Error('database schema name must match ^[a-z_][a-z0-9_]*$');
  if (!TABLE_NAME.test(table)) throw new Error('table name must be letters and digits');
  return `"${schema}"."${table}"`;
}
