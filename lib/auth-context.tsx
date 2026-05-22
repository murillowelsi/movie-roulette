"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  signInAnonymously as fbSignInAnonymously,
  signInWithPopup,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { ref, serverTimestamp, update } from "firebase/database";
import { firebaseAuth, firebaseDb, googleProvider } from "@/lib/firebase";

type AuthState = {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInAnonymously: (displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const ANON_NAME_KEY = "movie-roulette:anon-name";

function pickAnonName(): string {
  const animals = ["Tigre", "Coruja", "Lobo", "Raposa", "Águia", "Pantera", "Lince", "Falcão", "Tucano", "Onça"];
  const adjectives = ["Cinéfilo", "Sortudo", "Crítico", "Misterioso", "Estreante", "Atento", "Veloz", "Curioso"];
  const a = adjectives[Math.floor(Math.random() * adjectives.length)];
  const b = animals[Math.floor(Math.random() * animals.length)];
  return `${a} ${b}`;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(firebaseAuth(), async (u) => {
      setUser(u);
      setLoading(false);
      if (u) {
        try {
          await update(ref(firebaseDb(), `users/${u.uid}`), {
            displayName: u.displayName ?? "Anônimo",
            photoURL: u.photoURL ?? "",
            lastSeenAt: serverTimestamp(),
          });
        } catch (err) {
          console.warn(
            "[auth] couldn't mirror user profile to RTDB — check database.rules.json is applied",
            err
          );
        }
      }
    });
    return () => unsubAuth();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      signInWithGoogle: async () => {
        await signInWithPopup(firebaseAuth(), googleProvider);
      },
      signInAnonymously: async (displayName?: string) => {
        const stored =
          typeof window !== "undefined"
            ? window.localStorage.getItem(ANON_NAME_KEY)
            : null;
        const name = displayName?.trim() || stored || pickAnonName();
        if (typeof window !== "undefined") {
          window.localStorage.setItem(ANON_NAME_KEY, name);
        }
        const cred = await fbSignInAnonymously(firebaseAuth());
        await updateProfile(cred.user, { displayName: name });
        const current = firebaseAuth().currentUser;
        if (current) {
          setUser(current);
          try {
            await update(ref(firebaseDb(), `users/${current.uid}`), {
              displayName: name,
              photoURL: "",
              anonymous: true,
              lastSeenAt: serverTimestamp(),
            });
          } catch (err) {
            console.warn(
              "[auth] couldn't mirror anonymous profile to RTDB — check database.rules.json is applied",
              err
            );
          }
        }
      },
      signOut: async () => {
        await fbSignOut(firebaseAuth());
      },
    }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
