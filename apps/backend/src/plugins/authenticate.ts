import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /**
     * Attaches the viewer when a valid token is present, but never rejects.
     * For routes that are readable signed-out yet behave differently for a
     * signed-in viewer — the community feed, which must hide people the
     * viewer has blocked.
     */
    optionalAuthenticate: (req: FastifyRequest) => Promise<void>;
  }
  interface FastifyRequest {
    userId: string;
    userRole: "USER" | "MODERATOR" | "ADMIN";
    /** Set only by optionalAuthenticate; undefined for anonymous callers. */
    viewerId?: string;
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

  app.decorate("optionalAuthenticate", async (req: FastifyRequest) => {
    try {
      const payload = await req.jwtVerify<{ sub: string; role: "USER" | "MODERATOR" | "ADMIN" }>();
      req.viewerId = payload.sub;
      req.userId = payload.sub;
      req.userRole = payload.role;
    } catch {
      // Anonymous, or an expired token on a public route. Either is fine —
      // the caller simply gets the unpersonalised view.
      req.viewerId = undefined;
    }
  });
});
