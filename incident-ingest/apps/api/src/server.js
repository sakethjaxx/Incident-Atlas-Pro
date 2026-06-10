import { buildApp } from "./app.js";
import { prisma } from "./lib/prisma.js";

if (process.env.NODE_ENV === "production" && !process.env.ADMIN_TOKEN) {
  console.error("FATAL: ADMIN_TOKEN must be set in production. Refusing to start.");
  process.exit(1);
}

const app = buildApp();
const port = Number(process.env.PORT) || 3001;

app.listen(port, () => {
  console.log(`[api] Listening on http://localhost:${port}`);
});

process.on("SIGINT", async () => {
  console.log("[api] Shutting down...");
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
