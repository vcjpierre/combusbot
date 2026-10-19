import { escapeMarkdown } from './types';

/**
 * Tracks consecutive scrape failures so the operator is alerted once per outage
 * instead of once per cron run. A failure episode starts on the first failed or
 * empty scrape and only ends when a scrape produces stations again.
 */
export class ScrapeWatchdog {
  private failing = false;

  constructor(private readonly url: string) {}

  /**
   * Call after a scrape that produced usable stations.
   * Returns a one-off recovery notice, or null when nothing was failing.
   */
  registerSuccess(): string | null {
    if (!this.failing) return null;
    this.failing = false;
    return [
      '✅ *El bot volvió a funcionar*',
      '',
      'El scraping volvió a devolver estaciones.',
      `🌐 URL: ${this.url}`,
    ].join('\n');
  }

  /**
   * Call when a scrape returned no stations or could not complete.
   * Returns the alert to send, or null when this episode was already reported.
   */
  registerFailure(reason: string): string | null {
    if (this.failing) return null;
    this.failing = true;
    return [
      '🚨 *El bot no está pudiendo traer datos*',
      '',
      `📝 Motivo: ${escapeMarkdown(reason)}`,
      `🌐 URL: ${this.url}`,
      '',
      'Revisá si el sitio cambió. Mientras tanto no vas a recibir notificaciones de combustible.',
    ].join('\n');
  }
}
