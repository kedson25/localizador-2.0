import React, { useEffect, useMemo, useState } from 'react';
import { Bell, Check, ChevronLeft, KeyRound, Settings, ShieldAlert, ShieldCheck, UserCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { User } from '../lib/auth';
import {
  DEFAULT_MAINTENANCE_CONFIG,
  listenMaintenanceConfig,
  saveMaintenanceConfig,
  type MaintenanceConfig,
} from '../lib/maintenance';

interface SettingsPageProps { currentUser?: User | null; }
const PREFS_KEY = 'ecooy_user_preferences';
interface Preferences { notifications: boolean; compactMode: boolean; }

function loadPreferences(): Preferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return { notifications: parsed.notifications !== false, compactMode: parsed.compactMode === true };
  } catch { return { notifications: true, compactMode: false }; }
}

function toLocalInput(value: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ currentUser }) => {
  const navigate = useNavigate();
  const [preferences, setPreferences] = useState<Preferences>(() => loadPreferences());
  const [saved, setSaved] = useState(false);
  const [maintenance, setMaintenance] = useState<MaintenanceConfig>(DEFAULT_MAINTENANCE_CONFIG);
  const [maintenanceSaved, setMaintenanceSaved] = useState(false);
  const [maintenanceError, setMaintenanceError] = useState('');

  useEffect(() => listenMaintenanceConfig(setMaintenance, () => setMaintenanceError('Não foi possível sincronizar o modo manutenção.')), []);

  const permissionLabel = useMemo(() => {
    if (currentUser?.isAdmin) return 'Administrador';
    if (!currentUser?.allowedGroups?.length) return 'Sem módulos liberados';
    return `${currentUser.allowedGroups.length} módulos liberados`;
  }, [currentUser]);

  const savePreferences = () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify(preferences));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  const persistMaintenance = async () => {
    if (!currentUser?.isAdmin) return;
    setMaintenanceError('');
    try {
      await saveMaintenanceConfig(maintenance);
      setMaintenanceSaved(true);
      window.setTimeout(() => setMaintenanceSaved(false), 1800);
    } catch (error) {
      console.error(error);
      setMaintenanceError('Falha ao salvar a manutenção global.');
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => navigate('/')} className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white" aria-label="Voltar"><ChevronLeft className="h-5 w-5" /></button>
        <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Ecooy</p><h1 className="text-2xl font-black text-slate-900">Configurações</h1></div>
      </div>

      {currentUser?.isAdmin && (
        <section className="overflow-hidden rounded-2xl border border-amber-300 bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b border-amber-100 px-5 py-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><ShieldAlert className="h-5 w-5" /></span>
            <div><h2 className="font-extrabold text-slate-900">Modo manutenção global</h2><p className="text-xs text-slate-500">Bloqueia o sistema para todos os usuários. Admin e esta tela continuam acessíveis.</p></div>
          </div>
          <div className="space-y-4 p-5">
            <label className="flex items-center justify-between gap-4 border border-slate-200 p-4"><div><div className="text-sm font-black">Sistema em manutenção</div><div className="text-xs text-slate-500">Ative para travar todas as rotas operacionais.</div></div><input type="checkbox" checked={maintenance.enabled} onChange={event => setMaintenance(prev => ({ ...prev, enabled: event.target.checked }))} className="h-5 w-5 accent-amber-600" /></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-bold text-slate-600">Até quando<input type="datetime-local" value={toLocalInput(maintenance.until)} onChange={event => setMaintenance(prev => ({ ...prev, until: event.target.value ? new Date(event.target.value).toISOString() : '' }))} className="mt-1 h-10 w-full border border-slate-300 px-3 text-sm" /></label>
              <label className="text-xs font-bold text-slate-600">Mensagem<input value={maintenance.message} onChange={event => setMaintenance(prev => ({ ...prev, message: event.target.value }))} className="mt-1 h-10 w-full border border-slate-300 px-3 text-sm" placeholder="Sistema em manutenção." /></label>
            </div>
            {maintenanceError && <p className="text-xs font-bold text-red-700">{maintenanceError}</p>}
            <div className="flex justify-end"><button type="button" onClick={persistMaintenance} className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-black text-slate-950">{maintenanceSaved ? <Check className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}{maintenanceSaved ? 'Salvo' : 'Salvar manutenção'}</button></div>
          </div>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4"><Settings className="h-5 w-5 text-blue-600" /><div><h2 className="font-extrabold">Preferências</h2><p className="text-xs text-slate-500">Ajustes deste navegador.</p></div></div>
          <div className="divide-y divide-slate-100">
            <label className="flex items-center justify-between gap-4 px-5 py-4"><div className="flex items-center gap-3"><Bell className="h-5 w-5 text-slate-500" /><div><div className="text-sm font-bold">Avisos visuais</div><div className="text-xs text-slate-500">Exibir alertas e indicadores.</div></div></div><input type="checkbox" checked={preferences.notifications} onChange={event => setPreferences(prev => ({ ...prev, notifications: event.target.checked }))} /></label>
            <label className="flex items-center justify-between gap-4 px-5 py-4"><div className="flex items-center gap-3"><KeyRound className="h-5 w-5 text-slate-500" /><div><div className="text-sm font-bold">Modo compacto</div><div className="text-xs text-slate-500">Reduzir espaçamentos.</div></div></div><input type="checkbox" checked={preferences.compactMode} onChange={event => setPreferences(prev => ({ ...prev, compactMode: event.target.checked }))} /></label>
          </div>
          <div className="flex justify-end border-t border-slate-100 bg-slate-50 px-5 py-4"><button type="button" onClick={savePreferences} className="inline-flex items-center gap-2 rounded-xl bg-[#1769ff] px-4 py-2.5 text-sm font-extrabold text-white">{saved ? <Check className="h-4 w-4" /> : <Settings className="h-4 w-4" />}{saved ? 'Salvo' : 'Salvar alterações'}</button></div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5 flex items-center gap-3"><UserCircle2 className="h-8 w-8 text-slate-700" /><div className="min-w-0"><h2 className="truncate font-extrabold">{currentUser?.username || 'Usuário'}</h2><p className="truncate text-xs text-slate-500">{currentUser?.email || 'Sem e-mail informado'}</p></div></div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-4"><div className="flex items-center gap-2 text-sm font-bold"><ShieldCheck className="h-5 w-5 text-emerald-600" />Acesso</div><p className="mt-2 text-sm text-slate-600">{permissionLabel}</p></div>
        </section>
      </div>
    </div>
  );
};
