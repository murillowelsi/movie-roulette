import {
  get,
  push,
  ref,
  remove,
  serverTimestamp,
  update,
  type Database,
} from "firebase/database";
import type { User } from "firebase/auth";
import { firebaseDb } from "@/lib/firebase";

export type SelectedMovie = {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  releaseYear: string;
};

export const SELECTIONS_PER_PLAYER = 3;

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const INVITE_LENGTH = 6;
const MAX_INVITE_ATTEMPTS = 5;
const MAX_PLAYERS = 8;

function randomInviteCode(): string {
  let code = "";
  for (let i = 0; i < INVITE_LENGTH; i++) {
    code += INVITE_ALPHABET[Math.floor(Math.random() * INVITE_ALPHABET.length)];
  }
  return code;
}

async function reserveInviteCode(db: Database): Promise<string> {
  for (let attempt = 0; attempt < MAX_INVITE_ATTEMPTS; attempt++) {
    const code = randomInviteCode();
    const snap = await get(ref(db, `invites/${code}`));
    if (!snap.exists()) return code;
  }
  throw new Error("Não foi possível gerar um código de sala. Tente de novo.");
}

export async function createRoom(user: User): Promise<{ roomId: string; inviteCode: string }> {
  const db = firebaseDb();

  const roomId = push(ref(db, "rooms")).key;
  if (!roomId) throw new Error("Falha ao reservar id da sala.");

  const inviteCode = await reserveInviteCode(db);

  const updates: Record<string, unknown> = {
    [`rooms/${roomId}`]: {
      ownerId: user.uid,
      inviteCode,
      status: "lobby",
      currentRound: 0,
      createdAt: serverTimestamp(),
      players: {
        [user.uid]: {
          displayName: user.displayName ?? "Anônimo",
          photoURL: user.photoURL ?? "",
          ready: false,
          connected: true,
          score: 0,
          joinedAt: serverTimestamp(),
        },
      },
    },
    [`invites/${inviteCode}`]: roomId,
    [`users/${user.uid}/recentRooms/${roomId}`]: {
      inviteCode,
      joinedAt: serverTimestamp(),
    },
  };

  await update(ref(db), updates);
  return { roomId, inviteCode };
}

export async function joinRoom(
  user: User,
  rawCode: string
): Promise<{ roomId: string }> {
  const db = firebaseDb();
  const code = rawCode.trim().toUpperCase();
  if (code.length !== INVITE_LENGTH) {
    throw new Error("Código inválido. Use 6 caracteres.");
  }

  const inviteSnap = await get(ref(db, `invites/${code}`));
  if (!inviteSnap.exists()) {
    throw new Error("Sala não encontrada para esse código.");
  }
  const roomId = inviteSnap.val() as string;

  const playersSnap = await get(ref(db, `rooms/${roomId}/players`));
  const players = (playersSnap.val() ?? {}) as Record<string, unknown>;
  const playerIds = Object.keys(players);
  const alreadyIn = playerIds.includes(user.uid);

  if (!alreadyIn && playerIds.length >= MAX_PLAYERS) {
    throw new Error("Esta sala já está cheia (máx. 8 jogadores).");
  }

  if (!alreadyIn) {
    await update(ref(db), {
      [`rooms/${roomId}/players/${user.uid}`]: {
        displayName: user.displayName ?? "Anônimo",
        photoURL: user.photoURL ?? "",
        ready: false,
        connected: true,
        score: 0,
        joinedAt: serverTimestamp(),
      },
      [`users/${user.uid}/recentRooms/${roomId}`]: {
        inviteCode: code,
        joinedAt: serverTimestamp(),
      },
    });
  } else {
    await update(ref(db, `users/${user.uid}/recentRooms/${roomId}`), {
      inviteCode: code,
      joinedAt: serverTimestamp(),
    });
  }

  return { roomId };
}

export async function leaveRoom(user: User, roomId: string): Promise<void> {
  const db = firebaseDb();
  await remove(ref(db, `rooms/${roomId}/players/${user.uid}`));
}

export async function rejoinRoom(
  user: User,
  roomId: string
): Promise<void> {
  const db = firebaseDb();
  const playersSnap = await get(ref(db, `rooms/${roomId}/players`));
  if (!playersSnap.exists()) {
    throw new Error("Sala não está mais disponível.");
  }
  const players = (playersSnap.val() ?? {}) as Record<string, unknown>;
  if (!players[user.uid] && Object.keys(players).length >= MAX_PLAYERS) {
    throw new Error("Esta sala está cheia (máx. 8 jogadores).");
  }
  if (!players[user.uid]) {
    await update(ref(db, `rooms/${roomId}/players/${user.uid}`), {
      displayName: user.displayName ?? "Anônimo",
      photoURL: user.photoURL ?? "",
      ready: false,
      connected: true,
      score: 0,
      joinedAt: serverTimestamp(),
    });
  }
}

export async function setSelection(
  user: User,
  roomId: string,
  round: number,
  slot: number,
  movie: SelectedMovie
): Promise<void> {
  if (slot < 0 || slot >= SELECTIONS_PER_PLAYER) {
    throw new Error("Slot inválido.");
  }
  const db = firebaseDb();
  await update(
    ref(db, `rooms/${roomId}/rounds/${round}/selections/${user.uid}/${slot}`),
    movie
  );
}

