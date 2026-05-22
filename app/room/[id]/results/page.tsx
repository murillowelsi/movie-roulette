"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { onValue, ref } from "firebase/database";
import { Crown, Flag, Loader2, LogOut, RotateCw, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth-context";
import { firebaseDb } from "@/lib/firebase";
import { endGame, leaveRoom, nextRound, recordPlayerStats } from "@/lib/rooms";

type Player = {
  displayName?: string;
  photoURL?: string;
  score?: number;
};

type RoomSnapshot = {
  ownerId: string;
  status: "lobby" | "selecting" | "drawn" | "rating" | "finished";
  currentRound: number;
  gameOver?: boolean;
  players?: Record<string, Player>;
};

export default function ResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: roomId } = use(params);
  const { user, loading } = useAuth();
  const router = useRouter();
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"next" | "end" | "leave" | null>(null);
  const [leaving, setLeaving] = useState(false);
  const recordedRef = useRef(false);

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
          return;
        }
        setError(null);
        setRoom(value);
      },
      (err) => {
        console.error("[results] listener", err);
        setError("Sem permissão para acessar esta sala.");
      }
    );
    return () => unsub();
  }, [roomId, user]);

  useEffect(() => {
    if (!room || !user || leaving) return;
    if (room.status === "selecting") router.replace(`/room/${roomId}/select`);
    else if (room.status === "drawn") router.replace(`/room/${roomId}/reveal`);
    else if (room.status === "rating") router.replace(`/room/${roomId}/rate`);
    else if (room.status === "lobby") router.replace(`/room/${roomId}`);
  }, [room?.status, roomId, router, room, user, leaving]);

  useEffect(() => {
    if (!room || !user) return;
    if (!room.gameOver || recordedRef.current) return;
    const myScore = room.players?.[user.uid]?.score ?? 0;
    recordedRef.current = true;
    recordPlayerStats(user, roomId, myScore).catch((err) => {
      console.error("[results] recordPlayerStats failed", err);
    });
  }, [room?.gameOver, room?.players, user, roomId, room]);

  const leaderboard = useMemo(() => {
    const players = room?.players ?? {};
    return Object.entries(players)
      .map(([uid, p]) => ({ uid, ...p, score: p.score ?? 0 }))
      .sort((a, b) => b.score - a.score);
  }, [room]);

  if (loading || !user || !room) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  const isOwner = room.ownerId === user.uid;
  const isGameOver = !!room.gameOver;

  const onNext = async () => {
    if (!isOwner || busy) return;
    setBusy("next");
    try {
      await nextRound(roomId, room.currentRound);
    } catch (err) {
      console.error("[results] nextRound failed", err);
      setError(err instanceof Error ? err.message : "Falha ao iniciar nova rodada.");
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
      console.error("[results] leaveRoom failed", err);
    }
    router.push("/home");
  };

  const onEnd = async () => {
    if (!isOwner || busy) return;
    setBusy("end");
    try {
      await endGame(roomId);
    } catch (err) {
      console.error("[results] endGame failed", err);
      setError(err instanceof Error ? err.message : "Falha ao encerrar partida.");
      setBusy(null);
    }
  };

  return (
    <main className="flex flex-1 flex-col px-6 pt-4 pb-0">
      <header className="flex items-center justify-between pb-3">
        <h1 className="text-lg font-semibold">{isGameOver ? "Fim de jogo" : "Placar"}</h1>
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

        {isGameOver ? (
          <div className="flex flex-col items-center gap-2 pt-2 text-center">
            <Trophy className="h-10 w-10 text-amber-500" />
            <p className="text-2xl font-bold">{leaderboard[0]?.displayName ?? "Anônimo"} venceu!</p>
            <p className="text-sm text-muted-foreground">
              {leaderboard[0]?.score ?? 0} pontos após {room.currentRound} rodada
              {room.currentRound === 1 ? "" : "s"}
            </p>
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Classificação</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {leaderboard.map((p, i) => {
              const isMe = p.uid === user.uid;
              return (
                <div
                  key={p.uid}
                  className={
                    isMe
                      ? "flex items-center gap-3 rounded-md border border-primary/30 bg-primary/5 p-2"
                      : "flex items-center gap-3 p-2"
                  }
                >
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
                    {i === 0 ? <Crown className="h-4 w-4 text-amber-500" /> : i + 1}
                  </div>
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
                      {p.uid === room.ownerId ? (
                        <span className="ml-2 text-xs text-muted-foreground">(host)</span>
                      ) : null}
                    </p>
                  </div>
                  <span className="font-mono text-lg font-semibold">{p.score}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>

      </div>

      <div className="sticky bottom-0 -mx-6 mt-3 border-t border-border bg-background/95 px-6 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto w-full max-w-md">
          {isGameOver ? (
            <Button size="lg" className="w-full" onClick={() => router.push("/home")}>
              Voltar para a home
            </Button>
          ) : isOwner ? (
            <div className="flex flex-col gap-2">
              <Button size="lg" className="w-full" onClick={onNext} disabled={busy !== null}>
                {busy === "next" ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <RotateCw className="h-5 w-5" />
                    Nova rodada
                  </>
                )}
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="w-full"
                onClick={onEnd}
                disabled={busy !== null}
              >
                {busy === "end" ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <Flag className="h-5 w-5" />
                    Encerrar partida
                  </>
                )}
              </Button>
            </div>
          ) : (
            <p className="text-center text-xs text-muted-foreground">
              Aguardando o host iniciar a próxima rodada ou encerrar a partida.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
