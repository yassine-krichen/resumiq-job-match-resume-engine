import { normalizeDomain, normalizeRows, parseRowsFromText } from './normalize-input';

describe('normalizeRows', () => {
  it('takes the domain from the email and lowercases the address', () => {
    const { valid, invalid } = normalizeRows([{ company: 'Acme', email: 'Claire.Martin@Acme-Robotics.FR' }]);

    expect(invalid).toEqual([]);
    expect(valid[0]).toMatchObject({
      email: 'claire.martin@acme-robotics.fr',
      domain: 'acme-robotics.fr',
      freeMail: false,
      domainKey: 'acme-robotics.fr',
    });
  });

  it('uses the website host as the domain when the email is on a free-mail provider', () => {
    const { valid } = normalizeRows([
      { company: 'Acme', email: 'founder@gmail.com', website: 'https://www.Acme.io/about' },
    ]);

    expect(valid[0]).toMatchObject({ freeMail: true, domain: 'acme.io', domainKey: 'acme.io' });
  });

  it('keys a free-mail row without a website on the full address so unrelated gmail users do not collide', () => {
    const { valid } = normalizeRows([{ company: 'Solo Studio', email: 'Solo@Gmail.com' }]);

    expect(valid[0]).toMatchObject({ freeMail: true, domain: null, domainKey: 'solo@gmail.com' });
  });

  it('rejects a cell holding several addresses instead of silently picking one', () => {
    const { valid, invalid } = normalizeRows([{ company: 'Acme', email: 'a@acme.fr; b@acme.fr' }]);

    expect(valid).toEqual([]);
    expect(invalid).toHaveLength(1);
  });

  it('keeps the good rows when one row is invalid and reports its position', () => {
    const { valid, invalid } = normalizeRows([
      { company: 'Good', email: 'a@good.com' },
      { company: '', email: 'not-an-email' },
      { company: 'Also Good', email: 'b@alsogood.com' },
    ]);

    expect(valid.map((row) => row.company)).toEqual(['Good', 'Also Good']);
    expect(invalid).toHaveLength(1);
    expect(invalid[0].index).toBe(1);
    expect(invalid[0].errors.join(' ')).toMatch(/company/);
  });

  it('treats empty strings and nulls in optional fields as absent', () => {
    const { valid } = normalizeRows([
      { company: 'Acme', email: 'a@acme.com', name: '  ', role: null, website: '', notes: ' hi ' },
    ]);

    expect(valid[0].name).toBeUndefined();
    expect(valid[0].role).toBeUndefined();
    expect(valid[0].website).toBeUndefined();
    expect(valid[0].notes).toBe('hi');
  });
});

describe('normalizeDomain', () => {
  it.each([
    ['www.Acme.FR/careers', 'acme.fr'],
    ['https://acme.io:8080/x?y=1', 'acme.io'],
    ['HTTP://WWW.EXAMPLE.COM.', 'example.com'],
    ['cs.uni.edu', 'cs.uni.edu'],
  ])('reduces %s to %s', (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  it('returns null for something that is not a host', () => {
    expect(normalizeDomain('not a host')).toBeNull();
    expect(normalizeDomain('localhost')).toBeNull();
  });
});

describe('parseRowsFromText', () => {
  it('reads a French Excel CSV with semicolons, a BOM and accented headers', () => {
    const csv =
      '﻿Société;Courriel;Nom;Site web\r\n' +
      'Acme Robotics;claire@acme.fr;Claire Martin;acme.fr\r\n' +
      '"Dupont; Fils";contact@dupont.fr;;\r\n';

    const rows = parseRowsFromText(csv);

    expect(rows).toEqual([
      { company: 'Acme Robotics', email: 'claire@acme.fr', name: 'Claire Martin', website: 'acme.fr' },
      { company: 'Dupont; Fils', email: 'contact@dupont.fr', name: '', website: '' },
    ]);
    expect(normalizeRows(rows).valid).toHaveLength(2);
  });

  it('keeps commas inside quoted fields and doubled quotes in comma-separated files', () => {
    const rows = parseRowsFromText('company,email\n"Acme, Inc. ""Labs""",a@acme.com\n');

    expect(rows).toEqual([{ company: 'Acme, Inc. "Labs"', email: 'a@acme.com' }]);
  });

  it('skips blank lines and ignores unknown columns', () => {
    const rows = parseRowsFromText('company;email;internal id\n\nAcme;a@acme.com;42\n\n');

    expect(rows).toEqual([{ company: 'Acme', email: 'a@acme.com' }]);
  });

  it('reads JSON arrays and {rows} objects even when the file starts with a BOM', () => {
    const array = parseRowsFromText('﻿[{"company":"A","email":"a@a.com"}]');
    const wrapped = parseRowsFromText('﻿{"rows":[{"company":"A","email":"a@a.com"}]}');

    expect(array).toEqual(wrapped);
    expect(array).toHaveLength(1);
  });

  it('ignores header names that collide with Object.prototype members', () => {
    const rows = parseRowsFromText('constructor;__proto__;toString;company;email\nx;y;z;Acme;a@acme.com\n');

    expect(rows).toEqual([{ company: 'Acme', email: 'a@acme.com' }]);
  });

  it('throws on JSON that has no rows', () => {
    expect(() => parseRowsFromText('{"companies": []}')).toThrow(/rows/);
  });
});
