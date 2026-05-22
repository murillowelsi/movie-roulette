"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { onValue, ref } from "firebase/database";
import { ArrowRight, Dice5, Loader2, LogOut, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/lib/auth-context";
import { firebaseDb } from "@/lib/firebase";
import { tmdbPosterUrl } from "@/lib/tmdb-client";
import { leaveRoom, startRating, type SelectedMovie } from "@/lib/rooms";

type DrawData = {
  suggesterId: string;
  movie: SelectedMovie;
  poolSize?: number;
};

type Player = {
  displayName?: string;
  photoURL?: string;
};

type RoomSnapshot = {
  ownerId: string;
  status: "lobby" | "selecting" | "drawn" | "rating" | "finished";
  currentRound: number;
  players?: Record<string, Player & { score?: number }>;
  rounds?: Record<
    string,
    {
      draw?: DrawData;
      scoresAwarded?: Record<string, number>;
      avg?: number;
      selections?: Record<string, Record<string, SelectedMovie>>;
    }
  >;
};

type AnimPhase = "pending" | "shuffling" | "done";

export default function RevealPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: roomId } = use(params);
  const { user, loading } = useAuth();
  const router = useRouter();
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [animPhase, setAnimPhase] = useState<AnimPhase>("pending");
  const [animIndex, setAnimIndex] = useState(0);

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
        console.error("[reveal] listener", err);
        setError("Sem permissão para acessar esta sala.");
      }
    );
    return () => unsub();
  }, [roomId, user]);

  useEffect(() => {
    if (!room || leaving) return;
    if (room.status === "selecting") router.replace(`/room/${roomId}/select`);
    if (room.status === "lobby") router.replace(`/room/${roomId}`);
    if (room.status === "rating") router.replace(`/room/${roomId}/rate`);
  }, [room?.status, roomId, router, room, leaving]);

  const round = room?.rounds?.[String(room?.currentRound ?? 0)];
  const draw = round?.draw;

  const allMovies = useMemo(() => {
    const selections = round?.selections ?? {};
    const movies: SelectedMovie[] = [];
    for (const slots of Object.values(selections)) {
      for (const m of Object.values(slots)) {
        if (m && typeof m.tmdbId === "number") movies.push(m);
      }
    }
    return movies;
  }, [round?.selections]);

  const allMoviesRef = useRef<SelectedMovie[]>([]);
  useEffect(() => {
    allMoviesRef.current = allMovies;
  }, [allMovies]);

  const drawRef = useRef<DrawData | undefined>(undefined);
  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  // Transition pending → shuffling (or skip to done)
  useEffect(() => {
    if (animPhase !== "pending") return;
    if (!draw) return;
    if (room?.status !== "drawn") {
      setAnimPhase("done");
      return;
    }
    if (allMovies.length === 0) {
      setAnimPhase("done");
      return;
    }
    setAnimPhase("shuffling");
  }, [animPhase, draw, room?.status, allMovies]);

  // Run the shuffle ticks — only re-runs when animPhase changes
  useEffect(() => {
    if (animPhase !== "shuffling") return;
    const movies = allMoviesRef.current;
    const winner = drawRef.current?.movie;
    if (!winner || movies.length === 0) {
      setAnimPhase("done");
      return;
    }

    const winnerIdx = Math.max(
      0,
      movies.findIndex((m) => m.tmdbId === winner.tmdbId)
    );
    const totalMs = 2600;
    let prevIdx = -1;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = (elapsed: number) => {
      if (cancelled) return;
      const progress = Math.min(1, elapsed / totalMs);
      const delay = 60 + Math.pow(progress, 2.5) * 380;

      let nextIdx: number;
      if (movies.length === 1) {
        nextIdx = 0;
      } else {
        do {
          nextIdx = Math.floor(Math.random() * movies.length);
        } while (nextIdx === prevIdx);
      }
      prevIdx = nextIdx;
      setAnimIndex(nextIdx);

      if (elapsed + delay >= totalMs) {
        timer = setTimeout(() => {
          if (cancelled) return;
          setAnimIndex(winnerIdx);
          timer = setTimeout(() => {
            if (cancelled) return;
            setAnimPhase("done");
          }, 220);
        }, delay);
        return;
      }
      timer = setTimeout(() => tick(elapsed + delay), delay);
    };
    tick(0);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [animPhase]);

  if (loading || !user || !room) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  const suggester = draw ? room.players?.[draw.suggesterId] : undefined;
  const isOwner = room.ownerId === user.uid;
  const isFinished = room.status === "finished";
  const shuffling = animPhase === "shuffling";
  const shuffleMovie = shuffling ? allMovies[animIndex] : undefined;

  const onStartRating = async () => {
    if (!isOwner || busy) return;
    setBusy(true);
    try {
      await startRating(roomId);
    } catch (err) {
      console.error("[reveal] startRating failed", err);
      setError("Falha ao iniciar avaliação.");
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
      console.error("[reveal] leaveRoom failed", err);
    }
    router.push("/home");
  };

  return (
    <main className="flex flex-1 flex-col px-6 py-8">
      <header className="flex items-center justify-between pb-6">
        <h1 className="text-lg font-semibold">Sorteio</h1>
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

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-6">
        {error ? (
          <p className="w-full rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {draw ? (
          shuffling ? (
            <>
              <div className="flex items-center gap-2 text-primary">
                <Dice5 className="h-5 w-5 animate-spin" />
                <p className="text-sm font-medium uppercase tracking-wide">
                  Sorteando…
                </p>
              </div>

              <div className="w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg shuffle-glow">
                {shuffleMovie ? (
                  <div key={animIndex} className="ticker-pop">
                    {shuffleMovie.posterPath ? (
                      <img
                        src={tmdbPosterUrl(shuffleMovie.posterPath, "w500") ?? ""}
                        alt=""
                        className="h-auto w-full"
                      />
                    ) : (
                      <div className="flex h-64 w-full items-center justify-center bg-secondary">
                        <p className="px-4 text-center text-lg font-semibold">{shuffleMovie.title}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex h-64 w-full items-center justify-center bg-secondary">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>

              <p className="text-center text-sm text-muted-foreground">
                {allMovies.length} filmes na roleta…
              </p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 text-primary">
                <Sparkles className="h-5 w-5" />
                <p className="text-sm font-medium uppercase tracking-wide">
                  A roleta escolheu
                </p>
              </div>

              <div className="winner-reveal w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg">
                {draw.movie.posterPath ? (
                  <img
                    src={tmdbPosterUrl(draw.movie.posterPath, "w500") ?? ""}
                    alt={draw.movie.title}
                    className="h-auto w-full"
                  />
                ) : (
                  <div className="flex h-64 w-full items-center justify-center bg-secondary">
                    <p className="px-4 text-center text-lg font-semibold">{draw.movie.title}</p>
                  </div>
                )}
              </div>

              <div className="text-center">
                <h2 className="text-2xl font-bold">{draw.movie.title}</h2>
                {draw.movie.releaseYear ? (
                  <p className="text-sm text-muted-foreground">{draw.movie.releaseYear}</p>
                ) : null}
              </div>

              <Card className="w-full">
                <CardContent className="flex items-center gap-3 p-4">
                  {suggester?.photoURL ? (
                    <img
                      src={suggester.photoURL}
                      alt=""
                      className="h-10 w-10 rounded-full border border-border"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-secondary" />
                  )}
                  <div className="leading-tight">
                    <p className="text-xs text-muted-foreground">Sugerido por</p>
                    <p className="font-semibold">{suggester?.displayName ?? "Anônimo"}</p>
                  </div>
                </CardContent>
              </Card>

              {!isFinished && isOwner ? (
                <Button
                  size="lg"
                  className="w-full"
                  onClick={onStartRating}
                  disabled={busy}
                >
                  {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Começar avaliação"}
                </Button>
              ) : null}
              {!isFinished && !isOwner ? (
                <p className="text-center text-xs text-muted-foreground">
                  O host iniciará a avaliação em instantes.
                </p>
              ) : null}
              {isFinished ? (
                <Button
                  size="lg"
                  className="w-full"
                  onClick={() => router.push(`/room/${roomId}/results`)}
                >
                  Ver placar
                  <ArrowRight className="h-5 w-5" />
                </Button>
              ) : null}
            </>
          )
        ) : (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        )}
      </div>
    </main>
  );
}
