import { qualifiedTable } from './sql-identifiers';

describe('qualifiedTable', () => {
  it('names the table with its quoted schema', () => {
    expect(qualifiedTable('outreach', 'OutreachLease')).toBe('"outreach"."OutreachLease"');
    expect(qualifiedTable('_my_schema2', 'OutreachLease')).toBe('"_my_schema2"."OutreachLease"');
  });

  it.each(['', 'Outreach', 'out reach', 'a"b', 'a;drop table x', 'a-b', '1abc', 'public"."x'])('refuses the schema %j', (schema) => {
    expect(() => qualifiedTable(schema, 'OutreachLease')).toThrow(/schema/);
  });

  it('refuses a table name that is not plain letters and digits', () => {
    expect(() => qualifiedTable('outreach', 'Lease"; --')).toThrow(/table/);
  });
});
