import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined;
}

const connectionString =
  process.env.TREASURIES_DATABASE_URL ??
  "postgresql://olusegunaborode@localhost:5432/tokenized_treasuries";

export const pool =
  global._pgPool ??
  new Pool({
    connectionString,
    max: 5,
    // Neon requires TLS; local homebrew postgres has none. Explicit ssl
    // config wins over PG* env vars leaking in from the shell.
    ssl: connectionString.includes("sslmode=require")
      ? { rejectUnauthorized: false }
      : false,
  });

if (process.env.NODE_ENV !== "production") global._pgPool = pool;
