import "dotenv/config";
import { buildApp } from "./app";
import { getEnv } from "./env";
import { prisma } from "./prisma";

/** How long to let in-flight requests finish before forcing exit. */
const SHUTDOWN_GRACE_MS = 15_000;

async function main() {
  const env = getEnv();
  const app = buildApp();

  /**
   * Graceful shutdown. A container orchestrator sends SIGTERM and then kills
   * the process a short time later. Without this, every rolling deploy drops
   * whatever requests were in flight — including a half-applied account
   * deletion or a purchase verification — and leaves database connections for
   * Postgres to reap on its own.
   *
   * Fastify stops accepting connections and drains existing ones; Prisma's
   * pool is closed afterwards so draining requests can still use it.
   */
  let shuttingDown = false;
  async function shutdown(signal: NodeJS.Signals) {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "Shutting down");

    // Backstop: if draining hangs, exit anyway rather than being SIGKILLed
    // mid-write with no log line explaining why.
    const forceExit = setTimeout(() => {
      app.log.error("Graceful shutdown timed out; exiting");
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    forceExit.unref();

    try {
      await app.close();
      await prisma.$disconnect();
      app.log.info("Shutdown complete");
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "Error during shutdown");
      process.exit(1);
    }
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal startup error:", err);
  process.exit(1);
});
