import { FastifyReply } from 'fastify';

type SSEClient = FastifyReply;

const clients = new Set<SSEClient>();

export function addClient(reply: SSEClient): void {
  clients.add(reply);
}

export function removeClient(reply: SSEClient): void {
  clients.delete(reply);
}

export function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.raw.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

export function clientCount(): number {
  return clients.size;
}
