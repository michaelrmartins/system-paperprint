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

  // print_waste table — error prints and blank pages
  await createTableIfMissing('print_waste', (t) => {
    t.increments('id').primary();
    t.enu('type', ['error', 'blank']).notNullable();
    t.integer('sheets').notNullable();
    t.integer('operator_id').notNullable().references('id').inTable('system_users');
    t.string('user_type', 20).nullable();
    t.integer('user_id').nullable();
    t.integer('print_operation_id').nullable().references('id').inTable('print_operations');
    t.timestamp('created_at', { useTz: true }).defaultTo(db.fn.now());
  });

  // employees table
  await createTableIfMissing('employees', (t) => {
    t.increments('id').primary();
    t.string('employee_code', 50).notNullable().unique();
    t.string('name', 255).notNullable();
    t.string('department', 255).notNullable().defaultTo('');
    t.string('email', 255).nullable();
    t.enu('sync_status', ['synced', 'pending', 'attention']).notNullable().defaultTo('synced');
    t.timestamp('created_at', { useTz: true }).defaultTo(db.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(db.fn.now());
  });

  // add user_type + user_id to print_operations
  const hasPrintUserType = await db.schema.hasColumn('print_operations', 'user_type');
  if (!hasPrintUserType) {
    await db.schema.table('print_operations', (t) => {
      t.string('user_type', 20).nullable();
      t.integer('user_id').nullable();
    });
    await db.raw(`UPDATE print_operations SET user_type = 'student', user_id = student_id`);
    await db.schema.table('print_operations', (t) => {
      t.string('user_type', 20).notNullable().defaultTo('student').alter();
      t.integer('user_id').notNullable().alter();
    });
  }
  // student_id must be nullable now that employees don't have one (idempotent in PG)
  await db.raw('ALTER TABLE print_operations ALTER COLUMN student_id DROP NOT NULL');

  // add user_type + user_id to entries
  const hasEntryUserType = await db.schema.hasColumn('entries', 'user_type');
  if (!hasEntryUserType) {
    await db.schema.table('entries', (t) => {
      t.string('user_type', 20).nullable();
      t.integer('user_id').nullable();
    });
    await db.raw(`UPDATE entries SET user_type = 'student', user_id = student_id`);
    await db.schema.table('entries', (t) => {
      t.string('user_type', 20).notNullable().defaultTo('student').alter();
      t.integer('user_id').notNullable().alter();
    });
  }
  // student_id must be nullable now that employees don't have one (idempotent in PG)
  await db.raw('ALTER TABLE entries ALTER COLUMN student_id DROP NOT NULL');

  // add primary_user_type + primary_user_id to invalid_document_attempts
  const hasInvalidDocUserType = await db.schema.hasColumn('invalid_document_attempts', 'primary_user_type');
  if (!hasInvalidDocUserType) {
    await db.schema.table('invalid_document_attempts', (t) => {
      t.string('primary_user_type', 20).nullable();
      t.integer('primary_user_id').nullable();
    });
    await db.raw(`
      UPDATE invalid_document_attempts
      SET primary_user_type = 'student', primary_user_id = primary_student_id
      WHERE primary_student_id IS NOT NULL
    `);
  }

  // Add operation_type to print_operations to distinguish blank waste ops from regular prints
  const hasPrintOperationType = await db.schema.hasColumn('print_operations', 'operation_type');
  if (!hasPrintOperationType) {
    await db.schema.table('print_operations', (t) => {
      t.string('operation_type', 20).notNullable().defaultTo('print');
    });
  }

  // Add user traceability + operation link to print_waste for blank pages
  const hasWasteUserId = await db.schema.hasColumn('print_waste', 'user_id');
  if (!hasWasteUserId) {
    await db.schema.table('print_waste', (t) => {
      t.string('user_type', 20).nullable();
      t.integer('user_id').nullable();
      t.integer('print_operation_id').nullable().references('id').inTable('print_operations');
    });
  }

  // Allow audit_log to record waste adjustments: make entry_id nullable, add waste_id
  const hasAuditWasteId = await db.schema.hasColumn('audit_log', 'waste_id');
  if (!hasAuditWasteId) {
    await db.raw('ALTER TABLE audit_log ALTER COLUMN entry_id DROP NOT NULL');
    await db.schema.table('audit_log', (t) => {
      t.integer('waste_id').nullable().references('id').inTable('print_waste');
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

  // Employee and stacking settings
  const employeeSettings = [
    { key: 'employee_daily_quota', value: '10', description: 'Cota diária de folhas por funcionário' },
    { key: 'allow_cross_type_stacking', value: 'false', description: 'Permite empilhamento entre alunos e funcionários' },
    { key: 'allow_employee_employee_stacking', value: 'false', description: 'Permite funcionário emprestar cota de outro funcionário' },
  ];
  for (const entry of employeeSettings) {
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
