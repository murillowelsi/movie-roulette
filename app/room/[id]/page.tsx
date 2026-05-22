"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onValue, ref, update } from "firebase/database";
import { Check, Copy, Loader2, LogOut, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth-context";
import { firebaseDb } from "@/lib/firebase";
import { leaveRoom } from "@/lib/rooms";

type Player = {
  displayName?: string;
  photoURL?: string;
  ready?: boolean;
  connected?: boolean;
  score?: number;
};

type RoomSnapshot = {
  ownerId: string;
  inviteCode: string;
  status: "lobby" | "selecting" | "drawn" | "rating" | "finished";
  currentRound: number;
  players?: Record<string, Player>;
};

export default function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: roomId } = use(params);
  const { user, loading } = useAuth();
  const router = useRouter();
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<"ready" | "start" | "leave" | null>(null);
  const [leaving, setLeaving] = useState(false);

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
        setError(null);
        setRoom(value);
      },
      (err) => {
        console.error("[room] listener error", err);
        setError("Sem permissão para acessar esta sala.");
      }
    );
    return () => unsub();
  }, [roomId, user]);

  useEffect(() => {
    if (leaving) return;
    if (room?.status === "selecting") {
      router.replace(`/room/${roomId}/select`);
    } else if (
      room?.status === "drawn" ||
      room?.status === "rating" ||
      room?.status === "finished"
    ) {
      router.replace(`/room/${roomId}/reveal`);
    }
  }, [room?.status, roomId, router, leaving]);

  if (loading || !user) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  const copyCode = async () => {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const players = room?.players ?? {};
  const playerIds = Object.keys(players);
  const me = user ? players[user.uid] : undefined;
  const isOwner = room?.ownerId === user?.uid;
  const guestIds = playerIds.filter((id) => id !== room?.ownerId);
  const allGuestsReady =
    guestIds.length > 0 && guestIds.every((id) => players[id]?.ready);
  const canStart = isOwner && playerIds.length >= 2 && allGuestsReady;

  const toggleReady = async () => {
    if (!user || !room || busy) return;
    setBusy("ready");
    try {
      await update(ref(firebaseDb(), `rooms/${roomId}/players/${user.uid}`), {
        ready: !me?.ready,
      });
    } catch (err) {
      console.error("[room] toggleReady failed", err);
      setError("Falha ao atualizar status.");
    } finally {
      setBusy(null);
    }
  };

  const startGame = async () => {
    if (!canStart || busy) return;
    setBusy("start");
    try {
      const updates: Record<string, unknown> = {
        status: "selecting",
        currentRound: (room?.currentRound ?? 0) + 1,
      };
      for (const uid of playerIds) {
        updates[`players/${uid}/ready`] = false;
      }
      await update(ref(firebaseDb(), `rooms/${roomId}`), updates);
    } catch (err) {
      console.error("[room] startGame failed", err);
      setError("Falha ao iniciar o jogo.");
      setBusy(null);
    }
  };

  const onLeave = async () => {
    if (!user || busy) return;
    setLeaving(true);
    setBusy("leave");
    try {
      await leaveRoom(user, roomId);
    } catch (err) {
      console.error("[room] leaveRoom failed", err);
    }
    router.push("/home");
  };

  return (
    <main className="flex flex-1 flex-col px-6 pt-4 pb-0">
      <header className="flex items-center justify-between pb-3">
        <h1 className="text-lg font-semibold">Sala</h1>
        <Button
          variant="ghost"
          size="icon"
          onClick={onLeave}
          disabled={busy !== null}
          aria-label="Sair da sala"
        >
          {busy === "leave" ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogOut className="h-5 w-5" />}
        </Button>
      </header>

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-3">
        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {!room && !error ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : null}

        {room ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Código da sala</CardTitle>
              </CardHeader>
              <CardContent>
                <button
                  type="button"
                  onClick={copyCode}
                  className="flex w-full items-center justify-between rounded-md border border-border bg-secondary px-4 py-3 font-mono text-2xl tracking-widest"
                  aria-label="Copiar código da sala"
                >
                  <span>{room.inviteCode}</span>
                  <Copy className="h-5 w-5 text-muted-foreground" />
                </button>
                <p className="pt-2 text-xs text-muted-foreground">
                  {copied ? "Copiado!" : "Toque para copiar e enviar aos amigos."}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Jogadores ({playerIds.length}/8)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {playerIds.map((uid) => {
                  const p = players[uid];
                  const isHost = uid === room.ownerId;
                  const ready = !!p.ready;
                  return (
                    <div key={uid} className="flex items-center gap-3">
                      {p.photoURL ? (
                        <img
                          src={p.photoURL}
                          alt=""
                          className="h-9 w-9 rounded-full border border-border"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="h-9 w-9 rounded-full bg-secondary" />
                      )}
                      <div className="flex-1 leading-tight">
                        <p className="text-sm font-medium">
                          {p.displayName ?? "Anônimo"}
                        </p>
                      </div>
                      {isHost ? (
                        <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          host
                        </span>
                      ) : (
                        <span
                          className={
                            ready
                              ? "inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary"
                              : "inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground"
                          }
                        >
                          {ready ? <Check className="h-3 w-3" /> : null}
                          {ready ? "Pronto" : "Aguardando"}
                        </span>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>

          </>
        ) : null}
      </div>

      {room ? (
        <div className="sticky bottom-0 -mx-6 mt-3 border-t border-border bg-background/95 px-6 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
          <div className="mx-auto flex w-full max-w-md flex-col gap-2">
            {!isOwner ? (
              <Button
                size="lg"
                variant={me?.ready ? "secondary" : "default"}
                className="w-full"
                onClick={toggleReady}
                disabled={busy !== null}
              >
                {busy === "ready" ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : me?.ready ? (
                  "Cancelar pronto"
                ) : (
                  <>
                    <Check className="h-5 w-5" />
                    Estou pronto
                  </>
                )}
              </Button>
            ) : (
              <Button
                size="lg"
                className="w-full"
                onClick={startGame}
                disabled={!canStart || busy !== null}
              >
                {busy === "start" ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <Play className="h-5 w-5" />
                    Iniciar jogo
                  </>
                )}
              </Button>
            )}

            {isOwner && !canStart ? (
              <p className="text-center text-xs text-muted-foreground">
                {playerIds.length < 2
                  ? "Aguardando pelo menos 1 outro jogador entrar."
                  : "Aguardando todos os convidados marcarem Pronto."}
              </p>
            ) : null}
            {!isOwner ? (
              <p className="text-center text-xs text-muted-foreground">
                Só o host pode iniciar o jogo.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}
