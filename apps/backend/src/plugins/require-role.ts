import type { FastifyReply, FastifyRequest } from "fastify";

export function requireRole(...roles: Array<"MODERATOR" | "ADMIN">) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!roles.includes(req.userRole as "MODERATOR" | "ADMIN")) {
      reply.code(403).send({ error: "Insufficient permissions." });
    }
  };
}
