const RESEND_API_KEY  = Deno.env.get("RESEND_API_KEY")  ?? "";
const NOTIFY_SECRET   = Deno.env.get("NOTIFY_SECRET")   ?? "";
const TO_EMAIL        = "valeyardvisuals@gmail.com";
const FROM_EMAIL      = "ArcadeTracker <noreply@vlystudios.com>";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  if (!NOTIFY_SECRET || req.headers.get("x-notify-secret") !== NOTIFY_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), { status: 500 });
  }

  const { category, message, rating, username, app_version } = await req.json();

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
    return new Response(JSON.stringify({ error: resBody }), { status: 502 });
  }

  console.log("Resend accepted:", JSON.stringify(resBody));
  return new Response(JSON.stringify({ ok: true, resend: resBody }), { status: 200 });
});
