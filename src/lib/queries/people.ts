import { supabase } from '../supabase';
import type {
  Person,
  ContactRelationship,
  CreatePersonInput,
} from '../../types/person';

// ─── Person creation ──────────────────────────────────────────────────────────

/**
 * Creates a minimal people record.
 * Callers are responsible for duplicate-checking before calling this.
 */
export async function createPerson(input: CreatePersonInput): Promise<Person> {
  const { data, error } = await supabase
    .from('people')
    .insert({
      full_name: input.fullName.trim(),
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
    })
    .select('id, full_name, email, phone, created_at, updated_at')
    .single();

  if (error) throw new Error(error.message);
  return mapPerson(data);
}

/**
 * Creates a person + contact relationship in a single logical operation.
 * This is the entry point for the "Log new contact" workflow.
 * Enforces ONE HUMAN = ONE PERSON RECORD by returning an existing person
 * when a matching email is found rather than creating a duplicate.
 */
export async function createContactPerson(input: {
  fullName: string;
  email?: string | null;
  phone?: string | null;
  cellId: string;
  loggedBy: string;
  tag?: string | null;
  notes?: string | null;
  dateContacted?: string;
  idempotencyKey?: string;
}): Promise<{ person: Person; contact: ContactRelationship }> {
  // Duplicate guard: a confirmed email may identify the same person. Phone-only
  // matches are ambiguous and must be resolved by explicit staff review.
  let personId: string | null = null;
  if (input.email) {
    const { data: existing } = await supabase
      .from('people')
      .select('id')
      .eq('email', input.email.trim())
      .maybeSingle();
    if (existing) personId = existing.id as string;
  }

  // Create person if not found
  if (!personId) {
    const person = await createPerson({
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
    });
    personId = person.id;
  }

  // Fetch the person row (either found or freshly created)
  const { data: personRow, error: personErr } = await supabase
    .from('people')
    .select('id, full_name, email, phone, created_at, updated_at')
    .eq('id', personId)
    .single();
  if (personErr || !personRow) throw new Error(personErr?.message ?? 'Person not found after create');

  // Create contact relationship
  const { data: contactRow, error: contactErr } = await supabase
    .from('contacts')
    .insert({
      person_id: personId,
      contact_name: input.fullName.trim(),
      contact_phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      cell_id: input.cellId,
      logged_by: input.loggedBy,
      tag: input.tag ?? null,
      notes: input.notes ?? null,
      date_contacted: input.dateContacted ?? new Date().toISOString().split('T')[0],
      idempotency_key: input.idempotencyKey ?? null,
    })
    .select(
      'id, person_id, cell_id, tag, follow_up_status, follow_up_assignee, ' +
      'date_contacted, notes, logged_by, archived, is_member, member_id'
    )
    .single();

  if (contactErr && input.idempotencyKey && /duplicate key|unique/i.test(contactErr.message ?? '')) {
    const { data: existingContact, error: existingErr } = await supabase
      .from('contacts')
      .select(
        'id, person_id, cell_id, tag, follow_up_status, follow_up_assignee, ' +
        'date_contacted, notes, logged_by, archived, is_member, member_id'
      )
      .eq('logged_by', input.loggedBy)
      .eq('idempotency_key', input.idempotencyKey)
      .maybeSingle();
    if (existingErr) throw new Error(existingErr.message);
    if (existingContact) {
      return {
        person: mapPerson(personRow as unknown as Record<string, unknown>),
        contact: mapContact(existingContact as unknown as Record<string, unknown>),
      };
    }
  }

  if (contactErr || !contactRow) throw new Error(contactErr?.message ?? 'Contact insert failed');

  return {
    person: mapPerson(personRow as unknown as Record<string, unknown>),
    contact: mapContact(contactRow as unknown as Record<string, unknown>),
  };
}

// ─── Person lookup ────────────────────────────────────────────────────────────

export async function findPersonByEmail(email: string): Promise<Person | null> {
  const { data } = await supabase
    .from('people')
    .select('id, full_name, email, phone, created_at, updated_at')
    .eq('email', email.trim())
    .maybeSingle();
  return data ? mapPerson(data) : null;
}

export async function findPersonByPhone(phone: string): Promise<Person | null> {
  const { data } = await supabase
    .from('people')
    .select('id, full_name, email, phone, created_at, updated_at')
    .eq('phone', phone.trim())
    .maybeSingle();
  return data ? mapPerson(data) : null;
}

export async function findPersonById(id: string): Promise<Person | null> {
  const { data } = await supabase
    .from('people')
    .select('id, full_name, email, phone, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();
  return data ? mapPerson(data) : null;
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function mapPerson(row: Record<string, unknown>): Person {
  return {
    id: row['id'] as string,
    fullName: row['full_name'] as string,
    email: (row['email'] as string | null) ?? null,
    phone: (row['phone'] as string | null) ?? null,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}

function mapContact(row: Record<string, unknown>): ContactRelationship {
  return {
    id: row['id'] as string,
    personId: row['person_id'] as string,
    cellId: (row['cell_id'] as string | null) ?? null,
    tag: (row['tag'] as string | null) ?? null,
    followUpStatus: (row['follow_up_status'] as string | null) ?? null,
    followUpAssignee: (row['follow_up_assignee'] as string | null) ?? null,
    dateContacted: row['date_contacted'] as string,
    notes: (row['notes'] as string | null) ?? null,
    loggedBy: row['logged_by'] as string,
    archived: (row['archived'] as boolean) ?? false,
    isMember: (row['is_member'] as boolean) ?? false,
    memberId: (row['member_id'] as string | null) ?? null,
  };
}
