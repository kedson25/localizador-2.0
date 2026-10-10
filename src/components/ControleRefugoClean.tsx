import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Barcode, Layers, ArrowLeft } from 'lucide-react';
import type { User } from '../lib/auth';
import { ControleRefugo as ControleRefugoBase } from './ControleRefugo';
import { MapaRefugo } from './MapaRefugo';
import './ControleRefugoTheme.css';

interface ControleRefugoCleanProps {
  currentUser?: User | null;
  initialTab?: 'leitura' | 'mapa';
}

/** Interface principal do Refugo com alternância integrada entre Conferência e Mapa Refugo. */
export function ControleRefugoClean({ currentUser, initialTab }: ControleRefugoCleanProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('aba');

  const [activeTab, setActiveTab] = useState<'leitura' | 'mapa'>(() => {
    if (urlTab === 'mapa' || initialTab === 'mapa') return 'mapa';
    return 'leitura';
  });

  useEffect(() => {
    if (urlTab === 'mapa') {
      setActiveTab('mapa');
    } else if (urlTab === 'leitura') {
      setActiveTab('leitura');
    }
  }, [urlTab]);

  const handleSelectTab = (tab: 'leitura' | 'mapa') => {
    setActiveTab(tab);
    setSearchParams(tab === 'mapa' ? { aba: 'mapa' } : {});
  };

  return (
    <div className="refugo-clean space-y-4">
      {/* Navegação de Abas do Módulo Refugo */}
      <div className="border border-slate-300 bg-white p-2 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleSelectTab('leitura')}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-black uppercase tracking-wider transition-colors cursor-pointer border ${
                activeTab === 'leitura'
                  ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                  : 'bg-white text-slate-700 border-transparent hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Barcode className="h-4 w-4" />
              <span>Conferência Refugo</span>
            </button>

            <button
              type="button"
              onClick={() => handleSelectTab('mapa')}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-black uppercase tracking-wider transition-colors cursor-pointer border ${
                activeTab === 'mapa'
                  ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                  : 'bg-white text-slate-700 border-transparent hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Layers className="h-4 w-4" />
              <span>Mapa Refugo</span>
            </button>
          </div>

          <div className="hidden sm:flex items-center text-[11px] font-bold text-slate-500 uppercase tracking-wide px-2">
            {activeTab === 'leitura' ? 'Modo Bipagem & Auditoria' : 'Modo Visão de Rotas & Passagem'}
          </div>
        </div>
      </div>

      {/* Conteúdo da Aba Ativa */}
      {activeTab === 'leitura' ? (
        <ControleRefugoBase
          currentUser={currentUser}
          onNavigateToMapa={() => handleSelectTab('mapa')}
        />
      ) : (
        <MapaRefugo
          currentUser={currentUser}
          onNavigateToRefugo={() => handleSelectTab('leitura')}
        />
      )}
    </div>
  );
}
