import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ColetaItem, ColetaLista } from '../types';

let supabaseInstance: SupabaseClient | null = null;

export function getSupabaseConfig(): { url: string; anonKey: string } {
  const url = (import.meta as any).env?.VITE_SUPABASE_URL || '';
  const anonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';
  return { url: url.trim(), anonKey: anonKey.trim() };
}

export function isSupabaseConfigured(): boolean {
  const { url, anonKey } = getSupabaseConfig();
  return Boolean(url && anonKey && url.startsWith('http') && anonKey.length > 10);
}

/**
 * Lazy initialization of Supabase client to prevent application crash
 * if environment variables are not yet populated.
 */
export function getSupabase(): SupabaseClient | null {
  if (supabaseInstance) return supabaseInstance;

  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey || !url.startsWith('http')) {
    return null;
  }

  try {
    supabaseInstance = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    });
    return supabaseInstance;
  } catch (error) {
    console.error('[Supabase] Erro ao inicializar cliente:', error);
    return null;
  }
}

/**
 * Test connectivity to Supabase and check if core tables exist.
 */
export async function testSupabaseConnection(): Promise<{
  connected: boolean;
  message: string;
  tablesFound?: string[];
  latencyMs?: number;
}> {
  const client = getSupabase();
  if (!client) {
    return {
      connected: false,
      message: 'Supabase não configurado. Adicione VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY nas configurações.',
    };
  }

  const start = performance.now();
  try {
    // Tenta uma consulta simples na tabela de listas ou coletor
    const { error, data } = await client.from('coleta_listas').select('id').limit(1);
    const latencyMs = Math.round(performance.now() - start);

    if (error) {
      if (error.code === '42P01') {
        // Tabela não existe ainda
        return {
          connected: true,
          message: 'Conectado ao Supabase com sucesso! Porém as tabelas ainda não foram criadas. Execute o script supabase_schema.sql no SQL Editor do Supabase.',
          latencyMs,
        };
      }
      return {
        connected: false,
        message: `Erro na resposta do Supabase: ${error.message} (${error.code || 'sem código'})`,
        latencyMs,
      };
    }

    return {
      connected: true,
      message: 'Conexão com o Supabase ativa e respondendo perfeitamente!',
      tablesFound: ['coleta_listas'],
      latencyMs,
    };
  } catch (err: any) {
    return {
      connected: false,
      message: `Falha na conexão com o Supabase: ${err?.message || 'Erro desconhecido'}`,
    };
  }
}

/* ========================================================
   1. COLETOR & REFUGO CSV NO SUPABASE
   ======================================================== */

export async function supabaseSaveColetorCsv(rawText: string, totalRows: number, fileName?: string): Promise<boolean> {
  const client = getSupabase();
  if (!client) return false;

  try {
    const { error } = await client
      .from('coletor_data')
      .upsert({
        id: 'current_csv',
        raw_text: rawText,
        total_rows: totalRows,
        file_name: fileName || 'relatorio.csv',
        updated_at: new Date().toISOString(),
      });

    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Supabase] Erro ao salvar Coletor CSV:', err);
    return false;
  }
}

export async function supabaseLoadColetorCsv(): Promise<{ rawText: string; totalRows: number; fileName?: string } | null> {
  const client = getSupabase();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from('coletor_data')
      .select('raw_text, total_rows, file_name')
      .eq('id', 'current_csv')
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return {
      rawText: data.raw_text,
      totalRows: data.total_rows,
      fileName: data.file_name,
    };
  } catch (err) {
    console.warn('[Supabase] Erro ao carregar Coletor CSV:', err);
    return null;
  }
}

export async function supabaseSaveRefugoCsv(rawText: string, totalRows: number, fileName?: string): Promise<boolean> {
  const client = getSupabase();
  if (!client) return false;

  try {
    const { error } = await client
      .from('refugo_data')
      .upsert({
        id: 'current_refugo_csv',
        raw_text: rawText,
        total_rows: totalRows,
        file_name: fileName || 'refugo.csv',
        updated_at: new Date().toISOString(),
      });

    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Supabase] Erro ao salvar Refugo CSV:', err);
    return false;
  }
}

