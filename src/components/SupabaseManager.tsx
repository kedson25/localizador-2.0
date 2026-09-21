import React, { useState, useEffect } from 'react';
import { 
  Database, 
  CheckCircle2, 
  AlertTriangle, 
  RefreshCw, 
  Copy, 
  Check, 
  ExternalLink, 
  Terminal, 
  Layers, 
  Zap,
  Server,
  Lock
} from 'lucide-react';
import { 
  getSupabaseConfig, 
  isSupabaseConfigured, 
  testSupabaseConnection 
} from '../lib/supabase';

export const SupabaseManager: React.FC = () => {
  const [config, setConfig] = useState(getSupabaseConfig());
  const [isConfigured, setIsConfigured] = useState(isSupabaseConfigured());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    connected: boolean;
    message: string;
    tablesFound?: string[];
    latencyMs?: number;
  } | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);

  useEffect(() => {
    setConfig(getSupabaseConfig());
    setIsConfigured(isSupabaseConfigured());
    if (isSupabaseConfigured()) {
      handleTestConnection();
    }
  }, []);

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const res = await testSupabaseConnection();
      setTestResult(res);
    } catch (err: any) {
      setTestResult({
        connected: false,
        message: err?.message || 'Falha ao testar conexão',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleCopySql = async () => {
    const sqlText = `-- ESQUEMA SUPABASE - LOCALIZADOR 2.0 (COLETA & REFUGO)
CREATE TABLE IF NOT EXISTS public.app_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  is_admin BOOLEAN DEFAULT FALSE,
  is_approved BOOLEAN DEFAULT TRUE,
  allowed_groups JSONB DEFAULT '["consulta", "remover", "reporte", "listas", "upload"]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.coletor_data (
  id TEXT PRIMARY KEY,
  raw_text TEXT NOT NULL,
  total_rows INTEGER DEFAULT 0,
  file_name TEXT DEFAULT 'relatorio.csv',
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.refugo_data (
  id TEXT PRIMARY KEY,
  raw_text TEXT NOT NULL,
  total_rows INTEGER DEFAULT 0,
  file_name TEXT DEFAULT 'refugo.csv',
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.refugo_scans (
  id TEXT PRIMARY KEY,
  normalized_id TEXT NOT NULL,
  rota TEXT DEFAULT 'Sem Rota',
  scanned_at TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  status TEXT DEFAULT 'found',
  found_by TEXT,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_refugo_scans_timestamp ON public.refugo_scans(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_refugo_scans_normalized_id ON public.refugo_scans(normalized_id);

CREATE TABLE IF NOT EXISTS public.coleta_listas (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  tipo TEXT DEFAULT 'comum',
  grupos JSONB DEFAULT '[]'::jsonb,
  grupo_ativo_id TEXT,
  rota TEXT DEFAULT '',
  data TEXT DEFAULT '',
  saida TEXT,
  responsavel TEXT DEFAULT 'Operador',
  status TEXT DEFAULT 'em_andamento',
  saida_padrao TEXT DEFAULT 'Ciclo 2 - Saída PM',
  motivo_padrao TEXT DEFAULT 'Pendente',
  total_itens INTEGER DEFAULT 0,
  total_validados INTEGER DEFAULT 0,
  saidas_count JSONB DEFAULT '{}'::jsonb,
  motivos_count JSONB DEFAULT '{}'::jsonb,
  rotas_count JSONB DEFAULT '{}'::jsonb,
  bips_por_operador JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_coleta_listas_created_at ON public.coleta_listas(created_at DESC);

CREATE TABLE IF NOT EXISTS public.coleta_itens (
  id TEXT PRIMARY KEY,
  lista_id TEXT NOT NULL REFERENCES public.coleta_listas(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  codigo_clean TEXT NOT NULL,
  rota TEXT DEFAULT 'Sem Rota',
  saida TEXT DEFAULT 'Ciclo 2 - Saída PM',
  motivo TEXT DEFAULT 'Pendente',
  scanned_at TEXT NOT NULL,
  responsavel TEXT DEFAULT 'Operador',
  grupo_id TEXT,
  validado BOOLEAN DEFAULT FALSE,
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_coleta_itens_lista_id ON public.coleta_itens(lista_id);
CREATE INDEX IF NOT EXISTS idx_coleta_itens_codigo ON public.coleta_itens(codigo);
CREATE INDEX IF NOT EXISTS idx_coleta_itens_codigo_clean ON public.coleta_itens(codigo_clean);
CREATE INDEX IF NOT EXISTS idx_coleta_itens_timestamp ON public.coleta_itens(timestamp DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE public.coleta_listas;
ALTER PUBLICATION supabase_realtime ADD TABLE public.coleta_itens;
ALTER PUBLICATION supabase_realtime ADD TABLE public.refugo_scans;

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coletor_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refugo_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refugo_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coleta_listas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coleta_itens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir tudo app_users" ON public.app_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Permitir tudo coletor_data" ON public.coletor_data FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Permitir tudo refugo_data" ON public.refugo_data FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Permitir tudo refugo_scans" ON public.refugo_scans FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Permitir tudo coleta_listas" ON public.coleta_listas FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Permitir tudo coleta_itens" ON public.coleta_itens FOR ALL USING (true) WITH CHECK (true);`;

    try {
      await navigator.clipboard.writeText(sqlText);
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 3000);
    } catch (_) {}
  };

  return (
    <div className="space-y-6 animate-in fade-in">
      {/* Header Card */}
      <div className="bg-white border border-gray-200 p-6 rounded-2xl shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shadow-2xs">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black text-gray-900 uppercase tracking-tight">
                Integração Supabase (PostgreSQL & Realtime)
              </h2>
              {isConfigured ? (
                <span className="bg-emerald-100 text-emerald-800 text-[10px] font-black px-2 py-0.5 rounded-full flex items-center gap-1 border border-emerald-200">
                  <CheckCircle2 className="w-3 h-3" /> Configurado
                </span>
              ) : (
                <span className="bg-amber-100 text-amber-800 text-[10px] font-black px-2 py-0.5 rounded-full flex items-center gap-1 border border-amber-200">
                  <AlertTriangle className="w-3 h-3" /> Aguardando Variáveis
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Conecte seu banco de dados relacional Supabase com suporte a Realtime, tabelas relacionais e queries otimizadas.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={testing || !isConfigured}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${testing ? 'animate-spin' : ''}`} />
            <span>{testing ? 'Testando Conexão...' : 'Testar Conexão'}</span>
          </button>
        </div>
      </div>

      {/* Status da Conexão */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 p-5 rounded-2xl shadow-2xs space-y-2">
          <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
            <Server className="w-3.5 h-3.5 text-gray-500" />
            <span>URL do Projeto</span>
          </div>
          <div className="font-mono text-xs text-gray-800 break-all bg-gray-50 p-2 rounded-lg border border-gray-100">
            {config.url || 'Não configurada (VITE_SUPABASE_URL)'}
          </div>
        </div>

        <div className="bg-white border border-gray-200 p-5 rounded-2xl shadow-2xs space-y-2">
          <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-gray-500" />
            <span>Chave Anônima (Anon Key)</span>
          </div>
          <div className="font-mono text-xs text-gray-800 break-all bg-gray-50 p-2 rounded-lg border border-gray-100">
            {config.anonKey
              ? `${config.anonKey.substring(0, 12)}...${config.anonKey.substring(config.anonKey.length - 8)}`
              : 'Não configurada (VITE_SUPABASE_ANON_KEY)'}
          </div>
        </div>

        <div className="bg-white border border-gray-200 p-5 rounded-2xl shadow-2xs space-y-2">
          <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-gray-500" />
            <span>Latência & Resposta</span>
          </div>
          <div className="text-xs font-bold text-gray-800 bg-gray-50 p-2 rounded-lg border border-gray-100 flex items-center justify-between">
            <span>{testResult?.latencyMs ? `${testResult.latencyMs} ms` : isConfigured ? 'Pronto para teste' : 'Offline'}</span>
            {testResult?.connected && (
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            )}
          </div>
        </div>
      </div>

      {/* Resultado do Teste */}
      {testResult && (
        <div
          className={`p-4 rounded-xl border text-xs font-medium flex items-start gap-3 ${
            testResult.connected
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}
        >
          {testResult.connected ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          )}
          <div className="space-y-1">
            <div className="font-bold">
              {testResult.connected ? 'Status do Supabase: Operacional' : 'Atenção com a Conexão'}
            </div>
            <div>{testResult.message}</div>
          </div>
        </div>
      )}

      {/* Passo a Passo de Configuração */}
      <div className="bg-white border border-gray-200 p-6 rounded-2xl shadow-sm space-y-5">
        <div className="flex items-center justify-between border-b border-gray-100 pb-4">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-[#3483FA]" />
            <h3 className="text-sm font-black text-gray-800 uppercase tracking-tight">
              Passo a Passo para Ativar o Supabase
            </h3>
          </div>
          <button
            type="button"
            onClick={handleCopySql}
            className="px-3.5 py-1.5 bg-gray-900 hover:bg-black text-white text-xs font-bold rounded-xl transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
          >
            {copiedSql ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedSql ? 'SQL Copiado!' : 'Copiar Script SQL'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 space-y-2">
            <div className="w-6 h-6 rounded-full bg-[#3483FA] text-white flex items-center justify-center text-xs font-black">
              1
            </div>
            <h4 className="text-xs font-bold text-gray-900">Execute o Script SQL</h4>
            <p className="text-[11px] text-gray-600 leading-relaxed">
              No painel do Supabase, clique em <strong>SQL Editor</strong>, cole o script que você copiou acima e clique no botão <strong>Run</strong> para criar as tabelas (<code className="text-blue-600 font-mono">coleta_listas</code>, <code className="text-blue-600 font-mono">coleta_itens</code>, <code className="text-blue-600 font-mono">refugo_scans</code>, etc.).
            </p>
          </div>

          <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 space-y-2">
            <div className="w-6 h-6 rounded-full bg-[#3483FA] text-white flex items-center justify-center text-xs font-black">
              2
            </div>
            <h4 className="text-xs font-bold text-gray-900">Copie as Credenciais</h4>
            <p className="text-[11px] text-gray-600 leading-relaxed">
              No Supabase, acesse <strong>Project Settings &gt; API</strong> e copie o <strong>Project URL</strong> e a chave <strong>anon public</strong>.
            </p>
          </div>

          <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 space-y-2">
            <div className="w-6 h-6 rounded-full bg-[#3483FA] text-white flex items-center justify-center text-xs font-black">
              3
            </div>
            <h4 className="text-xs font-bold text-gray-900">Defina no Ambiente</h4>
            <p className="text-[11px] text-gray-600 leading-relaxed">
              Defina as variáveis <code className="text-blue-600 font-mono">VITE_SUPABASE_URL</code> e <code className="text-blue-600 font-mono">VITE_SUPABASE_ANON_KEY</code> nas configurações de ambiente do app. O app ativará o Supabase automaticamente!
            </p>
          </div>
        </div>

        {/* Prévia do Script SQL */}
        <div className="space-y-2 pt-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
              <Terminal className="w-4 h-4 text-gray-500" />
              <span>Esquema SQL (supabase_schema.sql)</span>
            </span>
            <span className="text-[10px] text-gray-400 font-mono">PostgreSQL 15+</span>
          </div>
          <pre className="bg-[#111827] text-gray-200 p-4 rounded-xl text-[11px] font-mono overflow-x-auto max-h-60 leading-relaxed border border-gray-800">
{`-- Tabelas geradas:
-- public.coleta_listas (listas de coleta e contadores)
-- public.coleta_itens (pacotes bipados com lista_id e índices)
-- public.refugo_scans (scans do controle de refugo)
-- public.coletor_data (base CSV de consulta e remoção)
-- public.refugo_data (base CSV de refugo)
-- public.app_users (gestão de operadores e aprovados)`}
          </pre>
        </div>
      </div>
    </div>
  );
};
