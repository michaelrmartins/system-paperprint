import { useState, useEffect } from 'react';
import api from '../lib/api';
import { Setting, SystemUser } from '../types';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Modal } from '../components/Modal';
import { Spinner } from '../components/Spinner';
import { extractApiError } from '../lib/errors';
import { SETTING_LABELS, ROLE_LABELS, formatDate } from '../lib/format';
import { Plus, Pencil, Wifi, ChevronRight, Check, Trash2, UserX, UserCheck } from 'lucide-react';

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
  if (key === 'duplex_counts_double' || key === 'allow_cross_type_stacking' || key === 'allow_employee_employee_stacking') return 'boolean';
  if (key === 'daily_quota' || key === 'employee_daily_quota' || key === 'max_stacked_registrations') return 'number';
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
      className={`relative inline-flex h-7 w-12 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 ${
        value ? 'bg-gray-900 dark:bg-white' : 'bg-gray-200 dark:bg-gray-700'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white dark:bg-gray-900 shadow-sm ring-0 transition-transform duration-200 ease-in-out ${
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

  // Create user modal
  const [createUserModal, setCreateUserModal] = useState(false);
  const [newLogin, setNewLogin] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('operator');
  const [creatingUser, setCreatingUser] = useState(false);
  const [userError, setUserError] = useState('');

  // Edit user modal
  const [editUser, setEditUser] = useState<SystemUser | null>(null);
  const [editUserRole, setEditUserRole] = useState('operator');
  const [editUserPassword, setEditUserPassword] = useState('');
  const [editUserConfirm, setEditUserConfirm] = useState('');
  const [editingUser, setEditingUser] = useState(false);
  const [editUserError, setEditUserError] = useState('');

  // Remove user confirmation
  const [removeUser, setRemoveUser] = useState<SystemUser | null>(null);
  const [removingUser, setRemovingUser] = useState(false);

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
      // silently ignore — UI stays consistent since we don't optimistically update
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

  const openEditUser = (u: SystemUser) => {
    setEditUser(u);
    setEditUserRole(u.role);
    setEditUserPassword('');
    setEditUserConfirm('');
    setEditUserError('');
  };

  const submitEditUser = async () => {
    if (!editUser) return;
    if (editUserPassword && editUserPassword !== editUserConfirm) {
      setEditUserError('Senhas não coincidem.');
      return;
    }
    if (editUserPassword && editUserPassword.length < 8) {
      setEditUserError('A senha deve ter pelo menos 8 caracteres.');
      return;
    }
    const updates: Record<string, unknown> = { role: editUserRole };
    if (editUserPassword) updates.password = editUserPassword;
    setEditingUser(true);
    setEditUserError('');
    try {
      const res = await api.patch<{ id: number; login: string; role: string; active: boolean }>(`/system-users/${editUser.id}`, updates);
      setUsers((prev) => prev.map((u) => u.id === editUser.id ? { ...u, role: res.data.role as SystemUser['role'] } : u));
      setEditUser(null);
    } catch (err) {
      setEditUserError(extractApiError(err));
    } finally {
      setEditingUser(false);
    }
  };

  const toggleUser = async (u: SystemUser) => {
    await api.patch(`/system-users/${u.id}`, { active: !u.active });
    setUsers((prev) => prev.map((x) => x.id === u.id ? { ...x, active: !u.active } : x));
  };

  const confirmRemoveUser = async () => {
    if (!removeUser) return;
    setRemovingUser(true);
    try {
      await api.patch(`/system-users/${removeUser.id}`, { active: false });
      setUsers((prev) => prev.map((u) => u.id === removeUser.id ? { ...u, active: false } : u));
      setRemoveUser(null);
    } finally {
      setRemovingUser(false);
    }
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

  const selectClass = 'w-full px-3.5 py-2.5 text-[14px] border border-gray-200 dark:border-gray-700 rounded-xl outline-none focus:border-gray-400 dark:focus:border-gray-500 bg-white/70 dark:bg-gray-900/70 text-gray-900 dark:text-white';

  if (loading) {
    return <div className="flex justify-center py-12"><Spinner /></div>;
  }

  return (
    <div className="space-y-7">
      <h1 className="text-[20px] font-semibold text-gray-900 dark:text-white">Configurações</h1>

      {/* System settings */}
      <section>
        <h2 className="text-[13px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Parâmetros do Sistema</h2>
        <div className="bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl border border-white/60 dark:border-white/10 rounded-2xl shadow-glass dark:shadow-glass-dark divide-y divide-gray-100/80 dark:divide-gray-800/60">
          {settings.map((s) => {
            const type = getSettingInputType(s.key);
            return (
              <div key={s.key} className="flex items-center justify-between px-5 py-4">
                <div>
                  <p className="text-[15px] font-medium text-gray-900 dark:text-white">{SETTING_LABELS[s.key] || s.key}</p>
                  <p className="text-[13px] text-gray-400 dark:text-gray-500 mt-0.5">{s.description}</p>
                </div>
                <div className="flex items-center gap-3">
                  {type === 'boolean' ? (
                    <ToggleSwitch
                      value={s.value === 'true'}
                      onChange={(v) => saveBoolean(s, v)}
                    />
                  ) : (
                    <>
                      <span className="text-[15px] font-semibold text-gray-700 dark:text-gray-200">{s.value}</span>
                      <button
                        onClick={() => openEdit(s)}
                        className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                      >
                        <Pencil size={16} />
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
          <h2 className="text-[13px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Usuários do Sistema</h2>
          <Button size="sm" variant="secondary" onClick={() => setCreateUserModal(true)}>
            <Plus size={16} /> Novo usuário
          </Button>
        </div>
        <div className="bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl border border-white/60 dark:border-white/10 rounded-2xl shadow-glass dark:shadow-glass-dark divide-y divide-gray-100/80 dark:divide-gray-800/60">
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between px-5 py-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2.5">
                  <p className="text-[15px] font-medium text-gray-900 dark:text-white">{u.login}</p>
                  {!u.active && (
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                      Inativo
                    </span>
                  )}
                </div>
                <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-0.5">
                  {ROLE_LABELS[u.role]} · criado em {formatDate(u.created_at)}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* Edit */}
                <button
                  onClick={() => openEditUser(u)}
                  className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  title="Editar usuário"
                >
                  <Pencil size={16} />
                </button>
                {/* Toggle active */}
                <button
                  onClick={() => toggleUser(u)}
                  className={`p-1.5 rounded-lg transition-colors ${
                    u.active
                      ? 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
                      : 'text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                  title={u.active ? 'Desativar usuário' : 'Ativar usuário'}
                >
                  {u.active ? <UserCheck size={16} /> : <UserX size={16} />}
                </button>
                {/* Remove (soft delete = deactivate) */}
                <button
                  onClick={() => setRemoveUser(u)}
                  className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors"
                  title="Remover usuário"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Zabbix integration */}
      <section>
        <h2 className="text-[13px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Integração Zabbix</h2>
        <div className="bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl border border-white/60 dark:border-white/10 rounded-2xl shadow-glass dark:shadow-glass-dark p-5 space-y-4">
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
            <Button onClick={zabbixConnect} loading={zabbixConnecting} variant="secondary" size="sm">
              <Wifi size={16} />
              Conectar e listar grupos
            </Button>
            {zabbixHostId && !zabbixGroups.length && (
              <span className="text-[13px] text-emerald-600 flex items-center gap-1">
                <Check size={14} /> Configurado: {zabbixHostName}
              </span>
            )}
          </div>

          {zabbixConnectError && (
            <p className="text-[14px] text-red-500">{zabbixConnectError}</p>
          )}

          {zabbixGroups.length > 0 && (
            <div className="border-t border-gray-100 dark:border-gray-800 pt-4 space-y-3">
              <div>
                <label className="text-[13px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide block mb-1.5">Grupo</label>
                <select value={zabbixGroupId} onChange={(e) => zabbixLoadHosts(e.target.value)} className={selectClass}>
                  <option value="">Selecione um grupo</option>
                  {zabbixGroups.map((g) => (
                    <option key={g.groupid} value={g.groupid}>{g.name}</option>
                  ))}
                </select>
              </div>

              {(zabbixHostsLoading || zabbixHosts.length > 0) && (
                <div>
                  <label className="text-[13px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide block mb-1.5">Host</label>
                  {zabbixHostsLoading ? (
                    <div className="flex items-center gap-2 text-[14px] text-gray-400 dark:text-gray-500"><Spinner size="sm" /> Carregando...</div>
                  ) : (
                    <select value={zabbixHostId} onChange={(e) => zabbixLoadItems(e.target.value)} className={selectClass}>
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

              {(zabbixItemsLoading || zabbixItems.length > 0) && (
                <div className="border-t border-gray-100 dark:border-gray-800 pt-3 space-y-3">
                  <p className="text-[13px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Mapeamento de itens</p>
                  {zabbixItemsLoading ? (
                    <div className="flex items-center gap-2 text-[14px] text-gray-400 dark:text-gray-500"><Spinner size="sm" /> Carregando itens...</div>
                  ) : (
                    <>
                      {[
                        { label: 'Status (1 = online, 0 = offline)', value: zabbixItemStatus, set: setZabbixItemStatus },
                        { label: 'Modelo da impressora', value: zabbixItemModel, set: setZabbixItemModel },
                        { label: 'Páginas impressas', value: zabbixItemPages, set: setZabbixItemPages },
                        { label: 'Nível de toner (%)', value: zabbixItemToner, set: setZabbixItemToner },
                      ].map(({ label, value, set }) => (
                        <div key={label}>
                          <label className="text-[12px] text-gray-500 dark:text-gray-400 block mb-1">{label}</label>
                          <select value={value} onChange={(e) => set(e.target.value)} className={selectClass}>
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
                          <ChevronRight size={16} />
                          Salvar configuração
                        </Button>
                        {zabbixSaved && (
                          <span className="text-[13px] text-emerald-600 flex items-center gap-1">
                            <Check size={14} /> Salvo
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
                <Input label="Valor" type="number" min="0" step="1"
                  value={editValue} onChange={(e) => setEditValue(e.target.value.replace(/[^0-9]/g, ''))}
                  onKeyDown={(e) => e.key === 'Enter' && saveSetting()} autoFocus />
              )}
              {type === 'time' && (
                <Input label="Horário (HH:MM)" type="time"
                  value={editValue} onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveSetting()} autoFocus />
              )}
              {type === 'text' && (
                <Input label="Valor"
                  value={editValue} onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveSetting()} autoFocus />
              )}
            </>
          );
        })()}
        {settingError && <p className="text-[14px] text-red-500 mt-2">{settingError}</p>}
        <div className="flex gap-2 mt-4">
          <Button variant="secondary" size="sm" onClick={() => setEditSetting(null)}>Cancelar</Button>
          <Button onClick={saveSetting} loading={savingSettings} className="flex-1 justify-center" size="sm">
            Salvar
          </Button>
        </div>
      </Modal>

      {/* Create user modal */}
      <Modal open={createUserModal} onClose={() => setCreateUserModal(false)} title="Novo Usuário" size="sm">
        <div className="space-y-4">
          <Input label="Login" value={newLogin} onChange={(e) => setNewLogin(e.target.value)} autoFocus />
          <Input label="Senha" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Perfil</label>
            <select value={newRole} onChange={(e) => setNewRole(e.target.value)} className={selectClass}>
              <option value="operator">Operador</option>
              <option value="auditor">Auditor</option>
              <option value="admin">Administrador</option>
            </select>
          </div>
        </div>
        {userError && <p className="text-[14px] text-red-500 mt-2">{userError}</p>}
        <div className="flex gap-2 mt-4">
          <Button variant="secondary" size="sm" onClick={() => setCreateUserModal(false)}>Cancelar</Button>
          <Button onClick={createUser} loading={creatingUser} className="flex-1 justify-center" size="sm">Criar</Button>
        </div>
      </Modal>

      {/* Edit user modal */}
      <Modal open={!!editUser} onClose={() => setEditUser(null)} title={`Editar — ${editUser?.login}`} size="sm">
        <div className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Perfil</label>
            <select value={editUserRole} onChange={(e) => setEditUserRole(e.target.value)} className={selectClass}>
              <option value="operator">Operador</option>
              <option value="auditor">Auditor</option>
              <option value="admin">Administrador</option>
            </select>
          </div>
          <div className="pt-1 border-t border-gray-100 dark:border-gray-800">
            <p className="text-[13px] text-gray-500 dark:text-gray-400 mb-3">Nova senha (deixe em branco para não alterar)</p>
            <div className="space-y-3">
              <Input label="Nova senha" type="password" value={editUserPassword} onChange={(e) => setEditUserPassword(e.target.value)} />
              <Input label="Confirmar senha" type="password" value={editUserConfirm} onChange={(e) => setEditUserConfirm(e.target.value)} />
            </div>
          </div>
        </div>
        {editUserError && <p className="text-[14px] text-red-500 mt-2">{editUserError}</p>}
        <div className="flex gap-2 mt-4">
          <Button variant="secondary" size="sm" onClick={() => setEditUser(null)}>Cancelar</Button>
          <Button onClick={submitEditUser} loading={editingUser} className="flex-1 justify-center" size="sm">Salvar</Button>
        </div>
      </Modal>

      {/* Remove user confirmation */}
      <Modal open={!!removeUser} onClose={() => setRemoveUser(null)} title="Remover Usuário" size="sm">
        <div className="space-y-3">
          <p className="text-[15px] text-gray-700 dark:text-gray-200">
            Deseja desativar o usuário <strong>{removeUser?.login}</strong>?
          </p>
          <p className="text-[13px] text-gray-500 dark:text-gray-400">
            O usuário será desativado e não poderá mais acessar o sistema. O histórico de operações será preservado.
          </p>
        </div>
        <div className="flex gap-2 mt-5">
          <Button variant="secondary" size="sm" onClick={() => setRemoveUser(null)}>Cancelar</Button>
          <Button variant="danger" onClick={confirmRemoveUser} loading={removingUser} className="flex-1 justify-center" size="sm">
            <Trash2 size={15} /> Desativar
          </Button>
        </div>
      </Modal>
    </div>
  );
}
