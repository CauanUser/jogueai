// Configuração lida das variáveis de ambiente no momento do build (Vite).
// Apenas a URL do projeto e a chave PUBLICÁVEL entram no app.
// A chave service_role NUNCA deve ser usada aqui.
const env = import.meta.env ?? {};

export const config = Object.freeze({
  supabaseUrl: (env.VITE_SUPABASE_URL ?? '').trim(),
  supabaseChave: (env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? '').trim(),
  timeoutMs: 15000,
  versao: '0.1.0',
});

export function supabaseConfigurado(c = config) {
  return /^https:\/\/[^\s]+$/.test(c.supabaseUrl) &&
    !c.supabaseUrl.includes('SEU-PROJETO') &&
    c.supabaseChave.length > 20 &&
    !c.supabaseChave.includes('xxxx');
}
