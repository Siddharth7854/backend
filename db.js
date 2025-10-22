import sql from 'mssql';

// Read DB configuration from environment variables with sane defaults
const config = {
  user: process.env.DB_USER || 'surveyapp_new',
  password: process.env.DB_PASSWORD || 'Sid@91221',
  server: process.env.DB_SERVER || 'A2NWPLSK14SQL-v04.shr.prod.iad2.secureserver.net',
  database: process.env.DB_NAME || 'surveyapp_new',
  options: {
    encrypt: true,
    trustServerCertificate: true,
  },
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 1433,
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let pool = null;
export async function connectDb() {
  try {
    if (!pool) {
      pool = await sql.connect(config);
    }
    return pool;
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    console.error('DB connection error:', message);
    throw err;
  }
}
