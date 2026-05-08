import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { logger } from './lib/logger.js';
import { runMigrations } from './db/migrate.js';
import { startSyncWorker } from './services/syncWorker.js';
import { authRoutes } from './routes/auth.js';
import { studentRoutes } from './routes/students.js';
import { printRoutes } from './routes/print.js';
import { settingsRoutes } from './routes/settings.js';
import { reportRoutes } from './routes/reports.js';
import { systemUserRoutes } from './routes/systemUsers.js';
import { zabbixRoutes } from './routes/zabbix.js';

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
await app.register(printRoutes);
await app.register(settingsRoutes);
await app.register(reportRoutes);
await app.register(systemUserRoutes);
await app.register(zabbixRoutes);

app.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }));

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
