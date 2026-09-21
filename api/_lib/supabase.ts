import { createClient, SupabaseClient } from '@supabase/supabase-js';

let serverSupabaseInstance: SupabaseClient | null = null;

export function getServerSupabase(): SupabaseClient | null {
  if (serverSupabaseInstance) return serverSupabaseInstance;

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY;

  if (!url || !key || !url.startsWith('http')) {
    return null;
  }

  try {
    serverSupabaseInstance = createClient(url, key, {
      auth: {
        persistSession: false,
      },
    });
    return serverSupabaseInstance;
  } catch (error) {
    console.error('[Supabase Server] Erro ao instanciar client:', error);
    return null;
  }
}

export function isServerSupabaseActive(): boolean {
  return getServerSupabase() !== null;
}
