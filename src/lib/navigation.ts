import { Barcode, FileSearch, GitCompareArrows, ListTodo, MessageSquare, PackageOpen, Search, Trash2, Truck, UploadCloud } from 'lucide-react';
import type { User } from './auth';

export const MODULES = [
  { id: 'listas', path: '/listas', name: 'Listas de coleta', description: 'Organize listas e acompanhe a bipagem dos pacotes.', category: 'Operação', icon: ListTodo },
  { id: 'refugo', path: '/refugo', name: 'Controle de refugo', description: 'Confira leituras, faltantes e a passagem pelas rotas.', category: 'Operação', icon: Barcode },
  { id: 'expedicao', path: '/expedicao', name: 'Controle de docas', description: 'Acompanhe despacho, Aduana e Auditoria em um só lugar.', category: 'Operação', icon: Truck },
  { id: 'consulta', path: '/consulta', name: 'Buscar IDs', description: 'Encontre pacotes e identifique suas rotas na base.', category: 'Dados e análise', icon: Search },
  { id: 'brancas', path: '/brancas', name: 'Análise de brancas', description: 'Investigue pacotes sem rota e acompanhe a recuperação.', category: 'Dados e análise', icon: FileSearch },
  { id: 'correlacao', path: '/correlacao', name: 'Correlação de IDs', description: 'Compare listas com a base FOS e encontre correspondências.', category: 'Dados e análise', icon: GitCompareArrows },
  { id: 'baixas', path: '/baixas', name: 'Baixas', description: 'Compare entregues e pacotes em rota para acompanhar o fluxo.', category: 'Dados e análise', icon: PackageOpen },
  { id: 'remover', path: '/remover', name: 'Remover IDs', description: 'Filtre identificadores e prepare a baixa em lote.', category: 'Dados e análise', icon: Trash2 },
  { id: 'reporte', path: '/reporte', name: 'Reporte WhatsApp', description: 'Prepare um resumo da operação para compartilhar.', category: 'Dados e análise', icon: MessageSquare },
  { id: 'upload', path: '/upload', name: 'Importar base', description: 'Carregue ou atualize a base principal de identificadores.', category: 'Dados e análise', icon: UploadCloud },
];
export function availableModules(user?: User | null) {
  return MODULES.filter(item => user?.isAdmin || user?.allowedGroups?.includes(item.id));
}
export function currentModule(path: string) {
  if (path.startsWith('/mapa-refugo')) return MODULES.find(item => item.id === 'refugo');
  return MODULES.find(item => path === item.path || path.startsWith(item.path + '/'));
}
