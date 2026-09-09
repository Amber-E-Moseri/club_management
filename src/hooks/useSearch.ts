import { useEffect, useState } from 'react';
import type { SearchResult } from '../types';
import type { AuthUser } from '../lib/auth';
import { globalSearch } from '../lib/queries/search';

export function useSearch(query: string, user: AuthUser | null, enabled: boolean) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !user || query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      globalSearch(query, user.id, user.role, user.cellId)
        .then(setResults)
        .catch((err) => setError(err instanceof Error ? err.message : 'Search failed.'))
        .finally(() => setLoading(false));
    }, 300);

    return () => window.clearTimeout(timer);
  }, [query, user, enabled]);

  return { results, loading, error };
}
