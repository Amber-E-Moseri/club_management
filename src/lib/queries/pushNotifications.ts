import { supabase } from '../supabase';
import type { PushSubscriptionRecord, PushNotificationLog, PushNotificationType, PushStatus } from '../../types';

export async function createPushSubscription(
  memberId: string,
  subscription: PushSubscription
): Promise<PushSubscriptionRecord> {
  const json = subscription.toJSON();
  const { data, error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        member_id: memberId,
        endpoint: subscription.endpoint,
        auth: json.keys?.auth ?? '',
        p256dh: json.keys?.p256dh ?? '',
        user_agent: navigator.userAgent.slice(0, 500),
        is_active: true,
        subscribed_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' }
    )
    .select()
    .single();
  if (error) throw new Error(error.message ?? 'Unknown error');
  return data;
}

export async function updatePushSubscription(id: string, lastUsed: string): Promise<void> {
  const { error } = await supabase
    .from('push_subscriptions')
    .update({ last_used: lastUsed })
    .eq('id', id);
  if (error) throw new Error(error.message ?? 'Unknown error');
}

export async function deletePushSubscription(id: string): Promise<void> {
  const { error } = await supabase.from('push_subscriptions').delete().eq('id', id);
  if (error) throw new Error(error.message ?? 'Unknown error');
}

export async function fetchPushSubscriptions(memberId: string): Promise<PushSubscriptionRecord[]> {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('member_id', memberId)
    .eq('is_active', true)
    .order('subscribed_at', { ascending: false });
  if (error) throw new Error(error.message ?? 'Unknown error');
  return data ?? [];
}

export interface PushLogInput {
  member_id: string;
  notification_type: PushNotificationType;
  title: string;
  body: string;
  status: PushStatus;
}

export async function createPushLog(input: PushLogInput): Promise<PushNotificationLog> {
  const { data, error } = await supabase
    .from('push_notification_log')
    .insert(input)
    .select()
    .single();
  if (error) throw new Error(error.message ?? 'Unknown error');
  return data;
}

export async function fetchPushLog(
  memberId: string,
  filter?: { type?: PushNotificationType }
): Promise<PushNotificationLog[]> {
  let q = supabase
    .from('push_notification_log')
    .select('*')
    .eq('member_id', memberId)
    .order('sent_at', { ascending: false })
    .limit(100);

  if (filter?.type) q = q.eq('notification_type', filter.type);

  const { data, error } = await q;
  if (error) throw new Error(error.message ?? 'Unknown error');
  return data ?? [];
}

/** Deactivate subscriptions not used in the last 30 days. */
export async function deactivateOldSubscriptions(): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const { error } = await supabase
    .from('push_subscriptions')
    .update({ is_active: false })
    .lt('last_used', cutoff.toISOString())
    .eq('is_active', true);
  if (error) throw new Error(error.message ?? 'Unknown error');
}
