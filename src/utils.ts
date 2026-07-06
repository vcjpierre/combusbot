import { getLogger } from './logger';

export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = 3,
  baseDelay = 1000,
): Promise<Response> {
  const logger = getLogger();
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      logger.warn({ status: res.status, attempt }, 'HTTP non-OK response');
      if (attempt === retries) throw new Error(`HTTP ${res.status} after ${retries} attempts`);
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = baseDelay * 2 ** (attempt - 1);
      logger.warn({ attempt, delay, error: (err as Error).message }, 'Fetch failed, retrying');
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('unreachable');
}

export async function fetchHTML(url: string): Promise<string> {
  const { HTTP_HEADERS } = await import('./config');
  const res = await fetchWithRetry(url, { headers: HTTP_HEADERS });
  return res.text();
}

export async function writeJsonAsync(filePath: string, data: unknown): Promise<void> {
  const { writeFile, mkdir } = await import('fs/promises');
  const { dirname } = await import('path');
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}
