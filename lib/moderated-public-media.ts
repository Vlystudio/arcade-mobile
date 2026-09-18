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

  const moderation = await moderateImage({
    bucket: QUARANTINE_BUCKET,
    path: quarantinePath,
    recordType: params.recordType,
    recordId: params.recordId,
    contentType: params.contentType,
  });

  if (!moderation.ok) {
    await supabase.storage.from(QUARANTINE_BUCKET).remove([quarantinePath]);
    throw new Error(moderation.message);
  }

  const publicUrl = moderation.publishedUrl;
  if (!publicUrl) throw new Error("The image was not published. Please retry.");

  return {
    publicUrl: addCacheBuster(publicUrl),
    publicPath: moderation.publishedPath,
  };
}

function safePathName(path: string) {
  return path.replace(/[^a-z0-9._-]+/gi, "-").replace(/-+/g, "-").slice(-120) || "image.jpg";
}

function addCacheBuster(url: string) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}t=${Date.now()}`;
}
