"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Film, Loader2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";

export default function LandingPage() {
  const { user, loading, signInWithGoogle, signInAnonymously } = useAuth();
  const router = useRouter();
  const [anonOpen, setAnonOpen] = useState(false);
  const [anonName, setAnonName] = useState("");
  const [anonBusy, setAnonBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) router.replace("/home");
  }, [loading, user, router]);

  const onAnon = async () => {
    setError(null);
    setAnonBusy(true);
    try {
      await signInAnonymously(anonName);
    } catch (err) {
      console.error("[landing] anonymous sign-in failed", err);
      setError(
        err instanceof Error
          ? err.message
          : "Falha ao entrar no modo anônimo."
      );
      setAnonBusy(false);
    }
  };

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-md flex-col items-center gap-8 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
          <Film className="h-10 w-10" />
        </div>
        <div className="space-y-3">
          <h1 className="text-4xl font-bold tracking-tight">Movie Roulette</h1>
          <p className="text-balance text-muted-foreground">
            Cada um escolhe 3 filmes. A roleta sorteia. Todo mundo vota. Quem
            sugeriu boa coisa ganha pontos.
          </p>
        </div>

        {error ? (
          <p className="w-full rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex w-full flex-col gap-3">
          <Button
            size="xl"
            className="w-full"
            onClick={() => signInWithGoogle()}
            disabled={loading || anonBusy}
          >
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                <GoogleIcon />
                Entrar com Google
              </>
            )}
          </Button>

          {anonOpen ? (
            <div className="flex w-full flex-col gap-2 rounded-md border border-border bg-card p-3 text-left">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="anon-name">
                Como quer aparecer para os outros?
              </label>
              <Input
                id="anon-name"
                placeholder="Deixe em branco para um nome aleatório"
                value={anonName}
                onChange={(e) => setAnonName(e.target.value)}
                maxLength={24}
                autoFocus
              />
              <Button
                size="lg"
                className="w-full"
                onClick={onAnon}
                disabled={anonBusy}
              >
                {anonBusy ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  "Continuar como anônimo"
                )}
              </Button>
              <button
                type="button"
                className="self-center text-xs text-muted-foreground underline-offset-4 hover:underline"
                onClick={() => setAnonOpen(false)}
                disabled={anonBusy}
              >
                Cancelar
              </button>
            </div>
          ) : (
            <Button
              size="lg"
              variant="secondary"
              className="w-full"
              onClick={() => setAnonOpen(true)}
              disabled={loading || anonBusy}
            >
              <UserRound className="h-5 w-5" />
              Entrar sem conta
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Com Google compartilhamos seu nome e foto. No modo anônimo, só o apelido
          que você escolher.
        </p>
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#EA4335"
        d="M12 11v3.2h4.5c-.2 1.2-1.4 3.5-4.5 3.5a5 5 0 1 1 0-10 4.5 4.5 0 0 1 3.2 1.2l2.2-2.1A7.6 7.6 0 0 0 12 4.5a7.5 7.5 0 1 0 0 15c4.3 0 7.2-3 7.2-7.3 0-.5 0-.8-.1-1.2H12Z"
      />
    </svg>
  );
}
