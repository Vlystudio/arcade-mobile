import { supabase } from "./supabase";
import { moderateImage } from "./moderate-image";

const QUARANTINE_BUCKET = "media-quarantine";

type UploadBody = ArrayBuffer | Blob;

export async function uploadModeratedPublicImage(params: {
  ownerId: string;
  data: UploadBody;
  contentType: string;
  publicBucket: "avatars" | "post-photos" | "team-photos";
  publicPath: string;
  recordType: "avatar" | "post" | "team_photo";
  recordId: string;
}) {
  const quarantinePath = `${params.ownerId}/${params.publicBucket}/${Date.now()}-${safePathName(params.publicPath)}`;
  const { error: uploadError } = await supabase.storage
    .from(QUARANTINE_BUCKET)
    .upload(quarantinePath, params.data, {
      contentType: params.contentType,
      upsert: false,
    });
  if (uploadError) throw uploadError;

  const { data: signed, error: signedError } = await supabase.storage
    .from(QUARANTINE_BUCKET)
    .createSignedUrl(quarantinePath, 60);
  if (signedError || !signed?.signedUrl) {
    await supabase.storage.from(QUARANTINE_BUCKET).remove([quarantinePath]);
    throw new Error("Could not prepare image for moderation.");
  }

  const moderation = await moderateImage({
    imageUrl: signed.signedUrl,
    bucket: QUARANTINE_BUCKET,
    path: quarantinePath,
    recordType: params.recordType,
    recordId: params.recordId,
    publishToBucket: params.publicBucket,
    publishToPath: params.publicPath,
    contentType: params.contentType,
  });

  if (!moderation.ok) {
    await supabase.storage.from(QUARANTINE_BUCKET).remove([quarantinePath]);
    throw new Error(moderation.message);
  }

  const publicUrl = moderation.publishedUrl ??
    supabase.storage.from(params.publicBucket).getPublicUrl(params.publicPath).data.publicUrl;

  return {
    publicUrl: addCacheBuster(publicUrl),
    publicPath: params.publicPath,
  };
}

function safePathName(path: string) {
  return path.replace(/[^a-z0-9._-]+/gi, "-").replace(/-+/g, "-").slice(-120) || "image.jpg";
}

function addCacheBuster(url: string) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}t=${Date.now()}`;
}
