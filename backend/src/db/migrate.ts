import { db } from './knex.js';
import { logger } from '../lib/logger.js';

async function createTableIfMissing(
  tableName: string,
  builder: (t: Parameters<Parameters<typeof db.schema.createTable>[1]>[0]) => void
) {
  const exists = await db.schema.hasTable(tableName);
  if (!exists) {
    await db.schema.createTable(tableName, builder);
  }
}

async function migrate() {
  await createTableIfMissing('system_users', (t) => {
    t.increments('id').primary();
    t.string('login', 100).notNullable().unique();
    t.text('password_hash').notNullable();
    t.enu('role', ['operator', 'auditor', 'admin']).notNullable();
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).defaultTo(db.fn.now());
  });

  await createTableIfMissing('students', (t) => {
    t.increments('id').primary();
    t.string('registration_number', 50).notNullable().unique();
    t.string('name', 255).notNullable();
    t.string('course', 255).notNullable().defaultTo('');
    t.string('period', 100).notNullable().defaultTo('');
    t.string('person_code', 100).nullable();
    t.enu('sync_status', ['synced', 'pending', 'attention']).notNullable().defaultTo('synced');
    t.timestamp('created_at', { useTz: true }).defaultTo(db.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(db.fn.now());
  });

  await createTableIfMissing('print_operations', (t) => {
    t.increments('id').primary();
    t.integer('operator_id').notNullable().references('id').inTable('system_users');
    t.integer('student_id').notNullable().references('id').inTable('students');
    t.integer('total_sheets').notNullable();
    t.enu('status', ['completed', 'contingency', 'attention']).notNullable().defaultTo('completed');
    t.timestamp('created_at', { useTz: true }).defaultTo(db.fn.now());
  });

  await createTableIfMissing('entries', (t) => {
    t.increments('id').primary();
    t.integer('print_operation_id').notNullable().references('id').inTable('print_operations');
    t.integer('student_id').notNullable().references('id').inTable('students');
    t.integer('sheets').notNullable();
    t.enu('type', ['own', 'borrowed']).notNullable();
    t.timestamp('created_at', { useTz: true }).defaultTo(db.fn.now());
  });

  await createTableIfMissing('settings', (t) => {
    t.string('key', 100).primary();
    t.text('value').notNullable();
    t.text('description').notNullable().defaultTo('');
    t.timestamp('updated_at', { useTz: true }).defaultTo(db.fn.now());
    t.integer('updated_by').nullable().references('id').inTable('system_users');
  });

  await createTableIfMissing('audit_log', (t) => {
    t.increments('id').primary();
    t.integer('entry_id').notNullable().references('id').inTable('entries');
    t.integer('operator_id').notNullable().references('id').inTable('system_users');
    t.integer('previous_value').notNullable();
    t.integer('new_value').notNullable();
    t.text('reason').notNullable();
    t.timestamp('created_at', { useTz: true }).defaultTo(db.fn.now());
  });

  await createTableIfMissing('invalid_document_attempts', (t) => {
    t.increments('id').primary();
    t.string('document', 50).notNullable();
    t.string('situation_detail', 100).notNullable();
    t.enu('context', ['primary', 'loan']).notNullable().defaultTo('primary');
    t.enu('identify_method', ['manual', 'rfid', 'facial']).notNullable().defaultTo('manual');
    t.integer('operator_id').notNullable().references('id').inTable('system_users');
    t.integer('primary_student_id').nullable().references('id').inTable('students');
    t.timestamp('created_at', { useTz: true }).defaultTo(db.fn.now());
  });

  // Add primary_student_id to invalid_document_attempts if missing (for loan context traceability)
  const hasInvalidDocPrimaryStudentId = await db.schema.hasColumn('invalid_document_attempts', 'primary_student_id');
  if (!hasInvalidDocPrimaryStudentId) {
    await db.schema.table('invalid_document_attempts', (t) => {
      t.integer('primary_student_id').nullable().references('id').inTable('students');
    });
  }

  // Add identify_method column to print_operations if missing
  const hasIdentifyMethod = await db.schema.hasColumn('print_operations', 'identify_method');
  if (!hasIdentifyMethod) {
    await db.schema.table('print_operations', (t) => {
      t.enu('identify_method', ['manual', 'rfid', 'facial']).notNullable().defaultTo('manual');
    });
  }

  // Add identify_method column to entries if missing (tracks per-student method including lenders)
  const hasIdentifyMethodEntries = await db.schema.hasColumn('entries', 'identify_method');
  if (!hasIdentifyMethodEntries) {
    await db.schema.table('entries', (t) => {
      t.enu('identify_method', ['manual', 'rfid', 'facial']).nullable();
    });
  }

  logger.info('Migrations completed');
}

async function seed() {
  const existing = await db('settings').where('key', 'daily_quota').first();
  if (!existing) {
    await db('settings').insert([
      { key: 'daily_quota', value: '10', description: 'Cota diária de folhas por aluno' },
      { key: 'max_stacked_registrations', value: '3', description: 'Máximo de matrículas empilhadas por operação' },
      { key: 'duplex_counts_double', value: 'false', description: 'Impressão duplex conta como 2 folhas' },
      { key: 'quota_reset_time', value: '00:00', description: 'Horário de reset da cota (HH:MM, fuso America/Sao_Paulo)' },
    ]);
  }

  // Zabbix integration settings — idempotent, safe to run on existing installs
  const zabbixDefaults = [
    { key: 'zabbix_url', value: '', description: 'URL da API do Zabbix (JSON-RPC)' },
    { key: 'zabbix_user', value: '', description: 'Usuário Zabbix' },
    { key: 'zabbix_password', value: '', description: 'Senha Zabbix' },
    { key: 'zabbix_host_id', value: '', description: 'ID do host monitorado (impressora)' },
    { key: 'zabbix_host_name', value: '', description: 'Nome do host Zabbix' },
    { key: 'zabbix_item_model', value: '', description: 'Item ID: modelo da impressora' },
    { key: 'zabbix_item_pages', value: '', description: 'Item ID: páginas impressas' },
    { key: 'zabbix_item_toner', value: '', description: 'Item ID: nível de toner (%)' },
    { key: 'zabbix_item_status', value: '', description: 'Item ID: status da impressora (1=online, 0=offline)' },
  ];
  for (const entry of zabbixDefaults) {
    const has = await db('settings').where('key', entry.key).first();
    if (!has) await db('settings').insert(entry);
  }

  const adminLogin = process.env.SEED_ADMIN_LOGIN || 'admin';
  const existingAdmin = await db('system_users').where('login', adminLogin).first();
  if (!existingAdmin) {
    const argon2 = await import('argon2');
    const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'Admin@1234';
    const hash = await argon2.hash(adminPassword);
    await db('system_users').insert({
      login: adminLogin,
      password_hash: hash,
      role: 'admin',
      active: true,
    });
    logger.info({ login: adminLogin }, 'Default admin user created');
  }

  logger.info('Seeds completed');
}

export async function runMigrations() {
  await migrate();
  await seed();
}
