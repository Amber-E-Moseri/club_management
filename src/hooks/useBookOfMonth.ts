import { useState, useEffect, useCallback } from 'react';
import type { BookOfMonth, BookOfMonthInput } from '../types';
import { getCurrentBook, getAllBooks, createBook, updateBook, deleteBook } from '../lib/queries/books';

export function useCurrentBook() {
  const [book, setBook] = useState<BookOfMonth | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCurrentBook()
      .then(setBook)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return { book, loading };
}

export function useBooks() {
  const [books, setBooks] = useState<BookOfMonth[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBooks(await getAllBooks());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load books.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (input: BookOfMonthInput, createdBy: string, id?: string) => {
    setSaving(true);
    setError(null);
    try {
      if (id) {
        const updated = await updateBook(id, input);
        setBooks((prev) => prev.map((b) => (b.id === id ? updated : b)));
      } else {
        const created = await createBook({ ...input, created_by: createdBy });
        setBooks((prev) => [created, ...prev]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
      throw e;
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    await deleteBook(id);
    setBooks((prev) => prev.filter((b) => b.id !== id));
  };

  return { books, loading, saving, error, refetch: load, save, remove };
}
