import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    userId: string;
    userRole: "USER" | "MODERATOR" | "ADMIN";
  }
}

/**
 * Verifies the access-token JWT and attaches `req.userId`/`req.userRole`.
 * Registered as a preHandler on any route that requires a signed-in user.
 */
export default fp(async (app) => {
  app.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = await req.jwtVerify<{ sub: string; role: "USER" | "MODERATOR" | "ADMIN" }>();
      req.userId = payload.sub;
      req.userRole = payload.role;
    } catch {
      reply.code(401).send({ error: "Missing or invalid access token." });
    }
  });
});
