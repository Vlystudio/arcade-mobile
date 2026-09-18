import { supabase } from "./supabase";
export type PublicIdentity = { id: string; username: string | null; avatar_url: string | null };
export async function publicProfilesById(ids: string[]): Promise<Map<string, PublicIdentity>> {
  const unique = [...new Set(ids.filter(id => typeof id === "string" && id.length > 0))];
  if (!unique.length) return new Map();
  const identities = new Map<string, PublicIdentity>();
  for (let start = 0; start < unique.length; start += 200) {
    const { data, error } = await supabase.from("public_profiles").select("id, username, avatar_url").in("id", unique.slice(start, start + 200));
    if (error) throw error;
    for (const profile of (data ?? []) as PublicIdentity[]) identities.set(profile.id, profile);
  }
  return identities;
}
