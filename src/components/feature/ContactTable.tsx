import React, { useState, useMemo } from 'react';
import { cn } from '../../lib/utils';
import { Tag } from '../foundation/Tag';
import { Button } from '../foundation/Button';
import type { Contact, ContactTag, ContactStatus, SortState } from '../../types';

interface Props {
  contacts: Contact[];
  tags: ContactTag[];
  statuses: ContactStatus[];
  canEdit: boolean;
  showPhone: boolean;
  onEdit: (c: Contact) => void;
  onReassign?: (c: Contact) => void;
  onMove?: (c: Contact) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onBulkArchive?: (ids: string[]) => void;
  onBulkDelete?: (ids: string[]) => void;
  pageSize?: number;
}

const COLS = [
  { key: 'contact_name',     label: 'Name',           sortable: true  },
  { key: 'contact_phone',    label: 'Phone',          sortable: false },
  { key: 'tag',              label: 'Tag',            sortable: true  },
  { key: 'follow_up_status', label: 'Status',         sortable: true  },
  { key: 'date_contacted',   label: 'Date Contacted', sortable: true  },
  { key: 'actions',          label: '',               sortable: false },
];

function maskPhone(phone?: string) {
  if (!phone) return '—';
  const d = phone.replace(/\D/g, '');
  return `***-***-${d.slice(-4)}`;
}

