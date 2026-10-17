import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Database, Search, UploadCloud, Layers3 } from 'lucide-react';
import type { GroupSummary } from '../types';
import type { User } from '../lib/auth';
import { availableModules } from '../lib/navigation';
import { DashboardShell } from './DashboardShell';

interface ToolsHubProps { totalRows: number; groups: GroupSummary[]; onClear: () => void; currentUser?: User | null; }
export function ToolsHub({ totalRows, groups, onClear, currentUser }: ToolsHubProps) {
  const [query, setQuery] = useState('');
  const modules = availableModules(currentUser);
  const visible = modules.filter(item => `${item.name} ${item.description}`.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR')));
  const canUpload = modules.some(item => item.id === 'upload');
  return (
    <DashboardShell currentUser={currentUser}>
      <div className="hub-intro"><div><span className="eyebrow">Seu centro de operações</span><h1>Uma visão clara.<br /><span>Uma operação conectada.</span></h1><p>Encontre a ferramenta certa e siga com o trabalho.</p></div>{canUpload && <Link to="/upload" className="ui-button ui-button-primary"><UploadCloud size={17} />Importar base<ArrowRight size={16} /></Link>}</div>
      <div className="hub-summary"><div><span className="summary-icon"><Database size={19} /></span><div><span>Base principal</span><strong>{totalRows > 0 ? `${totalRows.toLocaleString('pt-BR')} identificadores` : 'Nenhuma base carregada'}</strong></div></div><div><span className="summary-icon"><Layers3 size={19} /></span><div><span>Grupos na base</span><strong>{groups.length.toLocaleString('pt-BR')}</strong></div></div><div className="summary-end"><span className="base-status"><i className={totalRows ? 'has-data' : ''} />{totalRows ? 'Base disponível' : 'Aguardando importação'}</span>{canUpload && totalRows > 0 && <button type="button" className="clear-base" onClick={() => { if (window.confirm('Tem certeza que deseja zerar os dados da base principal?')) onClear(); }}>Zerar base</button>}</div></div>
      <div className="hub-section-heading"><div><h2>Seus módulos</h2><p>Todas as ferramentas, organizadas por atividade.</p></div><label className="module-filter"><Search size={17} /><input aria-label="Filtrar módulos" placeholder="Filtrar ferramentas" value={query} onChange={event => setQuery(event.target.value)} /></label></div>
      {['Operação', 'Dados e análise'].map(category => {
        const items = visible.filter(item => item.category === category);
        return items.length > 0 ? <section key={category} className="module-group" aria-label={category}><div className="module-group-title"><h3>{category}</h3><span>{items.length.toString().padStart(2, '0')}</span></div><div className="module-grid">{items.map(item => <Link key={item.id} to={item.path} className="module-card"><div className="module-card-top"><span className="module-icon"><item.icon size={22} strokeWidth={1.7} /></span><ArrowRight className="module-arrow" size={18} /></div><h4>{item.name}</h4><p>{item.description}</p></Link>)}</div></section> : null;
      })}
      {!visible.length && <div className="module-empty"><Search size={28} /><h3>{query ? 'Nenhuma ferramenta encontrada' : 'Nenhum módulo liberado'}</h3><p>{query ? 'Tente outro nome ou limpe o filtro.' : 'Solicite a liberação dos módulos ao administrador.'}</p>{query && <button type="button" className="ui-button" onClick={() => setQuery('')}>Limpar filtro</button>}</div>}
      <footer className="workspace-footer"><span>ecooy · Localizador 2.0</span><span>Mais clareza em cada etapa.</span></footer>
    </DashboardShell>
  );
}
