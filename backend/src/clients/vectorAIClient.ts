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

  // match=false/null/undefined/empty = not recognized
  if (!match) return null;

  // The registration number and confidence are embedded in the message field.
  // Expected format: "2024102020 (Name) | Tipo: 2 | Confiança: 0.9579"
  const message = String(raw['message'] ?? '');

  // Extract the first numeric sequence as the registration number
  const regMatch = message.match(/^(\d+)/);
  const matricula = regMatch ? regMatch[1] : null;

  if (!matricula) return null;

  // Extract confidence from message, fallback to raw field, fallback to 1.0
  const confMatch = message.match(/[Cc]onfiança:\s*([\d.]+)/);
  const confidence = confMatch
    ? parseFloat(confMatch[1])
    : Number(raw['confidence'] ?? raw['score'] ?? 1.0);

  const box = (raw['box'] ?? { top: 0, right: 0, bottom: 0, left: 0 }) as VectorAIResult['box'];
  return { matricula, confidence, box };
}
