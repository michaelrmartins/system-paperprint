interface ZabbixHost {
  hostid: string;
  name: string;
  available: string;
  snmp_available: string;
  ipmi_available: string;
  jmx_available: string;
}

export interface ZabbixGroup {
  groupid: string;
  name: string;
}

export interface ZabbixHostInfo {
  hostid: string;
  name: string;
  online: boolean;
}

export interface ZabbixItem {
  itemid: string;
  name: string;
  key_: string;
  lastvalue: string;
  units: string;
  value_type: string;
}

export interface PrinterData {
  hostname: string;
  online: boolean;
  model: string | null;
  pages: string | null;
  toner: number | null;
}

const TOKEN_TTL_MS = 45 * 60 * 1000;

interface TokenEntry {
  token: string;
  url: string;
  user: string;
  expiresAt: number;
}

let tokenEntry: TokenEntry | null = null;

async function rpc(url: string, method: string, params: unknown, token?: string): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`ZABBIX_HTTP:${res.status}`);

  const json = await res.json() as {
    result?: unknown;
    error?: { data?: string; message?: string };
  };

  if (json.error) {
    throw new Error(`ZABBIX_API:${json.error.data || json.error.message}`);
  }
  return json.result;
}

export async function authenticate(url: string, user: string, password: string): Promise<string> {
  if (
    tokenEntry &&
    tokenEntry.url === url &&
    tokenEntry.user === user &&
    Date.now() < tokenEntry.expiresAt
  ) {
    return tokenEntry.token;
  }

  const token = await rpc(url, 'user.login', { username: user, password }) as string;
  tokenEntry = { token, url, user, expiresAt: Date.now() + TOKEN_TTL_MS };
  return token;
}

export function invalidateToken() {
  tokenEntry = null;
}

export async function getGroups(url: string, token: string): Promise<ZabbixGroup[]> {
  return rpc(url, 'hostgroup.get', {
    output: ['groupid', 'name'],
    real_hosts: true,
    sortfield: 'name',
  }, token) as Promise<ZabbixGroup[]>;
}

export async function getHosts(url: string, token: string, groupId?: string): Promise<ZabbixHostInfo[]> {
  const params: Record<string, unknown> = {
    output: ['hostid', 'name', 'available', 'snmp_available', 'ipmi_available', 'jmx_available'],
    monitored_hosts: true,
    sortfield: 'name',
  };
  if (groupId) params.groupids = [groupId];

  const hosts = await rpc(url, 'host.get', params, token) as ZabbixHost[];
  return hosts.map((h) => ({
    hostid: h.hostid,
    name: h.name,
    online: [h.available, h.snmp_available, h.ipmi_available, h.jmx_available].includes('1'),
  }));
}

export async function getItems(url: string, token: string, hostId: string): Promise<ZabbixItem[]> {
  return rpc(url, 'item.get', {
    hostids: [hostId],
    output: ['itemid', 'name', 'key_', 'lastvalue', 'units', 'value_type'],
    monitored: true,
    sortfield: 'name',
  }, token) as Promise<ZabbixItem[]>;
}

export async function getPrinterData(
  url: string,
  token: string,
  hostId: string,
  hostName: string,
  itemModel: string,
  itemPages: string,
  itemToner: string,
  itemStatus: string,
): Promise<PrinterData> {
  const itemIds = [itemModel, itemPages, itemToner, itemStatus].filter(Boolean);

  const [hosts, items] = await Promise.all([
    rpc(url, 'host.get', {
      hostids: [hostId],
      output: ['hostid', 'available', 'snmp_available', 'ipmi_available', 'jmx_available'],
    }, token) as Promise<ZabbixHost[]>,
    itemIds.length > 0
      ? rpc(url, 'item.get', {
          itemids: itemIds,
          output: ['itemid', 'lastvalue'],
        }, token) as Promise<{ itemid: string; lastvalue: string }[]>
      : Promise.resolve([]),
  ]);

  const host = hosts[0];
  const valueMap = new Map(items.map((i) => [i.itemid, i.lastvalue]));

  // If a status item is mapped, use its value (1 = online, 0 = offline).
  // Otherwise fall back to Zabbix host availability fields.
  const online = itemStatus
    ? parseInt(valueMap.get(itemStatus) ?? '0', 10) === 1
    : host
      ? [host.available, host.snmp_available, host.ipmi_available, host.jmx_available].includes('1')
      : false;

  const tonerRaw = itemToner ? parseFloat(valueMap.get(itemToner) ?? '') : NaN;

  return {
    hostname: hostName,
    online,
    model: itemModel ? (valueMap.get(itemModel) ?? null) : null,
    pages: itemPages ? (valueMap.get(itemPages) ?? null) : null,
    toner: Number.isFinite(tonerRaw) ? tonerRaw : null,
  };
}
