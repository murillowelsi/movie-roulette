import { NextRequest } from "next/server";
import { searchMovies } from "@/lib/tmdb";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  if (q.trim().length < 2) {
    return Response.json({ results: [] });
  }
  try {
    const results = await searchMovies(q);
    return Response.json({ results });
  } catch (err) {
    console.error("[api/tmdb/search]", err);
    return Response.json(
      { error: "Falha na busca de filmes." },
      { status: 502 }
    );
  }
}
