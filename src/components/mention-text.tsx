import { router } from "expo-router";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { supabase } from "../../lib/supabase";
import { showToast } from "./toast";

const MENTION_RE = /(@[a-zA-Z0-9_]{3,20})/g;

async function openMention(handle: string) {
  const username = handle.slice(1);
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .ilike("username", username)
    .maybeSingle();
  if (data?.id) {
    router.push({ pathname: "/user-profile" as any, params: { userId: data.id } });
  } else {
    showToast(`No user named ${handle}`, "info");
  }
}

/**
 * Renders text with @username mentions highlighted and tappable —
 * tapping opens that user's profile.
 */
export function MentionText({ children, style }: {
  children: string;
  style?: StyleProp<TextStyle>;
}) {
  const parts = children.split(MENTION_RE);
  if (parts.length === 1) return <Text style={style}>{children}</Text>;
  return (
    <Text style={style}>
      {parts.map((part, i) =>
        MENTION_RE.test(part) && part.startsWith("@") ? (
          <Text
            key={i}
            style={{ color: "#06b6d4", fontWeight: "700" }}
            onPress={() => openMention(part)}
            suppressHighlighting
          >
            {part}
          </Text>
        ) : (
          <Text key={i}>{part}</Text>
        ),
      )}
    </Text>
  );
}