export async function supabaseLoadRefugoCsv(): Promise<{ rawText: string; totalRows: number; fileName?: string } | null> {
  const client = getSupabase();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from('refugo_data')
      .select('raw_text, total_rows, file_name')
      .eq('id', 'current_refugo_csv')
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return {
      rawText: data.raw_text,
      totalRows: data.total_rows,
      fileName: data.file_name,
    };
  } catch (err) {
    console.warn('[Supabase] Erro ao carregar Refugo CSV:', err);
    return null;
  }
}

/* ========================================================
   2. REFUGO SCANS NO SUPABASE
   ======================================================== */

export async function supabaseAddRefugoScan(scan: {
  id: string;
  normalizedId: string;
  rota: string;
  scannedAt: string;
  timestamp: number;
  status: 'found' | 'not_found';
  foundBy?: string;
}): Promise<boolean> {
  const client = getSupabase();
  if (!client) return false;

  try {
    const { error } = await client
      .from('refugo_scans')
      .upsert({
        id: scan.normalizedId,
        normalized_id: scan.normalizedId,
        rota: scan.rota,
        scanned_at: scan.scannedAt,
        timestamp: scan.timestamp,
        status: scan.status,
        found_by: scan.foundBy || null,
        created_at: new Date(scan.timestamp).toISOString(),
      });

    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Supabase] Erro ao inserir Refugo Scan:', err);
    return false;
  }
}

export async function supabaseGetRefugoScans(): Promise<any[]> {
  const client = getSupabase();
  if (!client) return [];

  try {
    const { data, error } = await client
      .from('refugo_scans')
      .select('*')
      .order('timestamp', { ascending: false });

    if (error) throw error;
    return (data || []).map((row) => ({
      id: row.id,
      normalizedId: row.normalized_id || row.id,
      rota: row.rota,
      scannedAt: row.scanned_at,
      timestamp: row.timestamp || new Date(row.created_at).getTime(),
      status: row.status,
      foundBy: row.found_by,
    }));
  } catch (err) {
    console.warn('[Supabase] Erro ao buscar scans de refugo:', err);
    return [];
  }
}

export async function supabaseClearRefugoScans(): Promise<boolean> {
  const client = getSupabase();
  if (!client) return false;

  try {
    const { error } = await client.from('refugo_scans').delete().neq('id', '___non_existent___');
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Supabase] Erro ao limpar scans de refugo:', err);
    return false;
  }
}

/* ========================================================
   3. COLETA LISTAS NO SUPABASE
   ======================================================== */

