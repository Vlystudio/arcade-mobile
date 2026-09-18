import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.0";
import { RekognitionClient, DetectModerationLabelsCommand } from "https://esm.sh/@aws-sdk/client-rekognition@3.1135.0";
import { corsHeaders, handleCors, rejectDisallowedOrigin } from "../_shared/cors.ts";
import { readStorageImage } from "../_shared/image-bytes.ts";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SUPA_SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const blocked = new Set(["Explicit Nudity", "Nudity", "Partial Nudity", "Suggestive",
  "Violence", "Graphic Violence", "Graphic Violence Or Gore", "Visually Disturbing", "Hate Symbols"]);
const safePath = (path: unknown): path is string => typeof path === "string" &&
  path.length < 512 && path.split("/").every((part) => /^[a-zA-Z0-9._-]+$/.test(part) && part !== "." && part !== "..");

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  const rejected = rejectDisallowedOrigin(req);
  if (rejected) return rejected;
  const headers = corsHeaders(req);
  const reply = (status: number, body: unknown) => Response.json(body, { status, headers });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });
  const admin = createClient(SUPA_URL, SUPA_SVC, { auth: { persistSession: false } });
  const token = req.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return reply(401, { error: "unauthorized" });
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) return reply(401, { error: "unauthorized" });
  const uid = auth.user.id;
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return reply(400, { error: "invalid_json" }); }
  if (!body || !safePath(body.path)) return reply(400, { error: "invalid_path" });
  const { bucket, path, record_type, record_id } = body;
  let targetBucket: string | undefined;
  let targetPath: string | undefined;
  const denied = () => reply(403, { error: "forbidden" });
  if (record_type === "message_photo") {
    const pieces = path.split("/");
    if (bucket !== "message-media" || pieces.length !== 3 || pieces[1] !== uid) return denied();
    const { data: member, error } = await admin.from("conversations")
      .select("id").eq("id", pieces[0]).or(`participant_1.eq.${uid},participant_2.eq.${uid}`).maybeSingle();
    if (error || !member) return denied();
  } else {
    if (bucket !== "media-quarantine" || path.split("/")[0] !== uid) return denied();
    targetBucket = ({ avatar: "avatars", post: "post-photos", team_photo: "team-photos" } as Record<string, string>)[record_type];
    if (!targetBucket || path.split("/")[1] !== targetBucket) return denied();
    if (record_type === "avatar") {
      if (record_id !== uid) return denied();
      targetPath = `${uid}/avatar.jpg`;
    } else if (record_type === "post") {
      if (record_id) {
        const { data: post, error } = await admin.from("posts").select("user_id").eq("id", record_id).maybeSingle();
        if (error || post?.user_id !== uid) return denied();
      }
      // A quarantine object's identity determines its unique public destination.
      targetPath = `${uid}/${path.split("/").at(-1)}`;
    } else {
      const { data: member, error } = await admin.from("team_members").select("role")
        .eq("team_id", record_id).eq("user_id", uid).eq("role", "captain").maybeSingle();
      if (error) return denied();
      if (!member) {
        const { data: team, error: teamError } = await admin.from("teams").select("id")
          .eq("id", record_id).eq("captain_user_id", uid).maybeSingle();
        if (teamError || !team) return denied();
      }
      targetPath = `${record_id}/photo.jpg`;
    }
  }
  try {
    // Derive the URL on the server; image_url and publish_to_* from callers are ignored.
    const { data: signed, error: signedError } = await admin.storage.from(bucket).createSignedUrl(path, 60);
    if (signedError || !signed?.signedUrl) return reply(404, { error: "image_not_found" });
    const bytes = await readStorageImage(signed.signedUrl);
    const accessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID");
    const secretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY");
    if (!accessKeyId || !secretAccessKey) return reply(503, { ok: false, pending_review: true, error: "moderation_unavailable" });
    const rekognition = new RekognitionClient({
      region: Deno.env.get("AWS_REGION") ?? "us-east-1",
      credentials: { accessKeyId, secretAccessKey },
    });
    const { ModerationLabels = [] } = await rekognition.send(new DetectModerationLabelsCommand({
      Image: { Bytes: bytes }, MinConfidence: 70,
    }), { abortSignal: AbortSignal.timeout(15_000) });
    const labels = ModerationLabels.filter((label) => blocked.has(label.Name ?? "") || blocked.has(label.ParentName ?? ""));
    if (labels.length) {
      const { error } = await admin.storage.from(bucket).remove([path]);
      if (error) throw error;
      return reply(200, { ok: false, flagged: true, message: "Please choose a photo that follows our community guidelines." });
    }
    if (!targetBucket || !targetPath) return reply(200, { ok: true, flagged: false });
    const contentType = ["image/jpeg", "image/png", "image/webp"].includes(body.content_type) ? body.content_type : "image/jpeg";
    const { error: uploadError } = await admin.storage.from(targetBucket).upload(targetPath, bytes, {
      contentType, upsert: true,
    });
    if (uploadError) throw uploadError;
    const { error: ownershipError } = await admin.from("media_ownership").upsert({
      bucket_id: targetBucket, path: targetPath, user_id: uid,
    }, { onConflict: "bucket_id,path" });
    if (ownershipError) throw ownershipError;
    const { data: published } = admin.storage.from(targetBucket).getPublicUrl(targetPath);
    // Publication succeeded. A cleanup failure is recoverable and never changes ownership.
    const { error: cleanupError } = await admin.storage.from(bucket).remove([path]);
    if (cleanupError) console.warn("Quarantine cleanup failed", cleanupError.message);
    return reply(200, { ok: true, flagged: false, published_url: published.publicUrl, published_path: targetPath });
  } catch (error) {
    console.error("Image moderation unavailable", error instanceof Error ? error.message : "unknown");
    return reply(503, { ok: false, pending_review: true, error: "moderation_unavailable",
      message: "Your image could not be verified. Please try again." });
  }
});
