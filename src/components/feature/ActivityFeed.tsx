import React from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import type { ActivityItem } from '../../types';

const ICONS: Record<ActivityItem['type'], string> = {
  announcement: 'AN',
  testimony: 'TS',
  meeting: 'MT',
  contact: 'CT',
};

export const ActivityFeed: React.FC<{ items: ActivityItem[] }> = ({ items }) => {
  const navigate = useNavigate();

  if (items.length === 0) {
    return <p className="text-small text-gray-400">No recent activity yet.</p>;
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => item.href && navigate(item.href)}
          className="flex w-full items-start gap-3 rounded-md border border-gray-200 bg-white p-3 text-left transition-colors hover:bg-red-50"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-york-100 text-tiny font-bold text-york-700">
            {ICONS[item.type]}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-small font-bold text-gray-900">{item.title}</span>
            <span className="block text-tiny text-gray-400">
              {item.actor ? `${item.actor} - ` : ''}
              {formatDistanceToNow(new Date(item.timestamp), { addSuffix: true })}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
};
