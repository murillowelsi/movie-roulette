export type TmdbSearchResult = {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  releaseYear: string;
  overview: string;
};

export function tmdbPosterUrl(
  posterPath: string | null,
  size: "w185" | "w342" | "w500" = "w342"
): string | null {
  if (!posterPath) return null;
  return `https://image.tmdb.org/t/p/${size}${posterPath}`;
}
