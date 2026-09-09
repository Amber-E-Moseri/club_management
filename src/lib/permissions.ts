import type { AdminPermissionKey } from '../types';

export const ADMIN_PERMISSIONS: { key: AdminPermissionKey; label: string; group: string }[] = [
  { key: 'contacts.view_all', label: 'View all contacts', group: 'Contacts' },
  { key: 'contacts.write', label: 'Log and edit contacts', group: 'Contacts' },
  { key: 'attendance.view_all', label: 'View all attendance', group: 'Attendance' },
  { key: 'testimonies.view_all', label: 'View all testimonies', group: 'Testimonies' },
  { key: 'testimonies.approve', label: 'Approve testimonies', group: 'Testimonies' },
  { key: 'reports.generate', label: 'Generate reports', group: 'Reports' },
  { key: 'settings.manage_tags', label: 'Manage tags/statuses', group: 'Settings' },
  { key: 'devotionals.manage', label: 'Manage devotionals', group: 'Devotionals' },
  { key: 'notifications.send', label: 'Send reminders', group: 'Notifications' },
  { key: 'integrations.manage', label: 'Manage integrations', group: 'Integrations' },
];

export function groupPermissions() {
  return ADMIN_PERMISSIONS.reduce<Record<string, typeof ADMIN_PERMISSIONS>>((groups, permission) => {
    groups[permission.group] = groups[permission.group] ?? [];
    groups[permission.group].push(permission);
    return groups;
  }, {});
}
