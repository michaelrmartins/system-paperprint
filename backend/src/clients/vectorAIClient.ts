import { VectorAIResult } from '../types/index.js';

const BASE_URL = process.env.VECTOR_AI_BASE_URL || 'http://192.168.50.157:5000';

export async function recognizeFace(imageBase64: string): Promise<VectorAIResult | null> {
  const res = await fetch(`${BASE_URL}/recognize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: imageBase64 }),
    signal: AbortSignal.timeout(10000),
  });

  if (res.status === 404 || res.status === 204) {
    return null;
  }

  if (!res.ok) {
    throw new Error(`VectorAI HTTP ${res.status}`);
  }

  const raw = await res.json() as Record<string, unknown>;
  const match = raw['match'];

  // Extract box if provided by the API
  const rawBox = raw['box'];
  const box = (rawBox && typeof rawBox === 'object')
    ? (rawBox as VectorAIResult['box'])
    : null;

  // match=false/null/undefined = face not recognized
  if (!match) {
    // If box is present, a face was detected but not in the database
    return box ? { matricula: null, confidence: 0, box } : null;
  }

  const message = String(raw['message'] ?? '');

  const confMatch = message.match(/[Cc]onfiança:\s*([\d.]+)/);
  const confidence = confMatch
    ? parseFloat(confMatch[1])
    : Number(raw['confidence'] ?? raw['score'] ?? 1.0);

  // Prefer a direct 'documento' field (registration number) when the API provides it.
  // Fall back to finding the first long digit sequence in the message, which handles
  // prefixed formats like "DEBUG BIOMETRIA -> 2021102025 (Name) | Tipo: 2 | Confiança: 0.98".
  const rawDoc = raw['documento'] ?? raw['document'] ?? raw['Document'];
  const matricula = rawDoc
    ? String(rawDoc)
    : (message.match(/\b(\d{6,})\b/)?.[1] ?? null);

  if (!matricula) return null;

  return { matricula, confidence, box: box ?? { top: 0, right: 0, bottom: 0, left: 0 } };
}
