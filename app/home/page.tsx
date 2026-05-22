"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onValue, ref } from "firebase/database";
import { ArrowRight, KeyRound, Loader2, LogOut, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth-context";
import { firebaseDb } from "@/lib/firebase";
import { createRoom, joinRoom, rejoinRoom } from "@/lib/rooms";

type RecentRoom = {
  inviteCode: string;
  joinedAt?: number;
};

export default function HomePage() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | "rejoin" | null>(null);
  const [rejoiningId, setRejoiningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recentRooms, setRecentRooms] = useState<Record<string, RecentRoom>>({});

  useEffect(() => {
    if (!loading && !user) router.replace("/");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    const unsub = onValue(
      ref(firebaseDb(), `users/${user.uid}/recentRooms`),
      (snap) => {
        const val = snap.val() as Record<string, RecentRoom> | null;
        setRecentRooms(val ?? {});
      },
      (err) => {
        console.error("[home] recentRooms listener", err);
      }
    );
    return () => unsub();
  }, [user]);

  const sortedRecent = useMemo(() => {
    return Object.entries(recentRooms)
      .map(([roomId, r]) => ({ roomId, ...r }))
      .sort((a, b) => (b.joinedAt ?? 0) - (a.joinedAt ?? 0))
      .slice(0, 5);
  }, [recentRooms]);

  if (loading || !user) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  const onCreate = async () => {
    setBusy("create");
    setError(null);
    try {
      const { roomId } = await createRoom(user);
      router.push(`/room/${roomId}`);
    } catch (err) {
      console.error("[home] createRoom failed", err);
      setError(err instanceof Error ? err.message : "Falha ao criar sala.");
      setBusy(null);
    }
  };

  const onJoin = async () => {
    if (!inviteCode.trim()) return;
    setBusy("join");
    setError(null);
    try {
      const { roomId } = await joinRoom(user, inviteCode);
      router.push(`/room/${roomId}`);
    } catch (err) {
      console.error("[home] joinRoom failed", err);
      setError(err instanceof Error ? err.message : "Falha ao entrar na sala.");
      setBusy(null);
    }
  };

  const onRejoin = async (roomId: string) => {
    setBusy("rejoin");
    setRejoiningId(roomId);
    setError(null);
    try {
      await rejoinRoom(user, roomId);
      router.push(`/room/${roomId}`);
    } catch (err) {
      console.error("[home] rejoinRoom failed", err);
      setError(err instanceof Error ? err.message : "Falha ao voltar para a sala.");
      setBusy(null);
      setRejoiningId(null);
    }
  };

  return (
    <main className="flex flex-1 flex-col px-6 py-8">
      <header className="flex items-center justify-between pb-8">
        <div className="flex items-center gap-3">
          {user.photoURL ? (
            <img
              src={user.photoURL}
              alt=""
              className="h-10 w-10 rounded-full border border-border"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="h-10 w-10 rounded-full bg-secondary" />
          )}
          <div className="leading-tight">
            <p className="text-xs text-muted-foreground">Olá,</p>
            <p className="font-semibold">{user.displayName?.split(" ")[0]}</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={() => signOut()} aria-label="Sair">
          <LogOut className="h-5 w-5" />
        </Button>
      </header>

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4">
        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>Criar uma sala nova</CardTitle>
          </CardHeader>
          <CardContent>
            <Button size="lg" className="w-full" onClick={onCreate} disabled={busy !== null}>
              {busy === "create" ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <Plus className="h-5 w-5" />
                  Criar sala
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Entrar em uma sala</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="Código da sala (ex: AB12CD)"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              maxLength={6}
              className="font-mono text-center uppercase tracking-widest"
            />
            <Button
              size="lg"
              variant="secondary"
              className="w-full"
              onClick={onJoin}
              disabled={busy !== null || inviteCode.length < 4}
            >
              {busy === "join" ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <KeyRound className="h-5 w-5" />
                  Entrar com código
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {sortedRecent.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Suas salas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {sortedRecent.map((r) => {
                const isThis = rejoiningId === r.roomId;
                return (
                  <button
                    key={r.roomId}
                    type="button"
                    onClick={() => onRejoin(r.roomId)}
                    disabled={busy !== null}
                    className="flex w-full items-center gap-3 rounded-md border border-border bg-card p-3 text-left transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <div className="flex-1 leading-tight">
                      <p className="font-mono text-lg font-semibold tracking-widest">
                        {r.inviteCode}
                      </p>
                      <p className="text-xs text-muted-foreground">Voltar para essa sala</p>
                    </div>
                    {isThis && busy === "rejoin" ? (
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    ) : (
                      <ArrowRight className="h-5 w-5 text-muted-foreground" />
                    )}
                  </button>
                );
              })}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </main>
  );
}
