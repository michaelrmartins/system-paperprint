import { FastifyInstance } from 'fastify';
import argon2 from 'argon2';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/knex.js';

export async function systemUserRoutes(app: FastifyInstance) {
  app.get('/system-users', { preHandler: requireAuth(['admin']) }, async () => {
    return db('system_users').select('id', 'login', 'role', 'active', 'created_at').orderBy('login');
  });

  app.post('/system-users', { preHandler: requireAuth(['admin']) }, async (req, reply) => {
    const { login, password, role } = req.body as { login: string; password: string; role: string };

    if (!login || !password || !['operator', 'auditor', 'admin'].includes(role)) {
      return reply.status(400).send({ error: 'INVALID_INPUT' });
    }

    const existing = await db('system_users').where('login', login).first();
    if (existing) return reply.status(409).send({ error: 'LOGIN_ALREADY_EXISTS' });

    const hash = await argon2.hash(password);
    const [user] = await db('system_users')
      .insert({ login, password_hash: hash, role, active: true })
      .returning(['id', 'login', 'role', 'active', 'created_at']);

    return user;
  });

  app.patch('/system-users/:id', { preHandler: requireAuth(['admin']) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { active?: boolean; role?: string; password?: string };

    const updates: Record<string, unknown> = {};
    if (body.active !== undefined) updates.active = body.active;
    if (body.role && ['operator', 'auditor', 'admin'].includes(body.role)) updates.role = body.role;
    if (body.password) updates.password_hash = await argon2.hash(body.password);

    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({ error: 'NOTHING_TO_UPDATE' });
    }

    const [updated] = await db('system_users')
      .where('id', parseInt(id))
      .update(updates)
      .returning(['id', 'login', 'role', 'active']);

    if (!updated) return reply.status(404).send({ error: 'USER_NOT_FOUND' });
    return updated;
  });
}
