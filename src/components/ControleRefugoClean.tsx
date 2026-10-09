import React from 'react';
import type { User } from '../lib/auth';
import { ControleRefugo as ControleRefugoBase } from './ControleRefugo';
import './ControleRefugoTheme.css';

interface ControleRefugoCleanProps {
  currentUser?: User | null;
}

/** Interface principal do Refugo, sem salas CSV e armazenamento local de salas. */
export function ControleRefugoClean({ currentUser }: ControleRefugoCleanProps) {
  return (
    <div className="refugo-clean space-y-4">
      <ControleRefugoBase currentUser={currentUser} />
    </div>
  );
}
