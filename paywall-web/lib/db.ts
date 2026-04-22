import { Pool, type PoolClient, type PoolConfig } from "pg";

declare global {
  var __l402PaywallDb: Pool | undefined;
}

function shouldUseSSL(connectionString: string) {
  return !(
    connectionString.includes("localhost") ||
    connectionString.includes("127.0.0.1") ||
    connectionString.includes("sslmode=disable")
  );
}

function createPool(connectionString: string) {
  const config: PoolConfig = {
    connectionString,
    max: 4,
  };

  if (shouldUseSSL(connectionString)) {
    config.ssl = { rejectUnauthorized: false };
  }

  return new Pool(config);
}

export function getOptionalDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return null;
  }

  if (!globalThis.__l402PaywallDb) {
    globalThis.__l402PaywallDb = createPool(connectionString);
  }

  return globalThis.__l402PaywallDb;
}

export function getRequiredDb() {
  const db = getOptionalDb();
  if (!db) {
    throw new Error("DATABASE_URL is required");
  }

  return db;
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
) {
  const client = await getRequiredDb().connect();

  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
