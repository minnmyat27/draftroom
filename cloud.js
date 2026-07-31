import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config.js";

let clientPromise;

async function getClient() {
  if (!clientPromise) {
    clientPromise = import("https://esm.sh/@supabase/supabase-js@2.110.8").then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      }),
    );
  }
  return clientPromise;
}

function fromCloud(row) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    tags: row.tags ?? [],
    favorite: row.favorite,
    archived: row.archived,
    ownerId: row.user_id,
    accessRole: row.accessRole ?? null,
    cloudPersisted: true,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

function toCloud(note, userId) {
  return {
    id: note.id,
    user_id: note.ownerId ?? userId,
    title: note.title,
    content: note.content,
    tags: note.tags,
    favorite: note.favorite,
    archived: note.archived,
    created_at: new Date(note.createdAt).toISOString(),
    updated_at: new Date(note.updatedAt).toISOString(),
  };
}

export async function getSession() {
  const client = await getClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function signIn(email, password) {
  const client = await getClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

export async function signUp(email, password) {
  const client = await getClient();
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${window.location.origin}/app.html` },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const client = await getClient();
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export async function fetchCloudNotes() {
  const client = await getClient();
  const { data, error } = await client.from("notes").select("*").order("updated_at", {
    ascending: false,
  });
  if (error) throw error;
  const noteIds = data.map((note) => note.id);
  let membershipByNote = new Map();

  if (noteIds.length) {
    const { data: memberships, error: membershipError } = await client
      .from("note_members")
      .select("note_id, role")
      .in("note_id", noteIds);
    if (!membershipError) {
      membershipByNote = new Map(memberships.map((membership) => [membership.note_id, membership.role]));
    }
  }

  return data.map((row) =>
    fromCloud({ ...row, accessRole: membershipByNote.get(row.id) ?? "owner" }),
  );
}

export async function saveCloudNote(note, userId) {
  const client = await getClient();
  const mutable = {
    title: note.title,
    content: note.content,
    tags: note.tags,
    favorite: note.favorite,
    archived: note.archived,
    updated_at: new Date(note.updatedAt).toISOString(),
  };

  if (note.ownerId) {
    const { data: updated, error: updateError } = await client
      .from("notes")
      .update(mutable)
      .eq("id", note.id)
      .select("*")
      .maybeSingle();
    if (updateError) throw updateError;
    if (updated) return fromCloud(updated);
    if (note.ownerId !== userId) throw new Error("You no longer have permission to edit this note");
  }

  const { data, error } = await client
    .from("notes")
    .insert(toCloud(note, userId))
    .select("*")
    .single();
  if (error) throw error;
  return fromCloud(data);
}

export async function deleteCloudNote(id) {
  const client = await getClient();
  const { error } = await client.from("notes").delete().eq("id", id);
  if (error) throw error;
}

export async function mergeNotes(localNotes, userId) {
  const cloudNotes = await fetchCloudNotes();
  const localById = new Map(localNotes.map((note) => [note.id, note]));
  const cloudById = new Map(cloudNotes.map((note) => [note.id, note]));
  const merged = new Map();
  const uploads = [];

  for (const local of localNotes) {
    const cloud = cloudById.get(local.id);
    if (local.ownerId && local.ownerId !== userId && !cloud) continue;
    if (cloud?.accessRole === "viewer") {
      merged.set(cloud.id, cloud);
      continue;
    }
    if (!cloud || local.updatedAt > cloud.updatedAt) {
      local.ownerId ??= userId;
      local.accessRole ??= "owner";
      merged.set(local.id, local);
      uploads.push(saveCloudNote(local, userId));
    } else {
      merged.set(cloud.id, cloud);
    }
  }

  for (const cloud of cloudNotes) {
    if (!localById.has(cloud.id)) merged.set(cloud.id, cloud);
  }

  await Promise.all(uploads);
  return [...merged.values()];
}

export async function createNoteInvite(noteId, role) {
  const client = await getClient();
  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser();
  if (userError || !user) throw userError ?? new Error("Authentication required");

  const { data, error } = await client
    .from("note_invites")
    .insert({ note_id: noteId, role, created_by: user.id })
    .select("token, role, expires_at")
    .single();
  if (error) throw error;
  return data;
}

export async function redeemNoteInvite(token) {
  const client = await getClient();
  const { data, error } = await client.rpc("redeem_note_invite", { invite_token: token });
  if (error) throw error;
  return data;
}

export async function subscribeToNote(noteId, onChange) {
  const client = await getClient();
  const channel = client
    .channel(`note-${noteId}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "notes", filter: `id=eq.${noteId}` },
      (payload) => onChange(fromCloud(payload.new)),
    )
    .subscribe();

  return () => client.removeChannel(channel);
}
