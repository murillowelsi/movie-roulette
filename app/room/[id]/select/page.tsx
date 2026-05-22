"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { onValue, ref, update } from "firebase/database";
import { AlertTriangle, Check, Dice5, Loader2, LogOut, Search, UserMinus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";
import { firebaseDb } from "@/lib/firebase";
import {
  clearSelection,
  drawMovie,
  kickPlayer,
  leaveRoom,
  setSelection,
  SELECTIONS_PER_PLAYER,
  type SelectedMovie,
} from "@/lib/rooms";
import { tmdbPosterUrl, type TmdbSearchResult } from "@/lib/tmdb-client";

type Player = {
  displayName?: string;
  photoURL?: string;
  ready?: boolean;
};

type DrawData = {
  suggesterId: string;
  movie: SelectedMovie;
};

type RoomSnapshot = {
  ownerId: string;
  inviteCode: string;
  status: "lobby" | "selecting" | "drawn" | "rating" | "finished";
  currentRound: number;
  players?: Record<string, Player>;
  rounds?: Record<
    string,
    {
      selections?: Record<string, Record<string, SelectedMovie>>;
      draw?: DrawData;
    }
  >;
};

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

export default function SelectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: roomId } = use(params);
  const { user, loading } = useAuth();
  const router = useRouter();
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TmdbSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [kickingUid, setKickingUid] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    const unsub = onValue(
      ref(firebaseDb(), `rooms/${roomId}`),
      (snap) => {
        const value = snap.val() as RoomSnapshot | null;
        if (!value) {
          setError("Sala não encontrada.");
          setRoom(null);
          return;
        }
        if (!leaving && value.players && !value.players[user.uid]) {
          router.replace("/home?kicked=1");
          return;
        }
        setError(null);
        setRoom(value);
      },
      (err) => {
        console.error("[select] listener", err);
        setError("Sem permissão para acessar esta sala.");
      }
    );
    return () => unsub();
  }, [roomId, user, leaving, router]);

  useEffect(() => {
    if (!room || leaving) return;
    if (room.status === "lobby") router.replace(`/room/${roomId}`);
    if (room.status === "drawn" || room.status === "rating" || room.status === "finished") {
      router.replace(`/room/${roomId}/reveal`);
    }
  }, [room?.status, roomId, router, room, leaving]);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      abortRef.current?.abort();
      const ctl = new AbortController();
      abortRef.current = ctl;
      try {
        const res = await fetch(`/api/tmdb/search?q=${encodeURIComponent(trimmed)}`, {
          signal: ctl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { results?: TmdbSearchResult[] };
        setResults(data.results ?? []);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        console.error("[select] search failed", err);
        setError("Falha ao buscar filmes.");
      } finally {
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  const currentRound = room?.currentRound ?? 0;
  const selectionsByPlayer = useMemo(
    () => (room?.rounds?.[String(currentRound)]?.selections ?? {}) as Record<
      string,
      Record<string, SelectedMovie>
    >,
    [room, currentRound]
  );
  const mySlots: (SelectedMovie | undefined)[] = useMemo(() => {
    if (!user) return [];
    const mine = selectionsByPlayer[user.uid] ?? {};
    return Array.from({ length: SELECTIONS_PER_PLAYER }, (_, i) => mine[String(i)]);
  }, [selectionsByPlayer, user]);

  const myPickIds = useMemo(
    () => new Set(mySlots.filter(Boolean).map((m) => m!.tmdbId)),
    [mySlots]
  );
  const othersPickIds = useMemo(() => {
    const set = new Set<number>();
    for (const [uid, slots] of Object.entries(selectionsByPlayer)) {
      if (uid === user?.uid) continue;
      for (const m of Object.values(slots)) {
        if (m && typeof m.tmdbId === "number") set.add(m.tmdbId);
      }
    }
    return set;
  }, [selectionsByPlayer, user]);

  const players = room?.players ?? {};
  const playerIds = Object.keys(players);
  const me = user ? players[user.uid] : undefined;
  const myReady = !!me?.ready;
  const readyCount = playerIds.filter((uid) => players[uid]?.ready).length;
  const allReady = playerIds.length > 0 && readyCount === playerIds.length;
  const isOwner = room?.ownerId === user?.uid;
  const mySlotsFull = mySlots.every(Boolean);

  if (loading || !user) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!room && !error) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  const pickMovie = async (m: TmdbSearchResult) => {
    if (!room || actionBusy || myReady) return;
    if (myPickIds.has(m.tmdbId)) return;
    const firstEmpty = mySlots.findIndex((slot) => !slot);
    if (firstEmpty === -1) return;
    setActionBusy(true);
    try {
      await setSelection(user, roomId, currentRound, firstEmpty, {
        tmdbId: m.tmdbId,
        title: m.title,
        posterPath: m.posterPath,
        releaseYear: m.releaseYear,
      });
    } catch (err) {
      console.error("[select] setSelection failed", err);
      setError("Falha ao salvar filme.");
    } finally {
      setActionBusy(false);
    }
  };

  const removeSlot = async (slot: number) => {
    if (actionBusy || myReady) return;
    setActionBusy(true);
    try {
      await clearSelection(user, roomId, currentRound, slot);
    } catch (err) {
      console.error("[select] clearSelection failed", err);
      setError("Falha ao remover filme.");
    } finally {
      setActionBusy(false);
    }
  };

  const toggleReady = async () => {
    if (!user || actionBusy) return;
    if (!myReady && !mySlotsFull) return;
    setActionBusy(true);
    try {
      await update(ref(firebaseDb(), `rooms/${roomId}/players/${user.uid}`), {
        ready: !myReady,
      });
    } catch (err) {
      console.error("[select] toggleReady failed", err);
      setError("Falha ao confirmar.");
    } finally {
      setActionBusy(false);
    }
  };

  const onLeave = async () => {
    if (!user || actionBusy) return;
    setLeaving(true);
    setActionBusy(true);
    try {
      await leaveRoom(user, roomId);
    } catch (err) {
      console.error("[select] leaveRoom failed", err);
    }
    router.push("/home");
  };

  const onKick = async (targetUid: string, targetName: string) => {
    if (actionBusy) return;
    const ok = window.confirm(`Expulsar ${targetName} da sala?`);
    if (!ok) return;
    setKickingUid(targetUid);
    setActionBusy(true);
    try {
      await kickPlayer(roomId, targetUid);
    } catch (err) {
      console.error("[select] kickPlayer failed", err);
      setError("Falha ao expulsar jogador.");
    } finally {
      setActionBusy(false);
      setKickingUid(null);
    }
  };

  const onDraw = async () => {
    if (!isOwner || !allReady || actionBusy) return;
    setActionBusy(true);
    try {
      await drawMovie(roomId, currentRound);
    } catch (err) {
      console.error("[select] drawMovie failed", err);
      setError(err instanceof Error ? err.message : "Falha ao sortear.");
      setActionBusy(false);
    }
  };

  return (
    <main className="flex flex-1 flex-col px-6 pt-4 pb-0">
      <header className="flex items-center justify-between pb-3">
        <h1 className="text-lg font-semibold">Escolha 3 filmes</h1>
        <Button
          variant="ghost"
          size="icon"
          onClick={onLeave}
          disabled={actionBusy}
          aria-label="Sair da sala"
        >
          {leaving ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogOut className="h-5 w-5" />}
        </Button>
      </header>

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-3">
        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="grid grid-cols-3 gap-3">
          {mySlots.map((slot, i) => (
            <div key={i} className="aspect-[2/3] overflow-hidden rounded-md border border-border bg-secondary">
              {slot ? (
                <button
                  type="button"
                  className="group relative h-full w-full"
                  onClick={() => removeSlot(i)}
                  disabled={actionBusy}
                  aria-label={`Remover ${slot.title}`}
                >
                  {slot.posterPath ? (
                    <img
                      src={tmdbPosterUrl(slot.posterPath, "w342") ?? ""}
                      alt={slot.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs">
                      {slot.title}
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-0 flex items-start justify-end bg-black/0 p-1 opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100">
                    <X className="h-5 w-5 text-white drop-shadow" />
                  </div>
                </button>
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                  {i + 1}
                </div>
              )}
            </div>
          ))}
        </div>

        <Card>
          <CardContent className="p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar filme…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9 pr-9"
                disabled={myReady}
              />
              {searching ? (
                <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              ) : query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Limpar busca"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>

            <div className="mt-3 max-h-[35vh] space-y-2 overflow-y-auto">
              {results.length === 0 && !searching && query.trim().length >= MIN_QUERY_LENGTH ? (
                <p className="px-1 py-4 text-center text-sm text-muted-foreground">
                  Nada encontrado.
                </p>
              ) : null}
              {results.map((m) => {
                const alreadyPicked = myPickIds.has(m.tmdbId);
                const duplicate = othersPickIds.has(m.tmdbId);
                const slotsFull = mySlots.every(Boolean);
                const disabled = actionBusy || alreadyPicked || (slotsFull && !alreadyPicked);
                return (
                  <button
                    key={m.tmdbId}
                    type="button"
                    onClick={() => pickMovie(m)}
                    disabled={disabled}
                    className="flex w-full items-center gap-3 rounded-md border border-border bg-card p-2 text-left transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <div className="h-16 w-12 flex-shrink-0 overflow-hidden rounded bg-secondary">
                      {m.posterPath ? (
                        <img
                          src={tmdbPosterUrl(m.posterPath, "w185") ?? ""}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </div>
                    <div className="flex flex-1 flex-col leading-tight">
                      <p className="text-sm font-medium">
                        {m.title}
                        {m.releaseYear ? (
                          <span className="ml-1 text-xs text-muted-foreground">({m.releaseYear})</span>
                        ) : null}
                      </p>
                      {duplicate ? (
                        <span className="mt-1 inline-flex items-center gap-1 self-start rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="h-3 w-3" />
                          Outro jogador já escolheu
                        </span>
                      ) : null}
                    </div>
                    {alreadyPicked ? (
                      <Check className="h-5 w-5 text-primary" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {playerIds.filter((uid) => uid !== user.uid).length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>O que a galera está escolhendo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {playerIds
                .filter((uid) => uid !== user.uid)
                .map((uid) => {
                  const player = players[uid];
                  const slots = selectionsByPlayer[uid] ?? {};
                  const slotList = Array.from(
                    { length: SELECTIONS_PER_PLAYER },
                    (_, i) => slots[String(i)]
                  );
                  const picked = slotList.filter(Boolean).length;
                  const playerReady = !!player.ready;
                  return (
                    <div key={uid}>
                      <div className="flex items-center gap-2 pb-2">
                        {player.photoURL ? (
                          <img
                            src={player.photoURL}
                            alt=""
                            className="h-7 w-7 rounded-full border border-border"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="h-7 w-7 rounded-full bg-secondary" />
                        )}
                        <p className="flex-1 text-sm font-medium leading-tight">
                          {player.displayName ?? "Anônimo"}
                          {uid === room?.ownerId ? (
                            <span className="ml-1 text-xs text-muted-foreground">(host)</span>
                          ) : null}
                        </p>
                        <span
                          className={
                            playerReady
                              ? "inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary"
                              : "inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground"
                          }
                        >
                          {playerReady ? (
                            <>
                              <Check className="h-3 w-3" />
                              Pronto
                            </>
                          ) : (
                            `${picked}/${SELECTIONS_PER_PLAYER}`
                          )}
                        </span>
                        {isOwner && uid !== room?.ownerId ? (
                          <button
                            type="button"
                            onClick={() => onKick(uid, player.displayName ?? "este jogador")}
                            disabled={actionBusy}
                            aria-label={`Expulsar ${player.displayName ?? "jogador"}`}
                            className="rounded-md p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {kickingUid === uid ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <UserMinus className="h-4 w-4" />
                            )}
                          </button>
                        ) : null}
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {slotList.map((movie, i) => (
                          <div
                            key={i}
                            className="aspect-[2/3] overflow-hidden rounded-md border border-border bg-secondary"
                            title={movie?.title}
                          >
                            {movie?.posterPath ? (
                              <img
                                src={tmdbPosterUrl(movie.posterPath, "w185") ?? ""}
                                alt={movie.title}
                                className="h-full w-full object-cover"
                              />
                            ) : movie ? (
                              <div className="flex h-full w-full items-center justify-center p-1 text-center text-[10px] leading-tight">
                                {movie.title}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
            </CardContent>
          </Card>
        ) : null}

      </div>

      <div className="sticky bottom-0 -mx-6 mt-3 border-t border-border bg-background/95 px-6 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto flex w-full max-w-md flex-col gap-2">
          <p className="text-center text-xs text-muted-foreground">
            {readyCount}/{playerIds.length} prontos
            {mySlotsFull || myReady ? null : " — escolha 3 filmes para confirmar"}
          </p>

          {mySlotsFull || myReady ? (
            <Button
              size="lg"
              variant={myReady ? "secondary" : "default"}
              className="w-full"
              onClick={toggleReady}
              disabled={actionBusy}
            >
              {actionBusy ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : myReady ? (
                "Trocar filmes"
              ) : (
                <>
                  <Check className="h-5 w-5" />
                  Estou pronto
                </>
              )}
            </Button>
          ) : null}

          {isOwner ? (
            <Button
              size="lg"
              className="w-full"
              onClick={onDraw}
              disabled={!allReady || actionBusy}
            >
              {actionBusy ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <Dice5 className="h-5 w-5" />
                  Sortear
                </>
              )}
            </Button>
          ) : null}
        </div>
      </div>
    </main>
  );
}
