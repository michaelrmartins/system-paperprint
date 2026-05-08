import { LyceumStudent } from '../types/index.js';
import { logger } from '../lib/logger.js';

const BASE_URL = process.env.LYCEUM_BASE_URL || 'http://192.168.50.157:4000/api/v1';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
  if (res.status === 404) {
    throw new Error('STUDENT_NOT_FOUND');
  }
  if (!res.ok) {
    throw new Error(`LYCEUM_HTTP_${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function getStudentByRegistration(registrationNumber: string): Promise<LyceumStudent> {
  const result = await fetchJson<unknown>(`${BASE_URL}/alunos/${encodeURIComponent(registrationNumber)}`);

  let raw: unknown = result;
  if (Array.isArray(raw)) raw = raw[0];
  if (raw !== null && typeof raw === 'object' && 'data' in (raw as object)) {
    raw = (raw as { data: unknown }).data;
  }

  return raw as LyceumStudent;
}

export async function getStudentPhoto(personCode: string): Promise<string> {
  const result = await fetchJson<unknown>(`${BASE_URL}/pessoas/foto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codPessoa: personCode }),
  });

  if (typeof result === 'string') return maybeHexToBase64(result);

  if (result !== null && typeof result === 'object') {
    const data = result as Record<string, unknown>;
    const raw = data['foto'] ?? data['imagem'] ?? data['base64'];
    if (typeof raw === 'string') return maybeHexToBase64(raw);
  }

  throw new Error('Lyceum photo response has no recognisable image field');
}

function maybeHexToBase64(value: string): string {
  const clean = value.replace(/\s+/g, '');
  if (clean.length > 0 && clean.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(clean)) {
    return Buffer.from(clean, 'hex').toString('base64');
  }
  return value; // already base64
}

export async function isAvailable(): Promise<boolean> {
  try {
    await fetchJson(`${BASE_URL}/health`);
    return true;
  } catch {
    logger.warn('Lyceum API unavailable');
    return false;
  }
}
