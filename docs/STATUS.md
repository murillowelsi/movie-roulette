# Estado da implementação

Checklist espelhando a "Ordem de implementação sugerida" do spec.

## ✅ Passo 1 — Setup + Auth (entregue)

- [x] Next.js 16 (App Router) + TS + Tailwind v4
- [x] Firebase Web SDK (Auth + RTDB) — `lib/firebase.ts`
- [x] AuthProvider com Google sign-in / sign-out — `lib/auth-context.tsx`
- [x] Mirror do usuário em `/users/{uid}` (displayName, photoURL, lastSeenAt)
- [x] Landing/login `app/page.tsx`
- [x] Home shell com botões "Criar sala" + "Entrar com código" (lógica stubada)
- [x] Componentes UI base hand-rolled estilo shadcn (Button, Input, Card)
- [x] PWA manifest + next-pwa configurado (excluindo Firebase do cache)

## ✅ Passo 2 — Criar/entrar em sala + lobby (entregue)

- [x] Gerador de inviteCode (6 chars, alfabeto sem ambiguidade) + node `/invites/{code} → roomId` — `lib/rooms.ts`
- [x] `createRoom()` cria `/rooms/{id}` e adiciona owner como primeiro player
- [x] `joinRoom(code)` resolve invite, valida limite (2–8), adiciona player
- [x] `app/room/[id]/page.tsx` — lobby com listener em `players`, toggle `ready` (guests-only), código copiável, botão Start do host (host implicitamente pronto)
- [ ] `onDisconnect()` marca player como `connected: false` sem remover

## ✅ Passo 3 — Integração TMDB + tela de seleção (entregue)

- [x] Route handler `/api/tmdb/search?q=...` (cache em memória LRU — 200 entries / TTL 1h)
- [x] `app/room/[id]/select/page.tsx` — busca com debounce 300ms + AbortController, 3 slots, indicador "X/Y prontos"
- [x] Permite duplicatas entre jogadores (warning amarelo "Outro jogador já escolheu")
- [x] Transição `selecting → drawn` quando todos têm 3 filmes (owner clica "Sortear")

## ✅ Passo 4 — Sorteio + rating + pontos (entregue)

- [x] Sorteio com `seed` registrado em `rounds/{r}/draw` (audit trail) — owner-driven
- [x] `app/room/[id]/reveal/page.tsx` — poster grande + sugeridor + botão "Começar avaliação" (host)
- [x] `app/room/[id]/rate/page.tsx` — slider 1-10, sugeridor exclui-se da votação (tela de espera)
- [x] Cálculo: `pointsForSuggester = round((avg - 5.5) * 10)` + `+2` por avaliar
- [x] Persistir `scoresAwarded` + `avg` por rodada, `score` agregado em `players/{uid}`

## ✅ Passo 5 — Leaderboard + nova rodada + stats (entregue)

- [x] `app/room/[id]/results/page.tsx` — leaderboard ordenado por score, destaque do player atual, troféu/coroa no top
- [x] Owner clica "Nova rodada" → `currentRound++` + status `selecting` (selections viram em rodada nova)
- [x] Owner clica "Encerrar partida" → `rooms/{id}/gameOver = true`
- [x] Cada cliente grava `users/{uid}.totalGamesPlayed` / `totalScore` quando detecta `gameOver` (guard via `users/{uid}/playedRooms/{roomId}` evita double-count)

## 🟡 Passo 6 — PWA polimento

- [x] Manifest + service worker
- [ ] PNG icons 192/512 (gerar a partir do SVG)
- [ ] Splash screens iOS
- [ ] Teste de install em mobile real

## 🟡 Passo 7 — Security rules + edge cases

- [x] `database.rules.json` criado — usuário precisa aplicar no Console (ver README)
- [ ] Teste: jogador sai no meio (timeout 30s antes de excluir do gating)
- [ ] Teste: owner sai → transferir ownership pro próximo
- [ ] Teste: race no "todos prontos" — só owner dispara transição
- [ ] Teste: múltiplas abas

## Decisões fixadas (do spec)

- Limite jogadores: **2–8**
- Rodadas: **livre** (owner decide "Nova rodada" indefinidamente)
- Quem sugeriu o filme **não vota** nele
- Salas após `finished` são **persistidas** (não deletadas)
- Idioma: **PT-BR** primeiro, EN depois
- Deploy: **Vercel**
- Sorteio: **owner-driven com seed visível** no RTDB
