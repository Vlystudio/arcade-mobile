import { corsHeaders, handleCors, rejectDisallowedOrigin } from "../_shared/cors.ts";

const RESEND_API_KEY  = Deno.env.get("RESEND_API_KEY")  ?? "";
const NOTIFY_SECRET   = Deno.env.get("NOTIFY_SECRET")   ?? "";
const TO_EMAIL        = "valeyardvisuals@gmail.com";
const FROM_EMAIL      = "ArcadeTracker <noreply@vlystudios.com>";

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  const rejectedOrigin = rejectDisallowedOrigin(req);
  if (rejectedOrigin) return rejectedOrigin;
  const CORS = corsHeaders(req);

  if (req.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers: CORS });
  }

  if (!NOTIFY_SECRET || req.headers.get("x-notify-secret") !== NOTIFY_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: CORS });
  }

  if (!RESEND_API_KEY) {
    return Response.json({ error: "email_unavailable" }, { status: 503, headers: CORS });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400, headers: CORS });
  }
  const { category, message, rating, username, app_version } = body;

  const ratingLine  = rating   ? `Rating:   ${rating}/5\n`    : "";
  const versionLine = app_version ? `Version:  ${app_version}\n` : "";

  const text = [
    `Category: ${category}`,
    ratingLine.trim(),
    `User:     ${username ?? "unknown"}`,
    versionLine.trim(),
    "",
    message,
  ].filter(Boolean).join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to:   TO_EMAIL,
      subject: `[ArcadeTracker] ${category} feedback${rating ? ` · ${rating}/5 ★` : ""}`,
      text,
    }),
  });

  const resBody = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.error("Resend error:", JSON.stringify(resBody));
    return Response.json({ error: "email_send_failed" }, { status: 502, headers: CORS });
  }

  console.log("Resend accepted:", JSON.stringify(resBody));
  return Response.json({ ok: true }, { status: 200, headers: CORS });
});
