import { useState, useEffect } from 'react';
import api from '../lib/api';
import { Setting, SystemUser } from '../types';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Modal } from '../components/Modal';
import { Spinner } from '../components/Spinner';
import { extractApiError } from '../lib/errors';
import { SETTING_LABELS, ROLE_LABELS, formatDate } from '../lib/format';
import { Plus, Pencil, Wifi, ChevronRight, Check } from 'lucide-react';

interface ZabbixGroup { groupid: string; name: string }
interface ZabbixHost  { hostid: string; name: string; online: boolean }
interface ZabbixItem  { itemid: string; name: string; key_: string; lastvalue: string; units: string }
interface ZabbixConfig {
  url: string; user: string;
  host_id: string; host_name: string;
  item_model: string; item_pages: string; item_toner: string; item_status: string;
  configured: boolean;
}

type SettingInputType = 'number' | 'boolean' | 'time' | 'text';

function getSettingInputType(key: string): SettingInputType {
  if (key === 'duplex_counts_double') return 'boolean';
  if (key === 'daily_quota' || key === 'max_stacked_registrations') return 'number';
  if (key === 'quota_reset_time') return 'time';
  return 'text';
}

function ToggleSwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 ${
        value ? 'bg-gray-900' : 'bg-gray-200'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ease-in-out ${
          value ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

export function SettingsPage() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [loading, setLoading] = useState(true);

  const [editSetting, setEditSetting] = useState<Setting | null>(null);
  const [editValue, setEditValue] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingError, setSettingError] = useState('');

  // Zabbix state
  const [zabbixUrl, setZabbixUrl] = useState('');
  const [zabbixUser, setZabbixUser] = useState('');
  const [zabbixPassword, setZabbixPassword] = useState('');
  const [zabbixConnecting, setZabbixConnecting] = useState(false);
  const [zabbixConnectError, setZabbixConnectError] = useState('');
  const [zabbixGroups, setZabbixGroups] = useState<ZabbixGroup[]>([]);
  const [zabbixGroupId, setZabbixGroupId] = useState('');
  const [zabbixHosts, setZabbixHosts] = useState<ZabbixHost[]>([]);
  const [zabbixHostsLoading, setZabbixHostsLoading] = useState(false);
  const [zabbixHostId, setZabbixHostId] = useState('');
  const [zabbixHostName, setZabbixHostName] = useState('');
  const [zabbixItems, setZabbixItems] = useState<ZabbixItem[]>([]);
  const [zabbixItemsLoading, setZabbixItemsLoading] = useState(false);
  const [zabbixItemModel, setZabbixItemModel] = useState('');
  const [zabbixItemPages, setZabbixItemPages] = useState('');
  const [zabbixItemToner, setZabbixItemToner] = useState('');
  const [zabbixItemStatus, setZabbixItemStatus] = useState('');
  const [zabbixSaving, setZabbixSaving] = useState(false);
  const [zabbixSaved, setZabbixSaved] = useState(false);

  const [createUserModal, setCreateUserModal] = useState(false);
  const [newLogin, setNewLogin] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('operator');
  const [creatingUser, setCreatingUser] = useState(false);
  const [userError, setUserError] = useState('');

  useEffect(() => {
    Promise.all([
      api.get<Setting[]>('/settings'),
      api.get<SystemUser[]>('/system-users'),
      api.get<ZabbixConfig>('/zabbix/config'),
    ]).then(([s, u, z]) => {
      setSettings(s.data);
      setUsers(u.data);
      const cfg = z.data;
      setZabbixUrl(cfg.url);
      setZabbixUser(cfg.user);
      setZabbixHostId(cfg.host_id);
      setZabbixHostName(cfg.host_name);
      setZabbixItemModel(cfg.item_model);
      setZabbixItemPages(cfg.item_pages);
      setZabbixItemToner(cfg.item_toner);
      setZabbixItemStatus(cfg.item_status);
    }).finally(() => setLoading(false));
  }, []);

  const openEdit = (s: Setting) => {
    setEditSetting(s);
    setEditValue(s.value);
    setSettingError('');
  };

  const saveSetting = async () => {
    if (!editSetting) return;
    const type = getSettingInputType(editSetting.key);
    if (type === 'number' && (isNaN(Number(editValue)) || editValue.trim() === '')) {
      setSettingError('Informe um número válido.');
      return;
    }
    setSavingSettings(true);
    setSettingError('');
    try {
      await api.put(`/settings/${editSetting.key}`, { value: editValue });
      setSettings((prev) => prev.map((s) => s.key === editSetting.key ? { ...s, value: editValue } : s));
      setEditSetting(null);
    } catch (err) {
      setSettingError(extractApiError(err));
    } finally {
      setSavingSettings(false);
    }
  };

  const saveBoolean = async (s: Setting, newBool: boolean) => {
    const newVal = String(newBool);
    try {
      await api.put(`/settings/${s.key}`, { value: newVal });
      setSettings((prev) => prev.map((x) => x.key === s.key ? { ...x, value: newVal } : x));
    } catch {
      // silently revert if needed — UI will stay consistent as we don't optimistic-update here
    }
  };

  const createUser = async () => {
    if (!newLogin.trim() || !newPassword.trim()) {
      setUserError('Preencha todos os campos.');
      return;
    }
    setCreatingUser(true);
    setUserError('');
    try {
      const res = await api.post<SystemUser>('/system-users', { login: newLogin, password: newPassword, role: newRole });
      setUsers((prev) => [...prev, res.data]);
      setCreateUserModal(false);
      setNewLogin(''); setNewPassword(''); setNewRole('operator');
    } catch (err) {
      setUserError(extractApiError(err));
    } finally {
      setCreatingUser(false);
    }
  };

  const toggleUser = async (user: SystemUser) => {
    await api.patch(`/system-users/${user.id}`, { active: !user.active });
    setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, active: !u.active } : u));
  };

  const zabbixConnect = async () => {
    setZabbixConnecting(true);
    setZabbixConnectError('');
    setZabbixGroups([]);
    setZabbixHosts([]);
    setZabbixItems([]);
    try {
      const res = await api.post<{ groups: ZabbixGroup[] }>('/zabbix/connect', {
        url: zabbixUrl.trim(),
        user: zabbixUser.trim(),
        password: zabbixPassword.trim(),
      });
      setZabbixGroups(res.data.groups);
      setZabbixGroupId('');
      setZabbixHostId('');
      setZabbixHostName('');
    } catch (err) {
      setZabbixConnectError(extractApiError(err));
    } finally {
      setZabbixConnecting(false);
    }
  };

  const zabbixLoadHosts = async (groupId: string) => {
    setZabbixGroupId(groupId);
    setZabbixHosts([]);
    setZabbixItems([]);
    setZabbixHostId('');
    setZabbixHostName('');
    if (!groupId) return;
    setZabbixHostsLoading(true);
    try {
      const res = await api.get<{ hosts: ZabbixHost[] }>('/zabbix/hosts', { params: { groupId } });
      setZabbixHosts(res.data.hosts);
    } finally {
      setZabbixHostsLoading(false);
    }
  };

  const zabbixLoadItems = async (hostId: string) => {
    const host = zabbixHosts.find((h) => h.hostid === hostId);
    setZabbixHostId(hostId);
    setZabbixHostName(host?.name ?? '');
    setZabbixItems([]);
    setZabbixItemModel('');
    setZabbixItemPages('');
    setZabbixItemToner('');
    setZabbixItemStatus('');
    if (!hostId) return;
    setZabbixItemsLoading(true);
    try {
      const res = await api.get<{ items: ZabbixItem[] }>('/zabbix/items', { params: { hostId } });
      setZabbixItems(res.data.items);
    } finally {
      setZabbixItemsLoading(false);
    }
  };

  const zabbixSaveConfig = async () => {
    setZabbixSaving(true);
    setZabbixSaved(false);
    try {
      await api.put('/zabbix/config', {
        host_id: zabbixHostId,
        host_name: zabbixHostName,
        item_model: zabbixItemModel,
        item_pages: zabbixItemPages,
        item_toner: zabbixItemToner,
        item_status: zabbixItemStatus,
      });
      setZabbixSaved(true);
      setTimeout(() => setZabbixSaved(false), 3000);
    } finally {
      setZabbixSaving(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Spinner /></div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-[18px] font-semibold text-gray-900">Configurações</h1>

      {/* System settings */}
      <section>
        <h2 className="text-[13px] font-medium text-gray-500 uppercase tracking-wide mb-3">Parâmetros do Sistema</h2>
        <div className="bg-white/70 backdrop-blur-xl border border-white/60 rounded-2xl shadow-glass divide-y divide-gray-100/80">
          {settings.map((s) => {
            const type = getSettingInputType(s.key);
            return (
              <div key={s.key} className="flex items-center justify-between px-5 py-4">
                <div>
                  <p className="text-[14px] font-medium text-gray-900">{SETTING_LABELS[s.key] || s.key}</p>
                  <p className="text-[12px] text-gray-400 mt-0.5">{s.description}</p>
                </div>
                <div className="flex items-center gap-3">
                  {type === 'boolean' ? (
                    <ToggleSwitch
                      value={s.value === 'true'}
                      onChange={(v) => saveBoolean(s, v)}
                    />
                  ) : (
                    <>
                      <span className="text-[14px] font-semibold text-gray-700">{s.value}</span>
                      <button
                        onClick={() => openEdit(s)}
                        className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
                      >
                        <Pencil size={14} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* System users */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[13px] font-medium text-gray-500 uppercase tracking-wide">Usuários do Sistema</h2>
          <Button size="sm" variant="secondary" onClick={() => setCreateUserModal(true)}>
            <Plus size={14} /> Novo usuário
          </Button>
        </div>
        <div className="bg-white/70 backdrop-blur-xl border border-white/60 rounded-2xl shadow-glass divide-y divide-gray-100/80">
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between px-5 py-3.5">
              <div>
                <p className="text-[14px] font-medium text-gray-900">{u.login}</p>
                <p className="text-[12px] text-gray-500 mt-0.5">
                  {ROLE_LABELS[u.role]} · criado em {formatDate(u.created_at)}
                </p>
              </div>
              <button
                onClick={() => toggleUser(u)}
                className={`px-3 py-1 rounded-full text-[12px] font-medium transition-colors ${
                  u.active
                    ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {u.active ? 'Ativo' : 'Inativo'}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Zabbix integration */}
      <section>
        <h2 className="text-[13px] font-medium text-gray-500 uppercase tracking-wide mb-3">Integração Zabbix</h2>
        <div className="bg-white/70 backdrop-blur-xl border border-white/60 rounded-2xl shadow-glass p-5 space-y-4">

          {/* Credentials */}
          <div className="grid grid-cols-1 gap-3">
            <Input
              label="URL da API"
              value={zabbixUrl}
              onChange={(e) => setZabbixUrl(e.target.value)}
              placeholder="http://192.168.50.156/zabbix/api_jsonrpc.php"
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Usuário"
                value={zabbixUser}
                onChange={(e) => setZabbixUser(e.target.value)}
                placeholder="Admin"
              />
              <Input
                label="Senha"
                type="password"
                value={zabbixPassword}
                onChange={(e) => setZabbixPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={zabbixConnect}
              loading={zabbixConnecting}
              variant="secondary"
              size="sm"
            >
              <Wifi size={14} />
              Conectar e listar grupos
            </Button>
            {zabbixHostId && !zabbixGroups.length && (
              <span className="text-[12px] text-emerald-600 flex items-center gap-1">
                <Check size={12} /> Configurado: {zabbixHostName}
              </span>
            )}
          </div>

          {zabbixConnectError && (
            <p className="text-[13px] text-red-500">{zabbixConnectError}</p>
          )}

          {/* Group selector */}
          {zabbixGroups.length > 0 && (
            <div className="border-t border-gray-100 pt-4 space-y-3">
              <div>
                <label className="text-[12px] font-medium text-gray-500 uppercase tracking-wide block mb-1.5">Grupo</label>
                <select
                  value={zabbixGroupId}
                  onChange={(e) => zabbixLoadHosts(e.target.value)}
                  className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-xl outline-none focus:border-gray-400 bg-white/70"
                >
                  <option value="">Selecione um grupo</option>
                  {zabbixGroups.map((g) => (
                    <option key={g.groupid} value={g.groupid}>{g.name}</option>
                  ))}
                </select>
              </div>

              {/* Host selector */}
              {(zabbixHostsLoading || zabbixHosts.length > 0) && (
                <div>
                  <label className="text-[12px] font-medium text-gray-500 uppercase tracking-wide block mb-1.5">Host</label>
                  {zabbixHostsLoading ? (
                    <div className="flex items-center gap-2 text-[13px] text-gray-400"><Spinner size="sm" /> Carregando...</div>
                  ) : (
                    <select
                      value={zabbixHostId}
                      onChange={(e) => zabbixLoadItems(e.target.value)}
                      className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-xl outline-none focus:border-gray-400 bg-white/70"
                    >
                      <option value="">Selecione um host</option>
                      {zabbixHosts.map((h) => (
                        <option key={h.hostid} value={h.hostid}>
                          {h.online ? '● ' : '○ '}{h.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Item mapping */}
              {(zabbixItemsLoading || zabbixItems.length > 0) && (
                <div className="border-t border-gray-100 pt-3 space-y-3">
                  <p className="text-[12px] font-medium text-gray-500 uppercase tracking-wide">
                    Mapeamento de itens
                  </p>
                  {zabbixItemsLoading ? (
                    <div className="flex items-center gap-2 text-[13px] text-gray-400"><Spinner size="sm" /> Carregando itens...</div>
                  ) : (
                    <>
                      {[
                        { label: 'Status (1 = online, 0 = offline)', value: zabbixItemStatus, set: setZabbixItemStatus },
                        { label: 'Modelo da impressora', value: zabbixItemModel, set: setZabbixItemModel },
                        { label: 'Páginas impressas', value: zabbixItemPages, set: setZabbixItemPages },
                        { label: 'Nível de toner (%)', value: zabbixItemToner, set: setZabbixItemToner },
                      ].map(({ label, value, set }) => (
                        <div key={label}>
                          <label className="text-[11px] text-gray-500 block mb-1">{label}</label>
                          <select
                            value={value}
                            onChange={(e) => set(e.target.value)}
                            className="w-full px-3 py-2 text-[12px] border border-gray-200 rounded-xl outline-none focus:border-gray-400 bg-white/70"
                          >
                            <option value="">— não exibir —</option>
                            {zabbixItems.map((item) => (
                              <option key={item.itemid} value={item.itemid}>
                                {item.name}
                                {item.units ? ` (${item.units})` : ''}
                                {item.lastvalue ? ` — ${item.lastvalue}` : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}

                      <div className="flex items-center gap-2 pt-1">
                        <Button onClick={zabbixSaveConfig} loading={zabbixSaving} size="sm">
                          <ChevronRight size={14} />
                          Salvar configuração
                        </Button>
                        {zabbixSaved && (
                          <span className="text-[12px] text-emerald-600 flex items-center gap-1">
                            <Check size={12} /> Salvo
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Edit setting modal */}
      <Modal
        open={!!editSetting}
        onClose={() => setEditSetting(null)}
        title={editSetting ? (SETTING_LABELS[editSetting.key] || editSetting.key) : ''}
        size="sm"
      >
        {editSetting && (() => {
          const type = getSettingInputType(editSetting.key);
          return (
            <>
              {type === 'number' && (
                <Input
                  label="Valor"
                  type="number"
                  min="0"
                  step="1"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value.replace(/[^0-9]/g, ''))}
                  onKeyDown={(e) => e.key === 'Enter' && saveSetting()}
                  autoFocus
                />
              )}
              {type === 'time' && (
                <Input
                  label="Horário (HH:MM)"
                  type="time"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveSetting()}
                  autoFocus
                />
              )}
              {type === 'text' && (
                <Input
                  label="Valor"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveSetting()}
                  autoFocus
                />
              )}
            </>
          );
        })()}

        {settingError && <p className="text-[13px] text-red-500 mt-2">{settingError}</p>}
        <div className="flex gap-2 mt-4">
          <Button variant="secondary" size="sm" onClick={() => setEditSetting(null)}>Cancelar</Button>
          <Button onClick={saveSetting} loading={savingSettings} className="flex-1 justify-center" size="sm">
            Salvar
          </Button>
        </div>
      </Modal>

      {/* Create user modal */}
      <Modal open={createUserModal} onClose={() => setCreateUserModal(false)} title="Novo Usuário" size="sm">
        <div className="space-y-3">
          <Input
            label="Login"
            value={newLogin}
            onChange={(e) => setNewLogin(e.target.value)}
            autoFocus
          />
          <Input
            label="Senha"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-gray-500 uppercase tracking-wide">Perfil</label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="w-full px-3 py-2 text-[14px] border border-gray-200 rounded-xl outline-none focus:border-gray-400 bg-white/70"
            >
              <option value="operator">Operador</option>
              <option value="auditor">Auditor</option>
              <option value="admin">Administrador</option>
            </select>
          </div>
        </div>
        {userError && <p className="text-[13px] text-red-500 mt-2">{userError}</p>}
        <div className="flex gap-2 mt-4">
          <Button variant="secondary" size="sm" onClick={() => setCreateUserModal(false)}>Cancelar</Button>
          <Button onClick={createUser} loading={creatingUser} className="flex-1 justify-center" size="sm">
            Criar
          </Button>
        </div>
      </Modal>
    </div>
  );
}
