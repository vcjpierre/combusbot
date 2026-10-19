import { describe, it, expect } from 'vitest';
import { ScrapeWatchdog } from '../src/scrape-watchdog';

const DEAD_URL = 'https://app9.biocloud.info/saldos/main/donde/134';

describe('ScrapeWatchdog', () => {
  it('stays silent when nothing ever failed', () => {
    const watchdog = new ScrapeWatchdog(DEAD_URL);
    expect(watchdog.registerSuccess()).toBeNull();
  });

  it('alerts on the first failure, including the reason and the url', () => {
    const watchdog = new ScrapeWatchdog(DEAD_URL);
    const alert = watchdog.registerFailure('la página no devolvió estaciones');
    expect(alert).not.toBeNull();
    expect(alert).toContain('la página no devolvió estaciones');
    expect(alert).toContain(DEAD_URL);
  });

  it('does not repeat the alert while the same failure continues', () => {
    const watchdog = new ScrapeWatchdog(DEAD_URL);
    expect(watchdog.registerFailure('la página no devolvió estaciones')).not.toBeNull();
    expect(watchdog.registerFailure('la página no devolvió estaciones')).toBeNull();
    expect(watchdog.registerFailure('HTTP 404 after 3 attempts')).toBeNull();
  });

  it('reports recovery only once, and only after a failure', () => {
    const watchdog = new ScrapeWatchdog(DEAD_URL);
    watchdog.registerFailure('la página no devolvió estaciones');
    const recovery = watchdog.registerSuccess();
    expect(recovery).not.toBeNull();
    expect(recovery).toContain(DEAD_URL);
    expect(watchdog.registerSuccess()).toBeNull();
  });

  it('alerts again when a new failure episode starts after a recovery', () => {
    const watchdog = new ScrapeWatchdog(DEAD_URL);
    watchdog.registerFailure('la página no devolvió estaciones');
    watchdog.registerSuccess();
    expect(watchdog.registerFailure('la página no devolvió estaciones')).not.toBeNull();
  });
});