export const ContactTable: React.FC<Props> = ({
  contacts, tags, statuses, canEdit, showPhone,
  onEdit, onReassign, onMove, onArchive, onDelete, onBulkArchive, onBulkDelete,
  pageSize = 25,
}) => {
  const [sort, setSort] = useState<SortState>({ column: 'date_contacted', dir: 'desc' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);

  const tagMap = useMemo(() =>
    Object.fromEntries(tags.map((t) => [t.tag_name, t.color])), [tags]);
  const statusMap = useMemo(() =>
    Object.fromEntries(statuses.map((s) => [s.status_name, s.color])), [statuses]);

  const sorted = useMemo(() => {
    const col = sort.column as keyof Contact;
    return [...contacts].sort((a, b) => {
      const av = String(a[col] ?? '');
      const bv = String(b[col] ?? '');
      return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [contacts, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paginated = sorted.slice((page - 1) * pageSize, page * pageSize);

  const toggleSort = (col: string) => {
    setSort((s) => s.column === col
      ? { column: col, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { column: col, dir: 'asc' }
    );
    setPage(1);
  };

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(paginated.map((c) => c.id)) : new Set());
  };
  const toggleOne = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sort.column !== col) return <span className="text-gray-300 ml-1">↕</span>;
    return <span className="text-york-600 ml-1">{sort.dir === 'asc' ? '↑' : '↓'}</span>;
  };

  if (contacts.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg py-16 text-center">
        <p className="text-2xl mb-2">📋</p>
        <p className="text-base font-semibold text-gray-700">No contacts yet</p>
        <p className="text-sm text-gray-400 mt-1">Add your first contact using the button above.</p>
      </div>
    );
  }

  const selArray = Array.from(selected);

  return (
    <div className="space-y-3">
      {/* Bulk actions bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 bg-red-50 border border-york-600/20 rounded-lg px-4 py-2">
          <span className="text-sm font-semibold text-york-700">
            {selected.size} selected
          </span>
          {onBulkArchive && (
            <Button size="small" variant="secondary" onClick={() => { onBulkArchive(selArray); setSelected(new Set()); }}>
              Archive all
            </Button>
          )}
          {onBulkDelete && (
            <Button size="small" variant="danger" onClick={() => { onBulkDelete(selArray); setSelected(new Set()); }}>
              Delete all
            </Button>
          )}
          <button className="ml-auto text-xs text-gray-500 hover:text-gray-800" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      {/* Desktop table */}
      <div className="hidden md:block bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={paginated.length > 0 && paginated.every((c) => selected.has(c.id))}
                    onChange={(e) => toggleAll(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-york-600 focus:ring-york-600"
                  />
                </th>
                {COLS.map((col) => (
                  <th
                    key={col.key}
                    className={cn(
                      'px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap',
                      col.sortable && 'cursor-pointer select-none hover:text-gray-800'
                    )}
                    onClick={col.sortable ? () => toggleSort(col.key) : undefined}
                  >
                    {col.label}
                    {col.sortable && <SortIcon col={col.key} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.map((c, i) => (
                <tr
                  key={c.id}
                  className={cn(
                    'border-b border-gray-100 transition-colors',
                    selected.has(c.id)
                      ? 'bg-red-50'
                      : i % 2 === 0 ? 'bg-white hover:bg-red-50/40' : 'bg-gray-50/50 hover:bg-red-50/40'
                  )}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggleOne(c.id)}
                      className="w-4 h-4 rounded border-gray-300 text-york-600 focus:ring-york-600"
                    />
                  </td>
                  <td className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap">
                    <button
                      className="hover:text-york-600 transition-colors text-left"
                      onClick={() => onEdit(c)}
                    >
                      {c.contact_name}
                    </button>
                    {c.is_member && (
                      <span className="ml-2 text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">
                        Member
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {c.phone_hidden && !showPhone ? (
                      <span className="flex items-center gap-1">
                        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        {maskPhone(c.contact_phone)}
                      </span>
                    ) : (
                      c.contact_phone ?? '—'
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Tag color={tagMap[c.tag] ?? '#666'} variant="light">{c.tag}</Tag>
                  </td>
                  <td className="px-4 py-3">
                    <Tag color={statusMap[c.follow_up_status] ?? '#666'} variant="light">
                      {c.follow_up_status}
                    </Tag>
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {c.date_contacted}
                  </td>
                  <td className="px-4 py-3">
                    {canEdit && (
                      <div className="flex items-center gap-1">
                        <button
                          title="Edit"
                          onClick={() => onEdit(c)}
                          className="p-1.5 rounded text-gray-400 hover:text-york-600 hover:bg-red-50 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          title="Reassign follow-up"
                          onClick={() => onReassign?.(c)}
                          className="p-1.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-5-3.87M9 20H4v-2a4 4 0 015-3.87m0 0a4 4 0 108 0m-8 0a4 4 0 018 0M12 7a4 4 0 100-8 4 4 0 000 8z" />
                          </svg>
                        </button>
                        <button
                          title="Move to cell"
                          onClick={() => onMove?.(c)}
                          className="p-1.5 rounded text-gray-400 hover:text-green-600 hover:bg-green-50 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                          </svg>
                        </button>
                        <button
                          title={c.archived ? 'Unarchive' : 'Archive'}
                          onClick={() => onArchive(c.id)}
                          className="p-1.5 rounded text-gray-400 hover:text-orange-500 hover:bg-orange-50 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                          </svg>
                        </button>
                        <button
                          title="Delete"
                          onClick={() => {
                            if (window.confirm(`Delete contact "${c.contact_name}"?`)) onDelete(c.id);
                          }}
                          className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {paginated.map((c) => (
          <div
            key={c.id}
            className="bg-white border border-gray-200 rounded-lg p-4 space-y-2"
            onClick={() => canEdit && onEdit(c)}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-gray-900">{c.contact_name}</p>
                <p className="text-xs text-gray-400">{c.date_contacted}</p>
              </div>
              <Tag color={tagMap[c.tag] ?? '#666'} variant="light">{c.tag}</Tag>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Tag color={statusMap[c.follow_up_status] ?? '#666'} variant="light">
                {c.follow_up_status}
              </Tag>
              {c.is_member && (
                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                  Member
                </span>
              )}
            </div>
            {c.contact_phone && (
              <p className="text-sm text-gray-500">
                {c.phone_hidden && !showPhone ? maskPhone(c.contact_phone) : c.contact_phone}
              </p>
            )}
            {canEdit && (
              <div className="flex gap-2 pt-2">
                <Button size="small" variant="secondary" onClick={(e) => { e.stopPropagation(); onReassign?.(c); }}>
                  Reassign
                </Button>
                <Button size="small" variant="secondary" onClick={(e) => { e.stopPropagation(); onMove?.(c); }}>
                  Move
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-1">
          <p className="text-sm text-gray-500">
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, sorted.length)} of {sorted.length}
          </p>
          <div className="flex gap-2">
            <Button size="small" variant="secondary" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
              ← Prev
            </Button>
            <Button size="small" variant="secondary" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>
              Next →
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
