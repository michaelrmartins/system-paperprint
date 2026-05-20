import { SituatorPerson } from '../types/index.js';
import { logger } from '../lib/logger.js';

const BASE_URL = process.env.SITUATOR_BASE_URL || 'http://network-services-middleware-situator.intranet.local/api/v1';
const USER = process.env.SITUATOR_USER || '';
const PASSWORD = process.env.SITUATOR_PASSWORD || '';

function basicAuth(): string {
  return `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString('base64')}`;
}

function classifyError(err: unknown): { code?: string; name: string; message: string } {
  const e = err as NodeJS.ErrnoException;
  return {
    code: e.code,
    name: e.name ?? 'UnknownError',
    message: e.message ?? String(err),
  };
}

export async function getPersonByCardHex(cardNumberHex: string): Promise<SituatorPerson> {
  const url = `${BASE_URL}/person/card/hex/${encodeURIComponent(cardNumberHex)}`;
  logger.info({ situator_url: BASE_URL, card: cardNumberHex }, 'Situator: starting request');

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: basicAuth() },
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    const { code, name, message } = classifyError(err);
    // Common codes: ENOTFOUND = DNS failed, ECONNREFUSED = port closed,
    // ETIMEDOUT = routed but no response, TimeoutError = AbortSignal fired
    logger.error(
      { situator_url: url, error_code: code, error_name: name, error_message: message },
      'Situator: connection failed — check SITUATOR_BASE_URL and network routing from inside the container'
    );
    throw err;
  }

  logger.info({ url, status: res.status }, 'Situator: response received');

  if (res.status === 404) throw new Error('CARD_NOT_FOUND');
  if (!res.ok) {
    logger.warn({ url, status: res.status }, 'Situator: non-OK HTTP status');
    throw new Error(`Situator HTTP ${res.status}`);
  }

  const data = await res.json() as SituatorPerson | SituatorPerson[];
  const person = Array.isArray(data) ? data[0] : data;

  if (!person) throw new Error('CARD_NOT_FOUND');

  return person;
}

export async function testConnection(): Promise<{
  ok: boolean;
  configured_url: string;
  error?: string;
  error_code?: string;
  error_name?: string;
  http_status?: number;
  hint?: string;
}> {
  const configured_url = BASE_URL;
  // Use a dummy hex to probe reachability; a 404 means the API is up
  const probeUrl = `${BASE_URL}/person/card/hex/00000000`;
  logger.info({ probe_url: probeUrl }, 'Situator: running connection test');

  try {
    const res = await fetch(probeUrl, {
      method: 'GET',
      headers: { Authorization: basicAuth() },
      signal: AbortSignal.timeout(5000),
    });
    // 404 = API reachable, card just doesn't exist — that's fine
    if (res.status === 404 || res.ok) {
      logger.info({ probe_url: probeUrl, status: res.status }, 'Situator: connection test passed');
      return { ok: true, configured_url, http_status: res.status };
    }
    logger.warn({ probe_url: probeUrl, status: res.status }, 'Situator: test got unexpected HTTP status');
    return {
      ok: false, configured_url, http_status: res.status,
      error: `Unexpected HTTP ${res.status}`,
      hint: 'API is reachable but returned an unexpected status. Check SITUATOR_USER / SITUATOR_PASSWORD.',
    };
  } catch (err) {
    const { code, name, message } = classifyError(err);
    let hint = 'Unknown network error.';
    if (code === 'ENOTFOUND') hint = 'DNS resolution failed. Set SITUATOR_BASE_URL to the server\'s direct IP (e.g. http://192.168.X.X/api/v1).';
    else if (code === 'ECONNREFUSED') hint = 'Connection refused. The server is reachable but the port is closed or the service is down.';
    else if (code === 'ETIMEDOUT') hint = 'Connection timed out. The host may be unreachable from inside Docker. Check firewall/routing.';
    else if (name === 'TimeoutError') hint = 'Request timed out after 5 s. Host is reachable but not responding. Check if the service is running.';

    logger.error({ probe_url: probeUrl, error_code: code, error_name: name, error_message: message, hint }, 'Situator: connection test failed');
    return { ok: false, configured_url, error: message, error_code: code, error_name: name, hint };
  }
}
