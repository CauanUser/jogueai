# JogueAI

**Times equilibrados. Jogos melhores.**

Aplicativo Android para organizar rachões de futebol amador: sessões por domingo, participantes com nota, sorteio equilibrado de times, partidas com cronômetro, gols e artilharia.

> **Estado atual — Fase 1:** estrutura do projeto, banco de dados completo com segurança (RLS), login do organizador, armazenamento local com sincronização, e as telas Início, Nova sessão, Participantes e Configurações. Sorteio, partidas, gols e artilharia chegam nas próximas fases.

---

## Arquitetura

```
Telas (src/pages) ──► Repositórios (src/repositories) ──► IndexedDB no aparelho
                                   │                         + fila de envio (outbox)
Regras puras (src/domain)          └──► Fila de sincronização ──► Supabase (PostgreSQL + RLS)
```

- **Local-first:** toda gravação acontece primeiro no aparelho (funciona sem internet). O registro e a operação de envio são salvos na mesma transação.
- **Sem duplicação:** os IDs (UUID) são criados no aparelho; o envio usa `upsert` por ID, então reenviar não duplica.
- **Sem perda silenciosa:** falhas de rede ficam na fila e são reenviadas com espera progressiva. Se o servidor recusar algo, a fila para naquele item e o organizador vê o motivo em **Configurações** (pode tentar de novo ou descartar explicitamente).
- **Placar e artilharia** não são armazenados: são calculados a partir dos gols (views no banco).

```
src/
  pages/         telas (inicio, novaSessao, participantes, configuracoes)
  components/    dom, diálogo, toast, seletor de nota, indicador de sincronização
  domain/        regras de negócio puras e testáveis
  repositories/  gravação local + enfileiramento
  services/      IndexedDB, fila, Supabase, autenticação, download do servidor
  utils/         ids, datas
  styles/
supabase/migrations/   SQL versionado
tests/                 domain/, data/ (Vitest) e db/ (SQL em PostgreSQL real)
android/               projeto nativo gerado pelo Capacitor
```

**Dependências:** `@supabase/supabase-js`, `@capacitor/core`, `@capacitor/android`, `@capacitor/app` · desenvolvimento: `vite`, `vitest`, `fake-indexeddb`, `@capacitor/cli`. Sem framework de interface.

---

## 1. Configurar o Supabase (plano gratuito)

1. Crie um projeto em <https://supabase.com> (plano Free).
2. **Banco:** abra *SQL Editor*, cole o conteúdo de `supabase/migrations/20261020000001_esquema_inicial.sql` e execute.
   (Ou, com a Supabase CLI: `supabase link` e `supabase db push`.)
3. **Conta do organizador:** *Authentication → Users → Add user → Create new user*, informe e-mail e senha e marque **Auto Confirm User**.
4. **Bloquear novos cadastros:** *Authentication → Sign In / Providers* → desative **Allow new users to sign up**. Assim ninguém mais consegue criar conta.
5. **Credenciais do app:** *Project Settings → API Keys*. Copie a **URL do projeto** e a **Publishable key** (`sb_publishable_...`; em projetos antigos, a chave `anon`).

> ⚠️ **Nunca** use a chave `service_role`/secret nem a senha do banco no aplicativo.
>
> ℹ️ Projetos gratuitos podem ser **pausados após um período sem uso** (verifique a política vigente no painel). Como o app grava primeiro no aparelho, nada se perde: reative o projeto no painel e a fila envia o que estiver pendente.

### Modelo de segurança

- Todas as tabelas têm **RLS** com políticas separadas de leitura, inserção, alteração e exclusão: cada linha só é acessível quando `owner_id = auth.uid()`.
- O papel `anon` não tem nenhum privilégio; a chave publicável sozinha não dá acesso a dados.
- O banco valida tudo novamente (notas 1–10, nomes, vínculos entre sessão/equipes/partidas, autor do gol, partida confirmada etc.).
- O aparelho fica **vinculado à primeira conta** que entrar, impedindo enviar dados locais para outra conta.
- Se usar domínio próprio no Supabase, adicione-o ao `connect-src` da Content-Security-Policy em `index.html`.

## 2. Rodar localmente

Requer **Node 22+**.

```bash
npm install
cp .env.example .env.local      # preencha URL e chave publicável
npm run dev                     # abre em http://localhost:5173
```

Sem `.env.local`, o app funciona normalmente, mas guarda os dados apenas no aparelho/navegador.

## 3. Testes

```bash
npm test          # regras de negócio, armazenamento local, fila, Supabase (simulado), autenticação
npm run test:db   # aplica as migrações em um PostgreSQL temporário e testa integridade e RLS
```

`test:db` requer os binários do PostgreSQL 15+ (`initdb`, `pg_ctl`, `psql`) instalados.

## 4. Gerar o APK

### Opção A — GitHub Actions (sem instalar nada)

A cada `push` na `main`, o workflow `.github/workflows/android-apk.yml` roda os testes e compila o APK.

1. No GitHub: *Settings → Secrets and variables → Actions → New repository secret*:
   `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`.
2. Faça um push (ou *Actions → Testes e APK → Run workflow*).
3. Baixe `jogueai-debug-apk` em *Actions → execução → Artifacts*, descompacte e instale o `app-debug.apk` no celular (permita "instalar apps desconhecidos").

### Opção B — No seu computador

Requer **JDK 21** e **Android Studio** (ou Android SDK com `ANDROID_HOME` configurado).

```bash
npm run android:sync          # build web + copia para o projeto Android
npm run android:apk           # gera android/app/build/outputs/apk/debug/app-debug.apk
npx cap open android          # opcional: abrir no Android Studio
```

### Versão de distribuição (release)

Será configurada na fase final (assinatura com keystore própria, que **não** deve ir para o repositório).

---

## Fases

| Fase | Conteúdo | Situação |
|---|---|---|
| 1 | Estrutura, banco + RLS, login, armazenamento local e sincronização, sessões e participantes | ✅ |
| 2 | Sorteio equilibrado + telas de sorteio e equipes/fila de espera | — |
| 3 | Configuração de partida, cronômetro, partida ao vivo | — |
| 4 | Gols, gol contra, correção, encerramento automático, pênaltis, confirmação | — |
| 5 | Artilharia, histórico, detalhes da sessão, correção de partidas antigas | — |
| 6 | Robustez offline, configurações, APK assinado, documentação final | — |
