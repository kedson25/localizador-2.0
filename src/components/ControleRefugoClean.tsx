import React from 'react';
import type { User } from '../lib/auth';
import { ControleRefugo as ControleRefugoBase } from './ControleRefugo';
import './ControleRefugoTheme.css';

interface ControleRefugoCleanProps {
  currentUser?: User | null;
}

/**
 * Camada visual do Refugo.
 *
 * A persistência das métricas NÃO depende desta camada: cada bip já é salvo
 * automaticamente pela RefugoSyncQueue no estado operacional e também no
 * histórico permanente de métricas.
 */
export function ControleRefugoClean({ currentUser }: ControleRefugoCleanProps) {
  return (
    <div className="refugo-clean">
      <ControleRefugoBase currentUser={currentUser} />
    </div>
  );
}
