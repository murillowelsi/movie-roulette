"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onValue, ref } from "firebase/database";
import { Loader2, LogOut, Send, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/lib/auth-context";
import { firebaseDb } from "@/lib/firebase";
import { tmdbPosterUrl } from "@/lib/tmdb-client";
import { finishRound, leaveRoom, submitRating, type SelectedMovie } from "@/lib/rooms";

type Player = { displayName?: string; photoURL?: string };
type Rating = { value: number };

type RoomSnapshot = {
  ownerId: string;
  status: "lobby" | "selecting" | "drawn" | "rating" | "finished";
  currentRound: number;
  players?: Record<string, Player>;
  rounds?: Record<
    string,
    {
      draw?: { suggesterId: string; movie: SelectedMovie };
      ratings?: Record<string, Rating>;
    }
  >;
};

export default function RatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: roomId } = use(params);
  const { user, loading } = useAuth();
  const router = useRouter();
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState(7);
  const [busy, setBusy] = useState(false);
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
        console.error("[rate] listener", err);
        setError("Sem permissão para acessar esta sala.");
      }
    );
    return () => unsub();
  }, [roomId, user, leaving, router]);

  useEffect(() => {
    if (!room || leaving) return;
    if (room.status === "selecting") router.replace(`/room/${roomId}/select`);
    if (room.status === "lobby") router.replace(`/room/${roomId}`);
    if (room.status === "drawn" || room.status === "finished") {
      router.replace(`/room/${roomId}/reveal`);
    }
  }, [room?.status, roomId, router, room, leaving]);

  const round = useMemo(
    () => room?.rounds?.[String(room?.currentRound ?? 0)],
    [room]
  );
  const draw = round?.draw;
  const ratings = round?.ratings ?? {};
  const players = room?.players ?? {};
  const playerIds = Object.keys(players);
  const raters = playerIds.filter((id) => id !== draw?.suggesterId);
  const submittedCount = raters.filter((id) => ratings[id]?.value).length;
  const allSubmitted = raters.length > 0 && submittedCount === raters.length;

  if (loading || !user || !room || !draw) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  const isOwner = room.ownerId === user.uid;
  const isSuggester = draw.suggesterId === user.uid;
  const myRating = ratings[user.uid]?.value;
  const suggester = players[draw.suggesterId];

  const onSubmit = async () => {
    if (busy || isSuggester) return;
    setBusy(true);
    try {
      await submitRating(user, roomId, room.currentRound, rating);
    } catch (err) {
      console.error("[rate] submitRating failed", err);
      setError(err instanceof Error ? err.message : "Falha ao enviar nota.");
    } finally {
      setBusy(false);
    }
  };

  const onLeave = async () => {
    if (!user || busy) return;
    setLeaving(true);
    setBusy(true);
    try {
      await leaveRoom(user, roomId);
    } catch (err) {
      console.error("[rate] leaveRoom failed", err);
    }
    router.push("/home");
  };

  const onFinish = async () => {
    if (!isOwner || busy || !allSubmitted) return;
    setBusy(true);
    try {
      await finishRound(roomId, room.currentRound);
    } catch (err) {
      console.error("[rate] finishRound failed", err);
      setError(err instanceof Error ? err.message : "Falha ao encerrar rodada.");
      setBusy(false);
    }
  };

  return (
    <main className="flex flex-1 flex-col px-6 pt-4 pb-0">
      <header className="flex items-center justify-between pb-3">
        <h1 className="text-lg font-semibold">Sua nota</h1>
        <Button
          variant="ghost"
          size="icon"
          onClick={onLeave}
          disabled={busy}
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

        <Card>
          <CardContent className="flex items-center gap-3 p-3">
            <div className="h-20 w-14 flex-shrink-0 overflow-hidden rounded bg-secondary">
              {draw.movie.posterPath ? (
                <img
                  src={tmdbPosterUrl(draw.movie.posterPath, "w185") ?? ""}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : null}
            </div>
            <div className="flex-1 leading-tight">
              <p className="font-semibold">{draw.movie.title}</p>
              {draw.movie.releaseYear ? (
                <p className="text-xs text-muted-foreground">{draw.movie.releaseYear}</p>
              ) : null}
              <p className="pt-1 text-xs text-muted-foreground">
                Sugerido por {suggester?.displayName ?? "Anônimo"}
              </p>
            </div>
          </CardContent>
        </Card>

        {isSuggester ? (
          <Card>
            <CardContent className="space-y-2 p-4 text-center">
              <p className="text-sm font-medium">Você sugeriu esse filme.</p>
              <p className="text-xs text-muted-foreground">
                Aguarde a galera votar — você ganha pontos pela média deles.
              </p>
              <p className="pt-2 text-sm">
                {submittedCount}/{raters.length} avaliaram
              </p>
            </CardContent>
          </Card>
        ) : myRating !== undefined ? (
          <Card>
            <CardContent className="space-y-2 p-4 text-center">
              <p className="text-sm font-medium">Sua nota foi enviada.</p>
              <p className="flex items-center justify-center gap-1 text-3xl font-bold">
                <Star className="h-6 w-6 fill-current text-amber-500" />
                {myRating}
              </p>
              <p className="text-xs text-muted-foreground">
                {submittedCount}/{raters.length} avaliaram
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="space-y-4 p-4">
              <div className="text-center">
                <p className="flex items-center justify-center gap-1 text-4xl font-bold">
                  <Star className="h-7 w-7 fill-current text-amber-500" />
                  {rating}
                </p>
                <p className="pt-1 text-xs text-muted-foreground">De 1 (não curti) a 10 (incrível)</p>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={rating}
                onChange={(e) => setRating(Number(e.target.value))}
                className="w-full accent-primary"
                aria-label="Sua nota de 1 a 10"
              />
              <Button size="lg" className="w-full" onClick={onSubmit} disabled={busy}>
                {busy ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <Send className="h-5 w-5" />
                    Enviar nota
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}

      </div>

      {isOwner ? (
        <div className="sticky bottom-0 -mx-6 mt-3 border-t border-border bg-background/95 px-6 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
          <div className="mx-auto w-full max-w-md">
            <Button
              size="lg"
              variant={allSubmitted ? "default" : "secondary"}
              className="w-full"
              onClick={onFinish}
              disabled={!allSubmitted || busy}
            >
              {busy ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : allSubmitted ? (
                "Encerrar rodada"
              ) : (
                `Aguardando ${raters.length - submittedCount} avaliações`
              )}
            </Button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
