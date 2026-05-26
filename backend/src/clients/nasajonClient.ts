import { logger } from '../lib/logger.js';

const BASE_URL = process.env.NASAJON_BASE_URL || '';
const USER = process.env.NASAJON_USER || '';
const PASSWORD = process.env.NASAJON_PASSWORD || '';

function basicAuth(): string {
  return `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString('base64')}`;
}

export interface NasajonEmployee {
  employee_code: string;
  name: string;
  department: string;
  email: string | null;
  photo: string | null;
  active: boolean;
}

interface NasajonRawResponse {
  codigo: string;
  nome: string;
  departamento: string;
  email?: string | null;
  foto?: { data: number[] } | null;
  datarescisao: string | null;
}

export async function getEmployeeByCode(code: string): Promise<NasajonEmployee> {
  const url = `${BASE_URL}/trabalhadores/${encodeURIComponent(code)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: basicAuth() },
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    logger.error({ url, err }, 'Nasajon: connection failed');
    throw new Error('NASAJON_UNAVAILABLE');
  }

  if (res.status === 404) throw new Error('EMPLOYEE_NOT_FOUND');
  if (!res.ok) {
    logger.warn({ url, status: res.status }, 'Nasajon: non-OK HTTP status');
    throw new Error('NASAJON_UNAVAILABLE');
  }

  const raw = await res.json() as NasajonRawResponse;

  let photo: string | null = null;
  if (raw.foto?.data && Array.isArray(raw.foto.data) && raw.foto.data.length > 0) {
    photo = Buffer.from(raw.foto.data).toString('base64');
  }

  return {
    employee_code: raw.codigo,
    name: raw.nome,
    department: raw.departamento ?? '',
    email: raw.email ?? null,
    photo,
    active: raw.datarescisao === null,
  };
}

export async function isAvailable(): Promise<boolean> {
  const url = `${BASE_URL}/trabalhadores/000000`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: basicAuth() },
      signal: AbortSignal.timeout(8000),
    });
    // 404 = API reachable, employee just doesn't exist
    if (res.status === 404 || res.ok) return true;
    return false;
  } catch {
    logger.warn('Nasajon API unavailable');
    return false;
  }
}
