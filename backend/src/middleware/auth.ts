import { FastifyRequest, FastifyReply } from 'fastify';
import { UserRole } from '../types/index.js';

export function requireAuth(roles?: UserRole[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.status(401).send({ error: 'UNAUTHORIZED' });
    }

    if (roles && roles.length > 0) {
      const user = req.user as { role: UserRole };
      if (!roles.includes(user.role)) {
        return reply.status(403).send({ error: 'FORBIDDEN' });
      }
    }
  };
}
