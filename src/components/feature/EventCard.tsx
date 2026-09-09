import React from 'react';
import { formatEventDate } from '../../lib/utils';
import { Badge, Button } from '../foundation';
import type { Event } from '../../types';

interface EventCardProps {
  event: Event;
  onRsvp?: (id: string) => void;
}

export const EventCard: React.FC<EventCardProps> = ({ event, onRsvp }) => {
  const { month, day } = formatEventDate(event.date);

  return (
    <div className="flex items-start gap-4 p-4 border-b border-gray-100 last:border-0">
      {/* Date bubble */}
      <div className="flex flex-col items-center justify-center w-12 h-14 bg-gray-100 rounded-md shrink-0">
        <span className="text-tiny font-bold text-york-600 uppercase">{month}</span>
        <span className="text-h2 font-bold text-gray-900 leading-none">{day}</span>
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <p className="text-small font-bold text-gray-900 truncate">{event.title}</p>
        <p className="text-tiny text-gray-400 mt-0.5">{event.time} · {event.location}</p>
        <Badge variant="gray" className="mt-1">{event.category}</Badge>
      </div>

      {/* RSVP */}
      {onRsvp && (
        event.user_rsvp ? (
          <span className="shrink-0 text-tiny font-bold text-success border border-success rounded-md px-3 py-1">
            RSVP'd
          </span>
        ) : (
          <Button
            variant="primary"
            className="shrink-0 !py-1 !px-3 text-tiny"
            onClick={() => onRsvp(event.id)}
          >
            RSVP
          </Button>
        )
      )}
    </div>
  );
};
