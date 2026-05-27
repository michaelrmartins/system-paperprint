import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { logger } from './lib/logger.js';
import { runMigrations } from './db/migrate.js';
import { startSyncWorker } from './services/syncWorker.js';
import { authRoutes } from './routes/auth.js';
import { studentRoutes } from './routes/students.js';
import { employeeRoutes } from './routes/employees.js';
import { printRoutes } from './routes/print.js';
import { settingsRoutes } from './routes/settings.js';
import { reportRoutes } from './routes/reports.js';
import { systemUserRoutes } from './routes/systemUsers.js';
import { zabbixRoutes } from './routes/zabbix.js';
import { wasteRoutes } from './routes/waste.js';
import * as lyceumClient from './clients/lyceumClient.js';
import * as situatorClient from './clients/situatorClient.js';
import * as nasajonClient from './clients/nasajonClient.js';
import { requireAuth } from './middleware/auth.js';
import { addClient, removeClient } from './lib/sseEmitter.js';

const app = Fastify({ logger: logger as never });

await app.register(cors, {
  origin: process.env.FRONTEND_URL || true,
  credentials: true,
});

await app.register(jwt, {
  secret: process.env.JWT_ACCESS_SECRET || 'dev-secret-change-me',
});

await app.register(authRoutes);
await app.register(studentRoutes);
await app.register(employeeRoutes);
await app.register(printRoutes);
await app.register(settingsRoutes);
await app.register(reportRoutes);
await app.register(systemUserRoutes);
await app.register(zabbixRoutes);
await app.register(wasteRoutes);

// SSE stream — clients subscribe here for real-time push events
app.get('/events/stream', async (req, reply) => {
  const { token } = req.query as { token?: string };
  if (!token) {
    return reply.status(401).send({ error: 'MISSING_TOKEN' });
  }
  try {
    app.jwt.verify(token);
  } catch {
    return reply.status(401).send({ error: 'INVALID_TOKEN' });
  }

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
  });
  reply.raw.write(':\n\n'); // initial comment to open the stream

  addClient(reply);

  const keepAlive = setInterval(() => {
    try {
      reply.raw.write(':ping\n\n');
    } catch {
      clearInterval(keepAlive);
    }
  }, 25_000);

  req.raw.on('close', () => {
    clearInterval(keepAlive);
    removeClient(reply);
  });

  // never resolve — keep the connection open
  await new Promise<void>((resolve) => req.raw.on('close', resolve));
});

app.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }));

app.get('/health/lyceum', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async () => {
  const available = await lyceumClient.isAvailable();
  return { available };
});

app.get('/health/situator', async () => {
  return situatorClient.testConnection();
});

app.get('/health/nasajon', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async () => {
  return nasajonClient.getHealth();
});

try {
  await runMigrations();
  startSyncWorker();

  const port = parseInt(process.env.BACKEND_PORT || '3001');
  await app.listen({ port, host: '0.0.0.0' });
  logger.info({ port }, 'Server started');
} catch (err) {
  logger.error(err, 'Fatal error during startup');
  process.exit(1);
}
