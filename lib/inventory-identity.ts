import {db} from '@/lib/database';

export type InventoryUser = {id: string; name: string; role: string; active: number; email: string};

export async function inventoryUser(signedIn: {id: string; email?: string; user_metadata: Record<string, unknown>}) {
  if (!signedIn.email) return null;
  const email = signedIn.email.toLowerCase();
  const find = () => db.prepare('SELECT id,name,role,active,email FROM users WHERE id=? OR email=? ORDER BY (id=?) DESC LIMIT 1')
    .bind(signedIn.id, email, signedIn.id).first<InventoryUser>();
  const existing = await find();
  if (existing) return existing;

  // Preserve first-run setup. An existing workspace only admits registered staff.
  await db.prepare(
    'INSERT INTO users(id,email,name,role,active,created_at) SELECT ?,?,?,?,1,? WHERE NOT EXISTS (SELECT 1 FROM users) ON CONFLICT DO NOTHING',
  ).bind(signedIn.id, email, String(signedIn.user_metadata.full_name || signedIn.user_metadata.name || email),
    'Admin', new Date().toISOString()).run();
  return find();
}