export async function clearSelection(
  user: User,
  roomId: string,
  round: number,
  slot: number
): Promise<void> {
  const db = firebaseDb();
  await remove(
    ref(db, `rooms/${roomId}/rounds/${round}/selections/${user.uid}/${slot}`)
  );
}

export async function startRating(roomId: string): Promise<void> {
  const db = firebaseDb();
  await update(ref(db, `rooms/${roomId}`), { status: "rating" });
}

export async function submitRating(
  user: User,
  roomId: string,
  round: number,
  rating: number
): Promise<void> {
  if (rating < 1 || rating > 10) throw new Error("Nota fora do intervalo 1-10.");
  const db = firebaseDb();
  await update(ref(db, `rooms/${roomId}/rounds/${round}/ratings/${user.uid}`), {
    value: rating,
    submittedAt: serverTimestamp(),
  });
}

type Rating = { value: number };

export async function finishRound(
  roomId: string,
  round: number
): Promise<void> {
  const db = firebaseDb();
  const [roomSnap, ratingsSnap, drawSnap] = await Promise.all([
    get(ref(db, `rooms/${roomId}`)),
    get(ref(db, `rooms/${roomId}/rounds/${round}/ratings`)),
    get(ref(db, `rooms/${roomId}/rounds/${round}/draw`)),
  ]);

  const room = roomSnap.val() as {
    players?: Record<string, { score?: number }>;
  } | null;
  const ratings = (ratingsSnap.val() ?? {}) as Record<string, Rating>;
  const draw = drawSnap.val() as { suggesterId: string } | null;

  if (!room || !draw) throw new Error("Estado da sala inconsistente.");

  const raterIds = Object.keys(ratings).filter((uid) => uid !== draw.suggesterId);
  if (raterIds.length === 0) {
    throw new Error("Ninguém avaliou ainda.");
  }

  const values = raterIds.map((uid) => ratings[uid].value);
  const sum = values.reduce((acc, v) => acc + v, 0);
  const avg = sum / values.length;
  const pointsForSuggester = Math.round((avg - 5.5) * 10);
  const pointsPerRater = 2;

  const scoresAwarded: Record<string, number> = {
    [draw.suggesterId]: pointsForSuggester,
  };
  for (const uid of raterIds) {
    scoresAwarded[uid] = pointsPerRater;
  }

  const updates: Record<string, unknown> = {
    status: "finished",
    [`rounds/${round}/scoresAwarded`]: scoresAwarded,
    [`rounds/${round}/avg`]: avg,
  };
  const players = room.players ?? {};
  for (const [uid, delta] of Object.entries(scoresAwarded)) {
    const current = players[uid]?.score ?? 0;
    updates[`players/${uid}/score`] = current + delta;
  }

  await update(ref(db, `rooms/${roomId}`), updates);
}

export async function nextRound(
  roomId: string,
  currentRound: number
): Promise<void> {
  const db = firebaseDb();
  const playersSnap = await get(ref(db, `rooms/${roomId}/players`));
  const players = (playersSnap.val() ?? {}) as Record<string, unknown>;
  const updates: Record<string, unknown> = {
    status: "selecting",
    currentRound: currentRound + 1,
  };
  for (const uid of Object.keys(players)) {
    updates[`players/${uid}/ready`] = false;
  }
  await update(ref(db, `rooms/${roomId}`), updates);
}

export async function endGame(roomId: string): Promise<void> {
  const db = firebaseDb();
  await update(ref(db, `rooms/${roomId}`), { gameOver: true });
}

export async function recordPlayerStats(
  user: User,
  roomId: string,
  scoreDelta: number
): Promise<void> {
  const db = firebaseDb();
  const guard = await get(ref(db, `users/${user.uid}/playedRooms/${roomId}`));
  if (guard.exists()) return;

  const snap = await get(ref(db, `users/${user.uid}`));
  const cur = (snap.val() ?? {}) as {
    totalGamesPlayed?: number;
    totalScore?: number;
  };

  await update(ref(db, `users/${user.uid}`), {
    totalGamesPlayed: (cur.totalGamesPlayed ?? 0) + 1,
    totalScore: (cur.totalScore ?? 0) + scoreDelta,
    [`playedRooms/${roomId}`]: true,
  });
}

export async function drawMovie(
  roomId: string,
  round: number
): Promise<void> {
  const db = firebaseDb();
  const snap = await get(ref(db, `rooms/${roomId}/rounds/${round}/selections`));
  const selections = (snap.val() ?? {}) as Record<
    string,
    Record<string, SelectedMovie>
  >;

  const pool: { uid: string; movie: SelectedMovie }[] = [];
  for (const [uid, slots] of Object.entries(selections)) {
    for (const movie of Object.values(slots)) {
      if (movie && typeof movie.tmdbId === "number") {
        pool.push({ uid, movie });
      }
    }
  }

  if (pool.length === 0) {
    throw new Error("Nenhum filme foi selecionado ainda.");
  }

  const seed = Math.random();
  const index = Math.floor(seed * pool.length);
  const picked = pool[index];

  await update(ref(db, `rooms/${roomId}`), {
    status: "drawn",
    [`rounds/${round}/draw`]: {
      seed,
      pickedIndex: index,
      poolSize: pool.length,
      suggesterId: picked.uid,
      movie: picked.movie,
      drawnAt: serverTimestamp(),
    },
  });
}
