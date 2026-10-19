import { describe, it, expect } from 'vitest';
import { DEFAULT_SCRAPER_URL } from '../src/config';

describe('DEFAULT_SCRAPER_URL', () => {
  it('is exported as a non-empty string', () => {
    expect(typeof DEFAULT_SCRAPER_URL).toBe('string');
    expect(DEFAULT_SCRAPER_URL.length).toBeGreaterThan(0);
  });

  it('targets the Gasolina page instead of the retired numeric product id', () => {
    expect(DEFAULT_SCRAPER_URL).toBe('https://app9.biocloud.info/saldos/main/donde/G');
    expect(DEFAULT_SCRAPER_URL).not.toMatch(/donde\/\d+$/);
  });
});
