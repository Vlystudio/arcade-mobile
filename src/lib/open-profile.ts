import { router } from "expo-router";
import { supabase } from "../../lib/supabase";
import { showToast } from "../components/toast";

/** Navigate to a user's profile from anywhere. */
export function openUserProfile(userId: string) {
  if (!userId) return;
  router.push({ pathname: "/user-profile" as any, params: { userId } });
}

/** Same, when only a username is available (e.g. record holders). */
export async function openUserProfileByName(username: string) {
  if (!username || username === "Unknown") return;
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .ilike("username", username)
    .maybeSingle();
  if (data?.id) openUserProfile(data.id);
  else showToast(`Couldn't find ${username}`, "info");
}
