// Netlify Function: the ONLY path that writes to the database.
// It checks the shared edit password server-side, then performs the change with
// the Supabase service-role key (which the browser never sees). The submitted
// name is recorded against every change in the audit log.
import { createClient } from '@supabase/supabase-js';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { name, password, entity = 'event', action = 'upsert', payload, id } = body;

  if (!name || !name.trim()) return json({ error: 'A name is required to make changes.' }, 400);
  if (password !== process.env.EDIT_PASSWORD) return json({ error: 'Wrong edit password.' }, 401);

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
  const actor = name.trim();

  // map (entity, action) -> rpc name + id arg name
  const rpc = {
    event: { delete: ['api_delete_event', 'event_id'], upsert: ['api_upsert_event'] },
    department: { delete: ['api_delete_department', 'dept_id'], upsert: ['api_upsert_department'] },
  }[entity];
  if (!rpc) return json({ error: 'Unknown entity.' }, 400);

  try {
    if (action === 'delete') {
      if (id == null) return json({ error: 'Missing id for delete.' }, 400);
      const [fn, idArg] = rpc.delete;
      const { error } = await supabase.rpc(fn, { actor, [idArg]: id });
      if (error) throw error;
      return json({ ok: true });
    }
    const [fn] = rpc.upsert;
    const { data, error } = await supabase.rpc(fn, { actor, payload });
    if (error) throw error;
    return json({ ok: true, record: data, event: data });
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
};
