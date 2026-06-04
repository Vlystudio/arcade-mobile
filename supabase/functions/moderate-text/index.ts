// Supabase Edge Function — moderate-text (OpenAI Moderation API)
// Checks any user-generated text for hate speech, harassment, sexual content,
// violence, and self-harm using OpenAI's free /v1/moderations endpoint.
// Fails open — if the key is missing or the API errors, the content is allowed.
//
// Required env var (set in Supabase Dashboard → Edge Functions → Secrets):
//   OPENAI_API_KEY

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

const CATEGORY_LABELS: Record<string, string> = {
  "hate":                   "hate speech",
  "hate/threatening":       "threatening hate speech",
  "harassment":             "harassment",
  "harassment/threatening": "threatening harassment",
  "self-harm":              "self-harm content",
  "self-harm/intent":       "self-harm intent",
  "self-harm/instructions": "self-harm instructions",
  "sexual":                 "sexual content",
  "sexual/minors":          "sexual content involving minors",
  "violence":               "violent content",
  "violence/graphic":       "graphic violence",
};

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST")
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers: CORS });

  if (!OPENAI_KEY) {
    console.warn("[moderate-text] OPENAI_API_KEY not configured — skipping");
    return Response.json({ flagged: false, skipped: true }, { headers: CORS });
  }

  const { text } = await req.json() as { text: string };
  if (!text?.trim()) return Response.json({ flagged: false }, { headers: CORS });

  try {
    const res = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({ input: text }),
    });

    if (!res.ok) {
      console.warn("[moderate-text] OpenAI API error:", res.status);
      return Response.json({ flagged: false }, { headers: CORS });
    }

    const data = await res.json();
    const result = data.results?.[0];
    if (!result?.flagged) return Response.json({ flagged: false }, { headers: CORS });

    const triggered = Object.entries(result.categories as Record<string, boolean>)
      .filter(([, v]) => v)
      .map(([k]) => CATEGORY_LABELS[k] ?? k);

    const reason = triggered.length > 0
      ? `Your message was flagged for ${triggered.join(" and ")}. Please revise and try again.`
      : "Your message was flagged by our content filter. Please revise and try again.";

    return Response.json({ flagged: true, reason, categories: triggered }, { headers: CORS });
  } catch (err: any) {
    console.error("[moderate-text] unexpected error:", err?.message ?? err);
    return Response.json({ flagged: false }, { headers: CORS });
  }
});
