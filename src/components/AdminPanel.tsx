import React from 'react';
import type { User } from '../lib/auth';
import { AdminPanel as AdminPanelClean } from './AdminPanelClean';
import './AdminPanelTheme.css';

export type { RefugoScan } from './AdminPanelClean';

interface AdminPanelProps {
  currentUser?: User | null;
}

export const AdminPanel: React.FC<AdminPanelProps> = props => (
  <div className="admin-theme">
    <AdminPanelClean {...props} />
  </div>
);