export async function supabaseGetListas(): Promise<ColetaLista[]> {
  const client = getSupabase();
  if (!client) return [];

  try {
    const { data, error } = await client
      .from('coleta_listas')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return (data || []).map((row) => ({
      id: row.id,
      nome: row.nome,
      tipo: row.tipo || 'comum',
      grupos: row.grupos || [],
      grupoAtivoId: row.grupo_ativo_id,
      rota: row.rota || '',
      data: row.data || '',
      saida: row.saida,
      responsavel: row.responsavel || '',
      status: row.status || 'em_andamento',
      saidaPadrao: row.saida_padrao || 'Ciclo 2 - Saída PM',
      motivoPadrao: row.motivo_padrao || 'Pendente',
      totalItens: row.total_itens || 0,
      totalValidados: row.total_validados || 0,
      saidasCount: row.saidas_count || {},
      motivosCount: row.motivos_count || {},
      rotasCount: row.rotas_count || {},
      bipsPorOperador: row.bips_por_operador || {},
      itens: [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  } catch (err) {
    console.warn('[Supabase] Erro ao buscar listas:', err);
    return [];
  }
}

export async function supabaseSaveLista(lista: Partial<ColetaLista> & { id: string }): Promise<boolean> {
  const client = getSupabase();
  if (!client) return false;

  try {
    const payload: Record<string, any> = {
      id: lista.id,
      nome: lista.nome,
      tipo: lista.tipo,
      grupos: lista.grupos,
      grupo_ativo_id: lista.grupoAtivoId,
      rota: lista.rota,
      data: lista.data,
      saida: lista.saida,
      responsavel: lista.responsavel,
      status: lista.status,
      saida_padrao: lista.saidaPadrao,
      motivo_padrao: lista.motivoPadrao,
      total_itens: lista.totalItens,
      total_validados: lista.totalValidados,
      saidas_count: lista.saidasCount,
      motivos_count: lista.motivosCount,
      rotas_count: lista.rotasCount,
      bips_por_operador: lista.bipsPorOperador,
      updated_at: new Date().toISOString(),
    };

    const { error } = await client.from('coleta_listas').upsert(payload);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Supabase] Erro ao salvar lista:', err);
    return false;
  }
}

export async function supabaseDeleteLista(listaId: string): Promise<boolean> {
  const client = getSupabase();
  if (!client) return false;

  try {
    // Itens são deletados automaticamente por ON DELETE CASCADE
    const { error } = await client.from('coleta_listas').delete().eq('id', listaId);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Supabase] Erro ao excluir lista:', err);
    return false;
  }
}

/* ========================================================
   4. COLETA ITENS NO SUPABASE
   ======================================================== */

export async function supabaseGetListaItens(listaId: string, limit = 5000): Promise<ColetaItem[]> {
  const client = getSupabase();
  if (!client) return [];

  try {
    const { data, error } = await client
      .from('coleta_itens')
      .select('*')
      .eq('lista_id', listaId)
      .order('timestamp', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return (data || []).map((row) => ({
      id: row.id,
      codigo: row.codigo,
      codigoClean: row.codigo_clean,
      rota: row.rota || 'Sem Rota',
      saida: row.saida || 'Ciclo 2 - Saída PM',
      motivo: row.motivo || 'Pendente',
      scannedAt: row.scanned_at || new Date().toLocaleString('pt-BR'),
      responsavel: row.responsavel || 'Operador',
      grupoId: row.grupo_id,
      validado: Boolean(row.validado),
      timestamp: row.timestamp || new Date(row.created_at).getTime(),
    }));
  } catch (err) {
    console.error('[Supabase] Erro ao buscar itens da lista:', err);
    return [];
  }
}

export async function supabaseAddColetaItem(listaId: string, item: ColetaItem): Promise<boolean> {
  const client = getSupabase();
  if (!client) return false;

  try {
    const { error } = await client.from('coleta_itens').upsert({
      id: item.id,
      lista_id: listaId,
      codigo: item.codigo,
      codigo_clean: item.codigoClean || item.codigo.replace(/\D/g, ''),
      rota: item.rota || 'Sem Rota',
      saida: item.saida || 'Ciclo 2 - Saída PM',
      motivo: item.motivo || 'Pendente',
      scanned_at: item.scannedAt || new Date().toLocaleString('pt-BR'),
      responsavel: item.responsavel || 'Operador',
      grupo_id: item.grupoId || null,
      validado: Boolean(item.validado),
      timestamp: item.timestamp || Date.now(),
    });

    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Supabase] Erro ao adicionar item:', err);
    return false;
  }
}

export async function supabaseDeleteColetaItem(listaId: string, itemId: string): Promise<boolean> {
  const client = getSupabase();
  if (!client) return false;

  try {
    const { error } = await client
      .from('coleta_itens')
      .delete()
      .eq('lista_id', listaId)
      .eq('id', itemId);

    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Supabase] Erro ao deletar item:', err);
    return false;
  }
}

/* ========================================================
   5. REALTIME SUBSCRIPTIONS
   ======================================================== */

export function supabaseListenToListas(callback: (listas: ColetaLista[]) => void): () => void {
  const client = getSupabase();
  if (!client) return () => {};

  // Carga inicial
  supabaseGetListas().then(callback);

  const channel = client
    .channel('realtime:coleta_listas')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'coleta_listas' },
      () => {
        supabaseGetListas().then(callback);
      }
    )
    .subscribe();

  return () => {
    client.removeChannel(channel);
  };
}

export function supabaseListenToRefugoScans(callback: (scans: any[]) => void): () => void {
  const client = getSupabase();
  if (!client) return () => {};

  // Carga inicial
  supabaseGetRefugoScans().then(callback);

  const channel = client
    .channel('realtime:refugo_scans')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'refugo_scans' },
      () => {
        supabaseGetRefugoScans().then(callback);
      }
    )
    .subscribe();

  return () => {
    client.removeChannel(channel);
  };
}
