import React, { useMemo, useState } from 'react';
import {
  Bell,
  Check,
  ChevronLeft,
  KeyRound,
  Settings,
  ShieldCheck,
  UserCircle2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { User } from '../lib/auth';

interface SettingsPageProps {
  currentUser?: User | null;
}

const PREFS_KEY = 'ecooy_user_preferences';

interface Preferences {
  notifications: boolean;
  compactMode: boolean;
}

function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { notifications: true, compactMode: false };
    const parsed = JSON.parse(raw);
    return {
      notifications: parsed.notifications !== false,
      compactMode: parsed.compactMode === true,
    };
  } catch {
    return { notifications: true, compactMode: false };
  }
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ currentUser }) => {
  const navigate = useNavigate();
  const [preferences, setPreferences] = useState<Preferences>(() => loadPreferences());
  const [saved, setSaved] = useState(false);

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

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50"
            aria-label="Voltar"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Ecooy</p>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">Configurações</h1>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-[#1769ff]">
              <Settings className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-extrabold text-slate-900">Preferências</h2>
              <p className="text-xs text-slate-500">Ajustes salvos neste navegador.</p>
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            <label className="flex cursor-pointer items-center justify-between gap-4 px-5 py-4">
              <div className="flex items-center gap-3">
                <Bell className="h-5 w-5 text-slate-500" />
                <div>
                  <div className="text-sm font-bold text-slate-800">Avisos visuais</div>
                  <div className="text-xs text-slate-500">Exibir alertas e indicadores no sistema.</div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={preferences.notifications}
                onChange={event => setPreferences(prev => ({ ...prev, notifications: event.target.checked }))}
                className="h-4 w-4 accent-[#1769ff]"
              />
            </label>

            <label className="flex cursor-pointer items-center justify-between gap-4 px-5 py-4">
              <div className="flex items-center gap-3">
                <KeyRound className="h-5 w-5 text-slate-500" />
                <div>
                  <div className="text-sm font-bold text-slate-800">Modo compacto</div>
                  <div className="text-xs text-slate-500">Reduzir espaçamentos nas telas de operação.</div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={preferences.compactMode}
                onChange={event => setPreferences(prev => ({ ...prev, compactMode: event.target.checked }))}
                className="h-4 w-4 accent-[#1769ff]"
              />
            </label>
          </div>

          <div className="flex justify-end border-t border-slate-100 bg-slate-50/70 px-5 py-4">
            <button
              type="button"
              onClick={savePreferences}
              className="inline-flex items-center gap-2 rounded-xl bg-[#1769ff] px-4 py-2.5 text-sm font-extrabold text-white shadow-sm transition hover:bg-blue-700"
            >
              {saved ? <Check className="h-4 w-4" /> : <Settings className="h-4 w-4" />}
              {saved ? 'Salvo' : 'Salvar alterações'}
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#fff7c7] text-slate-800">
              <UserCircle2 className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate font-extrabold text-slate-900">{currentUser?.username || 'Usuário'}</h2>
              <p className="truncate text-xs text-slate-500">{currentUser?.email || 'Sem e-mail informado'}</p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              Acesso
            </div>
            <p className="mt-2 text-sm text-slate-600">{permissionLabel}</p>
          </div>

          {currentUser?.allowedGroups?.length ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {currentUser.allowedGroups.map(group => (
                <span key={group} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600">
                  {group}
                </span>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
};
