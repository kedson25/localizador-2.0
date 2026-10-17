import React, { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ArrowUpRight, BarChart3, Boxes, ChevronRight, LogOut, Menu, Search, Settings, X, Zap } from 'lucide-react';
import type { User } from '../lib/auth';
import { availableModules, currentModule } from '../lib/navigation';

interface DashboardShellProps {
  currentUser?: User | null;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function DashboardShell({ currentUser, title, subtitle, children }: DashboardShellProps) {
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const modules = availableModules(currentUser);
  const active = currentModule(pathname);
  const pageName = active?.name || (pathname === '/admin' ? 'Administração' : pathname === '/configuracoes' ? 'Configurações' : 'Visão geral');
  const results = query.trim() ? modules.filter(item => `${item.name} ${item.description}`.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR'))) : [];

  useEffect(() => { setMobileOpen(false); setQuery(''); }, [pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    menuRef.current?.focus();
    return () => { document.body.style.overflow = previous; };
  }, [mobileOpen]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMobileOpen(false); setQuery(''); if (mobileOpen) openerRef.current?.focus(); }
      if (mobileOpen && event.key === 'Tab') {
        const items = sidebarRef.current?.querySelectorAll<HTMLElement>('a[href], button');
        const first = items?.[0]; const last = items?.[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'k') { event.preventDefault(); searchRef.current?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const logout = async () => { const { logoutUser } = await import('../lib/auth'); logoutUser(); };
  return (
    <div className="ecooy-shell">
      <a href="#main-content" className="skip-link">Pular para o conteúdo</a>
      {mobileOpen && <button type="button" className="sidebar-backdrop" onClick={() => setMobileOpen(false)} aria-label="Fechar navegação" />}
      <aside ref={sidebarRef} id="app-navigation" className={`app-sidebar ${mobileOpen ? 'is-open' : ''}`} aria-label="Navegação principal">
        <NavLink to="/" className="app-brand"><span className="brand-mark"><Zap size={20} fill="currentColor" /></span><span>ecooy<span className="brand-caption">Workspace logístico</span></span></NavLink>
        <button ref={menuRef} type="button" className="sidebar-close" onClick={() => { setMobileOpen(false); openerRef.current?.focus(); }} aria-label="Fechar navegação"><X size={20} /></button>
        <nav className="sidebar-links">
          <NavLink to="/" end className="sidebar-link"><Boxes size={18} />Visão geral</NavLink>
          {['Operação', 'Dados e análise'].map(category => (
            <React.Fragment key={category}>
              {modules.some(item => item.category === category) && <p className="nav-category">{category}</p>}
              {modules.filter(item => item.category === category).map(item => <NavLink key={item.id} to={item.path} className={`sidebar-link ${item.id === 'refugo' && pathname.startsWith('/mapa-refugo') ? 'active' : ''}`}><item.icon size={18} /><span>{item.name}</span></NavLink>)}
            </React.Fragment>
          ))}
          <p className="nav-category">Workspace</p>
          {currentUser?.isAdmin && <NavLink to="/admin" className="sidebar-link"><BarChart3 size={18} />Administração</NavLink>}
          <NavLink to="/configuracoes" className="sidebar-link"><Settings size={18} />Configurações</NavLink>
        </nav>
        <div className="sidebar-account"><span className="user-avatar">{(currentUser?.username || 'U').slice(0, 2).toUpperCase()}</span><div><strong>{currentUser?.username || 'Usuário'}</strong><span>{currentUser?.isAdmin ? 'Administrador' : 'Operador'}</span></div><button type="button" onClick={logout} aria-label="Sair do sistema" title="Sair do sistema"><LogOut size={18} /></button></div>
      </aside>
      <div className="app-workspace" inert={mobileOpen}>
        <header className="app-topbar">
          <button ref={openerRef} type="button" className="mobile-menu" onClick={() => setMobileOpen(true)} aria-expanded={mobileOpen} aria-controls="app-navigation" aria-label="Abrir navegação"><Menu size={21} /></button>
          <div className="app-breadcrumb"><NavLink to="/">Workspace</NavLink><ChevronRight size={14} /><span>{pageName}</span></div>
          <div className="workspace-search" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setQuery(''); }}>
            <Search size={17} /><input ref={searchRef} aria-label="Buscar módulo" placeholder="Buscar módulo..." value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); (event.currentTarget.parentElement?.querySelector('a') as HTMLAnchorElement | null)?.focus(); } }} /><kbd>⌘ K</kbd>
            {query.trim() && <div className="search-results">{results.length ? results.map(item => <NavLink key={item.id} to={item.path}><item.icon size={17} /><span>{item.name}</span><ArrowUpRight size={15} /></NavLink>) : <p>Nenhum módulo encontrado.</p>}</div>}
          </div>
          <span className="workspace-label">Localizador <strong>2.0</strong></span>
        </header>
        <main id="main-content" tabIndex={-1} className={`app-content ${active?.id === 'expedicao' ? 'app-content-wide' : ''}`}>
          {(title || subtitle) && <div className="page-heading">{title && <h1>{title}</h1>}{subtitle && <p>{subtitle}</p>}</div>}
          <div className="module-content">{children}</div>
        </main>
      </div>
    </div>
  );
}
