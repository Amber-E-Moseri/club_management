import { format, formatDistanceToNow, parseISO, isThisWeek } from 'date-fns';

export function formatEventDate(dateStr: string): { month: string; day: string } {
  const d = parseISO(dateStr);
  return { month: format(d, 'MMM').toUpperCase(), day: format(d, 'd') };
}

export function formatRelativeTime(dateStr: string): string {
  const d = parseISO(dateStr);
  return formatDistanceToNow(d, { addSuffix: true });
}

export function formatFullDate(dateStr: string): string {
  return format(parseISO(dateStr), 'EEEE, MMMM d, yyyy');
}

export function isEventThisWeek(dateStr: string): boolean {
  return isThisWeek(parseISO(dateStr));
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase();
}

export function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(' ');
}
