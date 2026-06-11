import { FastifyInstance } from 'fastify';
import argon2 from 'argon2';
import { db } from '../db/knex.js';
import { requireAuth } from '../middleware/auth.js';
import { JwtPayload } from '../types/index.js';

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/login', async (req, reply) => {
    const { login, password } = req.body as { login: string; password: string };

    if (!login || !password) {
      return reply.status(400).send({ error: 'MISSING_CREDENTIALS' });
    }

    const user = await db('system_users').where({ login, active: true }).first();
    if (!user) {
      return reply.status(401).send({ error: 'INVALID_CREDENTIALS' });
    }

    const valid = await argon2.verify(user.password_hash, password);
    if (!valid) {
      return reply.status(401).send({ error: 'INVALID_CREDENTIALS' });
    }

    const payload: JwtPayload = { sub: user.id, login: user.login, role: user.role };
    const accessToken = app.jwt.sign(payload, { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m' });
    const refreshToken = app.jwt.sign({ sub: user.id }, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' });

    return { access_token: accessToken, refresh_token: refreshToken, user: { id: user.id, login: user.login, role: user.role } };
  });

  app.post('/auth/refresh', async (req, reply) => {
    const { refresh_token } = req.body as { refresh_token: string };
    if (!refresh_token) return reply.status(400).send({ error: 'MISSING_TOKEN' });

    try {
      const decoded = app.jwt.verify<{ sub: number }>(refresh_token);
      const user = await db('system_users').where({ id: decoded.sub, active: true }).first();
      if (!user) return reply.status(401).send({ error: 'INVALID_TOKEN' });

      const payload: JwtPayload = { sub: user.id, login: user.login, role: user.role };
      const accessToken = app.jwt.sign(payload, { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m' });
      return { access_token: accessToken };
    } catch {
      return reply.status(401).send({ error: 'INVALID_TOKEN' });
    }
  });

  app.get('/auth/me', { preHandler: requireAuth() }, async (req) => {
    const payload = req.user as JwtPayload;
    const user = await db('system_users').where('id', payload.sub).first();
    return { id: user.id, login: user.login, role: user.role };
  });

  app.post('/auth/change-password', { preHandler: requireAuth() }, async (req, reply) => {
    const payload = req.user as JwtPayload;
    const { current_password, new_password } = req.body as { current_password: string; new_password: string };

    const user = await db('system_users').where('id', payload.sub).first();
    const valid = await argon2.verify(user.password_hash, current_password);
    if (!valid) {
      return reply.status(401).send({ error: 'WRONG_PASSWORD' });
    }

    if (!new_password || new_password.length < 8) {
      return reply.status(400).send({ error: 'PASSWORD_TOO_SHORT' });
    }

    const newHash = await argon2.hash(new_password);
    await db('system_users').where('id', payload.sub).update({ password_hash: newHash });
    return { success: true };
  });

  app.get('/auth/preferences', { preHandler: requireAuth() }, async (req) => {
    const payload = req.user as JwtPayload;
    const user = await db('system_users').where('id', payload.sub).first();
    return user?.preferences ?? {};
  });

  app.put('/auth/preferences', { preHandler: requireAuth() }, async (req) => {
    const payload = req.user as JwtPayload;
    const body = req.body as Record<string, unknown>;
    await db('system_users').where('id', payload.sub).update({
      preferences: db.raw('preferences || ?', [JSON.stringify(body)]),
    });
    return { success: true };
  });
}
