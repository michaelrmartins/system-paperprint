import { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/knex.js';
import {
  authenticate,
  invalidateToken,
  getGroups,
  getHosts,
  getItems,
  getPrinterData,
  ZabbixGroup,
  ZabbixHostInfo,
  ZabbixItem,
  PrinterData,
} from '../clients/zabbixClient.js';

async function getZabbixSettings() {
  const rows = await db('settings')
    .whereIn('key', [
      'zabbix_url', 'zabbix_user', 'zabbix_password',
      'zabbix_host_id', 'zabbix_host_name',
      'zabbix_item_model', 'zabbix_item_pages', 'zabbix_item_toner', 'zabbix_item_status',
    ]);
  return Object.fromEntries(rows.map((r: { key: string; value: string }) => [r.key, r.value]));
}

async function saveSetting(key: string, value: string) {
  await db('settings').where('key', key).update({ value, updated_at: db.fn.now() });
}

export async function zabbixRoutes(app: FastifyInstance) {
  // Test connection + save credentials + return groups
  app.post('/zabbix/connect', { preHandler: requireAuth(['admin']) }, async (req, reply) => {
    const { url, user, password } = req.body as { url: string; user: string; password: string };

    if (!url?.trim() || !user?.trim() || !password?.trim()) {
      return reply.status(400).send({ error: 'MISSING_FIELDS' });
    }

    try {
      invalidateToken();
      const token = await authenticate(url.trim(), user.trim(), password.trim());
      const groups = await getGroups(url.trim(), token) as ZabbixGroup[];

      await saveSetting('zabbix_url', url.trim());
      await saveSetting('zabbix_user', user.trim());
      await saveSetting('zabbix_password', password.trim());

      return { groups };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'UNKNOWN';
      return reply.status(422).send({ error: msg });
    }
  });

  // List hosts, optionally filtered by group
  app.get('/zabbix/hosts', { preHandler: requireAuth(['admin']) }, async (req, reply) => {
    const { groupId } = req.query as { groupId?: string };
    const cfg = await getZabbixSettings();

    if (!cfg.zabbix_url || !cfg.zabbix_user || !cfg.zabbix_password) {
      return reply.status(400).send({ error: 'ZABBIX_NOT_CONFIGURED' });
    }

    try {
      const token = await authenticate(cfg.zabbix_url, cfg.zabbix_user, cfg.zabbix_password);
      const hosts = await getHosts(cfg.zabbix_url, token, groupId) as ZabbixHostInfo[];
      return { hosts };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'UNKNOWN';
      return reply.status(422).send({ error: msg });
    }
  });

  // List items for a host
  app.get('/zabbix/items', { preHandler: requireAuth(['admin']) }, async (req, reply) => {
    const { hostId } = req.query as { hostId: string };

    if (!hostId) return reply.status(400).send({ error: 'MISSING_HOST_ID' });

    const cfg = await getZabbixSettings();

    if (!cfg.zabbix_url || !cfg.zabbix_user || !cfg.zabbix_password) {
      return reply.status(400).send({ error: 'ZABBIX_NOT_CONFIGURED' });
    }

    try {
      const token = await authenticate(cfg.zabbix_url, cfg.zabbix_user, cfg.zabbix_password);
      const items = await getItems(cfg.zabbix_url, token, hostId) as ZabbixItem[];
      return { items };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'UNKNOWN';
      return reply.status(422).send({ error: msg });
    }
  });

  // Save host + item mapping
  app.put('/zabbix/config', { preHandler: requireAuth(['admin']) }, async (req, reply) => {
    const { host_id, host_name, item_model, item_pages, item_toner, item_status } = req.body as {
      host_id: string; host_name: string;
      item_model: string; item_pages: string; item_toner: string; item_status: string;
    };

    await saveSetting('zabbix_host_id', host_id ?? '');
    await saveSetting('zabbix_host_name', host_name ?? '');
    await saveSetting('zabbix_item_model', item_model ?? '');
    await saveSetting('zabbix_item_pages', item_pages ?? '');
    await saveSetting('zabbix_item_toner', item_toner ?? '');
    await saveSetting('zabbix_item_status', item_status ?? '');

    return { ok: true };
  });

  // Get current Zabbix config (without password)
  app.get('/zabbix/config', { preHandler: requireAuth(['admin']) }, async () => {
    const cfg = await getZabbixSettings();
    return {
      url: cfg.zabbix_url || '',
      user: cfg.zabbix_user || '',
      host_id: cfg.zabbix_host_id || '',
      host_name: cfg.zabbix_host_name || '',
      item_model: cfg.zabbix_item_model || '',
      item_pages: cfg.zabbix_item_pages || '',
      item_toner: cfg.zabbix_item_toner || '',
      item_status: cfg.zabbix_item_status || '',
      configured: !!(cfg.zabbix_url && cfg.zabbix_host_id),
    };
  });

  // Get printer widget data — used by all authenticated roles
  app.get('/zabbix/printer-data', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req, reply) => {
    const cfg = await getZabbixSettings();

    if (!cfg.zabbix_url || !cfg.zabbix_user || !cfg.zabbix_password || !cfg.zabbix_host_id) {
      return { configured: false };
    }

    try {
      const token = await authenticate(cfg.zabbix_url, cfg.zabbix_user, cfg.zabbix_password);
      const data = await getPrinterData(
        cfg.zabbix_url, token,
        cfg.zabbix_host_id,
        cfg.zabbix_host_name,
        cfg.zabbix_item_model || '',
        cfg.zabbix_item_pages || '',
        cfg.zabbix_item_toner || '',
        cfg.zabbix_item_status || '',
      ) as PrinterData;
      return { configured: true, ...data };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'UNKNOWN';
      return reply.status(503).send({ error: msg });
    }
  });
}
