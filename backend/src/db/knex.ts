import Knex from 'knex';

export const db = Knex({
  client: 'pg',
  connection: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT) || 5432,
    database: process.env.POSTGRES_DB || 'paperprint',
    user: process.env.POSTGRES_USER || 'paperprint',
    password: process.env.POSTGRES_PASSWORD || '',
  },
  pool: { min: 2, max: 10 },
});
