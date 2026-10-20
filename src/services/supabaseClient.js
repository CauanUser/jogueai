import { createClient } from '@supabase/supabase-js';
import { config, supabaseConfigurado } from './config.js';

/** Retorna o cliente Supabase, ou null se o projeto não estiver configurado. */
export function criarClienteSupabase(c = config) {
  if (!supabaseConfigurado(c)) return null;
  return createClient(c.supabaseUrl, c.supabaseChave, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: 'jogueai-auth',
    },
  });
}
