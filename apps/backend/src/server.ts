import "dotenv/config";
import { buildApp } from "./app";
import { getEnv } from "./env";

async function main() {
  const env = getEnv();
  const app = buildApp();
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal startup error:", err);
  process.exit(1);
});
