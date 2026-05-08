import { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/knex.js';
import { JwtPayload } from '../types/index.js';

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/settings', { preHandler: requireAuth(['admin']) }, async () => {
    return db('settings').whereNot('key', 'like', 'zabbix_%').orderBy('key');
  });

  app.put('/settings/:key', { preHandler: requireAuth(['admin']) }, async (req, reply) => {
    const operator = req.user as JwtPayload;
    const { key } = req.params as { key: string };
    const { value } = req.body as { value: string };

    if (value === undefined || value === null) {
      return reply.status(400).send({ error: 'MISSING_VALUE' });
    }

    const existing = await db('settings').where('key', key).first();
    if (!existing) return reply.status(404).send({ error: 'SETTING_NOT_FOUND' });

    await db('settings').where('key', key).update({
      value: String(value),
      updated_at: db.fn.now(),
      updated_by: operator.sub,
    });

    return { ok: true };
  });
}
