// Her characters for the cards in chat: fetched once, refreshed when a card names one that isn't
// known yet, or when one is made or changed (in chat or the workshop).

import { useEffect, useState } from "react";
import { api, type Character } from "../api";

let cache: Map<number, Character> | null = null;
let loading: Promise<void> | null = null;
const subscribers = new Set<() => void>();

function load() {
  loading ??= api<{ characters: Character[] }>("/api/oc")
    .then((r) => { cache = new Map(r.characters.map((c) => [c.id, c])); })
    .catch(() => { cache ??= new Map(); })
    .finally(() => { loading = null; for (const s of subscribers) s(); });
  return loading;
}

/** A character was made or changed: cards already showing get the new version. */
export function refreshCharacters() { if (cache) void load(); }

/** The character (undefined while loading, null if it's gone). */
export function useCharacter(id: number): Character | null | undefined {
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    subscribers.add(on);
    if (!cache || !cache.has(id)) void load();
    return () => { subscribers.delete(on); };
  }, [id]);
  if (!cache || (loading && !cache.has(id))) return undefined;
  return cache.get(id) ?? null;
}
