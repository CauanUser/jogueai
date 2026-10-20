// Autenticação do organizador (Supabase Auth, e-mail e senha).
// O aparelho fica vinculado à primeira conta que entrar: isso impede que
// dados locais sejam enviados para a conta de outra pessoa.

const META_DONO = 'dono_id';

export function traduzirErroAuth(error) {
  const m = (error?.message ?? '').toLowerCase();
  if (m.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (m.includes('email not confirmed')) return 'E-mail ainda não confirmado. Confirme pelo link enviado ou no painel do Supabase.';
  if (m.includes('fetch') || m.includes('network')) return 'Sem conexão. Verifique a internet e tente de novo.';
  if (m.includes('rate limit')) return 'Muitas tentativas. Aguarde alguns minutos.';
  return error?.message || 'Não foi possível entrar.';
}

export function criarAuth({ client, store }) {
  let usuario = null;
  let donoId = null;
  const ouvintes = new Set();
  const emitir = () => ouvintes.forEach((fn) => fn({ usuario, vinculado: vinculado() }));
  const vinculado = () => Boolean(usuario && donoId && usuario.id === donoId);

  return {
    async iniciar() {
      donoId = await store.obterMeta(META_DONO);
      if (!client) return;
      const { data } = await client.auth.getSession();
      usuario = data?.session?.user ?? null;
      if (usuario && !donoId) {
        donoId = usuario.id;
        await store.definirMeta(META_DONO, donoId);
      }
      client.auth.onAuthStateChange((_evento, sessao) => {
        usuario = sessao?.user ?? null;
        emitir();
      });
    },

    async entrar(email, senha) {
      if (!client) throw new Error('Supabase não configurado neste aplicativo.');
      const e = String(email ?? '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error('Informe um e-mail válido.');
      if (!senha) throw new Error('Informe a senha.');
      const { data, error } = await client.auth.signInWithPassword({ email: e, password: senha });
      if (error) throw new Error(traduzirErroAuth(error));
      const u = data.user;
      if (donoId && donoId !== u.id) {
        await client.auth.signOut();
        throw new Error('Este aparelho já está vinculado a outra conta de organizador. Entre com a conta original.');
      }
      if (!donoId) {
        donoId = u.id;
        await store.definirMeta(META_DONO, donoId);
      }
      usuario = u;
      emitir();
      return u;
    },

    async sair() {
      if (client) await client.auth.signOut();
      usuario = null;
      emitir();
    },

    usuario: () => usuario,
    vinculado,
    assinar(fn) {
      ouvintes.add(fn);
      return () => ouvintes.delete(fn);
    },
  };
}
