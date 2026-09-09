import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { buildDriveMetadata, validateDriveUrl } from '../lib/drive';
import type { DriveLinkMetadata } from '../types';

export interface UseDriveLinkResult {
  metadata: DriveLinkMetadata | null;
  saving: boolean;
  error: string | null;
  setUrl: (url: string) => void;
  saveToDb: (sourceTable: string, sourceId: string, ownerId: string) => Promise<boolean>;
  reset: () => void;
}

export function useDriveLink(initialUrl?: string): UseDriveLinkResult {
  const [metadata, setMetadata] = useState<DriveLinkMetadata | null>(
    initialUrl ? buildDriveMetadata(initialUrl) : null
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setUrl = useCallback((url: string) => {
    if (!url) {
      setMetadata(null);
      setError(null);
      return;
    }
    const validationError = validateDriveUrl(url);
    if (validationError) {
      setError(validationError);
      setMetadata(null);
      return;
    }
    setError(null);
    setMetadata(buildDriveMetadata(url));
  }, []);

  const saveToDb = useCallback(
    async (sourceTable: string, sourceId: string, ownerId: string): Promise<boolean> => {
      if (!metadata) return false;
      setSaving(true);
      setError(null);

      const { error: dbError } = await supabase.from('drive_link_metadata').insert({
        owner_id: ownerId,
        source_table: sourceTable,
        source_id: sourceId,
        url: metadata.url,
        file_id: metadata.file_id,
        title: metadata.title,
        resource_type: metadata.resource_type,
        thumbnail_url: metadata.thumbnail_url ?? null,
        embed_url: metadata.embed_url ?? null,
        permission_status: 'unchecked',
      });

      setSaving(false);

      if (dbError) {
        setError(dbError.message);
        return false;
      }
      return true;
    },
    [metadata]
  );

  const reset = useCallback(() => {
    setMetadata(null);
    setError(null);
  }, []);

  return { metadata, saving, error, setUrl, saveToDb, reset };
}
