# Movie Roulette

PWA mobile-first para escolher filmes em grupo no estilo roleta — cada jogador sugere 3 filmes, um é sorteado, todo mundo avalia, quem sugeriu boa coisa ganha pontos.

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind v4 · Firebase Auth + RTDB · TMDB · PWA via `@ducanh2912/next-pwa`.

## Setup local

1. **Firebase**
   - Crie um projeto em https://console.firebase.google.com
   - Ative **Authentication → Google** como provider
   - Ative **Realtime Database** (não Firestore)
   - **Aplique as rules:** abra Console → Realtime Database → aba **Rules**, cole o conteúdo de [`database.rules.json`](./database.rules.json) e clique em **Publish**. Sem isso o app dá `PERMISSION_DENIED` no primeiro login.
   - Copie a config web (`projectSettings → SDK setup → Config`)

2. **TMDB**
   - Pegue uma API key em https://www.themoviedb.org/settings/api

3. **Env**
   ```bash
   cp .env.local.example .env.local
   # preencha as variáveis
   ```

4. **Dev**
   ```bash
   npm run dev
   ```
   PWA fica **desabilitado em dev** por design — para testar o service worker rode `npm run build && npm start`.

## Estado da implementação

Veja [`docs/STATUS.md`](docs/STATUS.md) para o que está pronto e o que vem em seguida.

## TODO de assets

- Gerar PNG 192×192 e 512×512 a partir de `public/icons/icon.svg` (necessário para install no iOS). Sugestão: `npx pwa-asset-generator public/icons/icon.svg public/icons` ou ferramenta equivalente.
