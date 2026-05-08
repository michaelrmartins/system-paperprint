import { SituatorPerson } from '../types/index.js';

const BASE_URL = process.env.SITUATOR_BASE_URL || 'http://network-services-middleware-situator.intranet.local/api/v1';
const USER = process.env.SITUATOR_USER || '';
const PASSWORD = process.env.SITUATOR_PASSWORD || '';

function basicAuth(): string {
  return `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString('base64')}`;
}

export async function getPersonByCardHex(cardNumberHex: string): Promise<SituatorPerson> {
  const res = await fetch(`${BASE_URL}/person/card/hex/${encodeURIComponent(cardNumberHex)}`, {
    method: 'GET',
    headers: { Authorization: basicAuth() },
    signal: AbortSignal.timeout(8000),
  });

  if (res.status === 404) throw new Error('CARD_NOT_FOUND');
  if (!res.ok) throw new Error(`Situator HTTP ${res.status}`);

  // API returns an array — take the first element
  const data = await res.json() as SituatorPerson | SituatorPerson[];
  const person = Array.isArray(data) ? data[0] : data;

  if (!person) throw new Error('CARD_NOT_FOUND');

  return person;
}
