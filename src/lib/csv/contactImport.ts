import type { BulkImportRow } from '../../types';

/** Parse a CSV file text into import rows. Expects a header row. */
export function parseCSV(text: string): BulkImportRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (values[i] ?? '').trim(); });
    return {
      contact_name:      row['name'] || row['contact_name'] || '',
      phone:             row['phone'] || row['phone_number'] || '',
      email:             row['email'] || undefined,
      cell_name:         row['cell'] || row['cell_name'] || '',
      notes:             row['notes'] || undefined,
      tags:              row['tags'] || row['tag'] || undefined,
      follow_up_person:  row['follow_up_person'] || row['assigned_to'] || undefined,
    };
  }).filter((r) => r.contact_name);
}

/** Parse a pipe-delimited paste: "Name | Phone | Cell | Tags" (one per line). */
export function parseText(text: string): BulkImportRow[] {
  return text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const parts = line.split('|').map((p) => p.trim());
      return {
        contact_name: parts[0] || '',
        phone:        parts[1] || '',
        cell_name:    parts[2] || '',
        tags:         parts[3] || undefined,
        notes:        parts[4] || undefined,
        follow_up_person: parts[5] || undefined,
      };
    })
    .filter((r) => r.contact_name);
}

/** Validate a single import row. Returns list of error strings (empty = valid). */
export function validateRow(
  row: BulkImportRow,
  cells: { id: string; name: string }[],
): string[] {
  const errs: string[] = [];
  if (!row.contact_name || row.contact_name.length < 2)
    errs.push('Name must be at least 2 characters');
  if (!row.cell_name)
    errs.push('Cell name is required');
  else if (!cells.some((c) => c.name.toLowerCase() === row.cell_name.toLowerCase()))
    errs.push(`Cell "${row.cell_name}" not found`);
  if (row.phone) {
    const digits = row.phone.replace(/\D/g, '');
    if (digits.length < 10) errs.push('Phone must be at least 10 digits');
  }
  return errs;
}

/** Trigger a browser download of the CSV import template. */
export function downloadTemplate(): void {
  const header = 'Name,Phone,Email,Cell,Tags,Notes,Follow Up Person';
  const example = 'Jane Smith,4165550101,jane@example.com,Cell A,evangelism,Met at campus fair,';
  const content = [header, example].join('\n');
  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'contact-import-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}
