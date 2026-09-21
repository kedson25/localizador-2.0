-- =========================================================================
-- ESQUEMA DO SUPABASE - LOCALIZADOR 2.0 (COLETA & REFUGO)
-- Cole este script no SQL Editor do seu projeto Supabase e clique em RUN
-- =========================================================================

-- 1. TABELA DE USUÁRIOS DO APLICATIVO
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

-- 2. TABELA DE DADOS DO COLETOR CSV
CREATE TABLE IF NOT EXISTS public.coletor_data (
  id TEXT PRIMARY KEY,
  raw_text TEXT NOT NULL,
  total_rows INTEGER DEFAULT 0,
  file_name TEXT DEFAULT 'relatorio.csv',
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. TABELA DE DADOS DO REFUGO CSV
CREATE TABLE IF NOT EXISTS public.refugo_data (
  id TEXT PRIMARY KEY,
  raw_text TEXT NOT NULL,
  total_rows INTEGER DEFAULT 0,
  file_name TEXT DEFAULT 'refugo.csv',
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. TABELA DE SCANS DO REFUGO
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

-- 5. TABELA DE LISTAS DE COLETA
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

-- 6. TABELA DE ITENS BIPADOS DA COLETA
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

-- 7. ATIVAR REALTIME NAS TABELAS PRINCIPAIS
ALTER PUBLICATION supabase_realtime ADD TABLE public.coleta_listas;
ALTER PUBLICATION supabase_realtime ADD TABLE public.coleta_itens;
ALTER PUBLICATION supabase_realtime ADD TABLE public.refugo_scans;

-- 8. POLÍTICAS DE ACESSO (Row Level Security - RLS)
-- Permite leitura e escrita pelo frontend autenticado e chaves anônimas
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
CREATE POLICY "Permitir tudo coleta_itens" ON public.coleta_itens FOR ALL USING (true) WITH CHECK (true);

-- 9. GATILHOS PARA ATUALIZAÇÃO AUTOMÁTICA DE updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at_listas ON public.coleta_listas;
CREATE TRIGGER set_updated_at_listas
BEFORE UPDATE ON public.coleta_listas
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_itens ON public.coleta_itens;
CREATE TRIGGER set_updated_at_itens
BEFORE UPDATE ON public.coleta_itens
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Concluído! O banco está pronto para uso com o Localizador 2.0 / Coleta & Refugo.
