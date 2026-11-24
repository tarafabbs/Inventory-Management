import {db} from '@/lib/database';
import {createClient} from '@/lib/supabase/server';
import type {User} from '@supabase/supabase-js';

export type InventoryUser = {id: string; name: string; role: string; active: number; email: string};

export async function inventoryUser(signedIn: User) {
  const email = signedIn.email?.trim().toLowerCase();
  if (!email) return null;
  const verified = signedIn.identities?.some(identity =>
    identity.provider === 'google' &&
    identity.identity_data?.email_verified === true &&
    String(identity.identity_data.email || '').trim().toLowerCase() === email,
  );
  if (!verified) return null;
  return db.prepare('SELECT id,name,role,active,email FROM users WHERE lower(email)=?')
    .bind(email).first<InventoryUser>();
}

export async function inventorySession() {
  const supabase = await createClient();
  const {data: {user}} = await supabase.auth.getUser();
  if (!user) return {signedIn: false, staff: null};
  const {data} = await supabase.auth.getClaims();
  const amr = data?.claims.amr;
  const oauth = Array.isArray(amr) && amr.some(entry => (typeof entry === 'string' ? entry : entry.method) === 'oauth');
  const staff = oauth && data?.claims.sub === user.id ? await inventoryUser(user) : null;
  return {signedIn: true, staff: staff?.active ? staff : null};
}
