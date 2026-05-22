import "server-only";
import type { TmdbSearchResult } from "@/lib/tmdb-client";

const TMDB_BASE = process.env.TMDB_API_BASE ?? "https://api.themoviedb.org/3";

export type { TmdbSearchResult };

type CachedEntry = {
  value: TmdbSearchResult[];
  expiresAt: number;
};

const CACHE_MAX = 200;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h

const cache = new Map<string, CachedEntry>();

function cacheGet(key: string): TmdbSearchResult[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  // refresh LRU order
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function cacheSet(key: string, value: TmdbSearchResult[]) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

type TmdbApiMovie = {
  id: number;
  title: string;
  poster_path: string | null;
  release_date?: string;
  overview?: string;
};

export async function searchMovies(query: string): Promise<TmdbSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const key = trimmed.toLowerCase();
  const cached = cacheGet(key);
  if (cached) return cached;

  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) throw new Error("TMDB_API_KEY not configured");

  const url = new URL(`${TMDB_BASE}/search/movie`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("query", trimmed);
  url.searchParams.set("language", "pt-BR");
  url.searchParams.set("include_adult", "false");
  url.searchParams.set("page", "1");

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`TMDB search failed: ${res.status}`);
  }
  const data = (await res.json()) as { results?: TmdbApiMovie[] };
  const results: TmdbSearchResult[] = (data.results ?? [])
    .filter((m) => m.title && (m.poster_path || m.release_date))
    .slice(0, 10)
    .map((m) => ({
      tmdbId: m.id,
      title: m.title,
      posterPath: m.poster_path ?? null,
      releaseYear: m.release_date ? m.release_date.slice(0, 4) : "",
      overview: m.overview ?? "",
    }));

  cacheSet(key, results);
  return results;
}
