import { fallbackTimezone, overlapRegion, resolveLanguage } from './locale';

describe('resolveLanguage', () => {
  it.each(['FR', 'LU', 'MC', 'fr'])('writes French for %s', (country) => {
    expect(resolveLanguage({ country })).toBe('fr');
  });

  it.each(['DE', 'US', 'GB', 'TN', 'ES', 'NL'])('writes English for %s (no German, no local languages)', (country) => {
    expect(resolveLanguage({ country })).toBe('en');
  });

  it('writes French for French-speaking Belgium and English for Flanders', () => {
    expect(resolveLanguage({ country: 'BE', region: 'Liège, Wallonie' })).toBe('fr');
    expect(resolveLanguage({ country: 'BE', region: 'Bruxelles' })).toBe('fr');
    expect(resolveLanguage({ country: 'BE', region: 'Ghent' })).toBe('en');
  });

  it('writes French for Romandie and English for German-speaking Switzerland', () => {
    expect(resolveLanguage({ country: 'CH', region: 'Genève' })).toBe('fr');
    expect(resolveLanguage({ country: 'CH', region: 'Lausanne, Vaud' })).toBe('fr');
    expect(resolveLanguage({ country: 'CH', region: 'Zürich' })).toBe('en');
  });

  it('writes French for Quebec and English for the rest of Canada', () => {
    expect(resolveLanguage({ country: 'CA', region: 'Montréal, QC' })).toBe('fr');
    expect(resolveLanguage({ country: 'CA', region: 'Québec' })).toBe('fr');
    expect(resolveLanguage({ country: 'CA', region: 'Toronto, Ontario' })).toBe('en');
  });

  it('matches whole words only, so "Jurassic" is not the canton of Jura', () => {
    expect(resolveLanguage({ country: 'CH', region: 'Jurassic Park AG' })).toBe('en');
  });

  it('falls back to English for a bilingual country with no region information', () => {
    expect(resolveLanguage({ country: 'BE' })).toBe('en');
    expect(resolveLanguage({ country: 'CH' })).toBe('en');
    expect(resolveLanguage({ country: 'CA' })).toBe('en');
  });

  it('uses the timezone only when the country is unknown', () => {
    expect(resolveLanguage({ timezone: 'Europe/Paris' })).toBe('fr');
    expect(resolveLanguage({ timezone: 'Europe/Berlin' })).toBe('en');
    expect(resolveLanguage({ country: 'DE', timezone: 'Europe/Paris' })).toBe('en');
    expect(resolveLanguage({})).toBe('en');
  });
});

describe('fallbackTimezone', () => {
  it('maps a country to its main zone, with the US on Eastern time', () => {
    expect(fallbackTimezone('US')).toBe('America/New_York');
    expect(fallbackTimezone('fr')).toBe('Europe/Paris');
    expect(fallbackTimezone('TN')).toBe('Africa/Tunis');
  });

  it('returns null for a country it does not know', () => {
    expect(fallbackTimezone('ZZ')).toBeNull();
  });
});

describe('overlapRegion', () => {
  it('picks the overlap line family from the recipient timezone', () => {
    expect(overlapRegion('Europe/Paris')).toBe('europe');
    expect(overlapRegion('America/Los_Angeles')).toBe('us');
    expect(overlapRegion('Asia/Singapore')).toBe('other');
  });

  it('maps only US and Canadian America/* zones to the US overlap line', () => {
    expect(overlapRegion('America/Toronto')).toBe('us');
    expect(overlapRegion('America/Indiana/Indianapolis')).toBe('us');
    expect(overlapRegion('America/Sao_Paulo')).toBe('other');
    expect(overlapRegion('America/Mexico_City')).toBe('other');
    expect(overlapRegion('America/Argentina/Buenos_Aires')).toBe('other');
  });

  it('maps legacy US/* and Canada/* zone names and Hawaii', () => {
    expect(overlapRegion('US/Pacific')).toBe('us');
    expect(overlapRegion('US/Eastern')).toBe('us');
    expect(overlapRegion('Canada/Eastern')).toBe('us');
    expect(overlapRegion('Pacific/Honolulu')).toBe('us');
  });
});
