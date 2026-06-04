import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";
import { checkRateLimit } from "../_ratelimit";

const MIN_CONFIDENCE = 75;
const FLAGGED_PARENT_CATEGORIES = [
  "Explicit Nudity", "Nudity", "Graphic Violence", "Violence", "Visually Disturbing",
];

// ─── Manual SigV4 signing (no AWS SDK needed) ─────────────────────────────────

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function hashHex(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  const kDate = hmac("AWS4" + secret, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

async function rekognitionDetect(
  imageBytes: Buffer,
  region: string,
  accessKeyId: string,
  secretAccessKey: string
): Promise<any> {
  const service = "rekognition";
  const host = `rekognition.${region}.amazonaws.com`;
  const target = "RekognitionService.DetectModerationLabels";

  const bodyStr = JSON.stringify({
    Image: { Bytes: imageBytes.toString("base64") },
    MinConfidence: MIN_CONFIDENCE,
  });

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, "").replace("T", "T").slice(0, 16) + "00Z";
  const dateStamp = amzDate.slice(0, 8);

  const bodyHash = hashHex(bodyStr);
  const canonicalHeaders =
    `content-type:application/x-amz-json-1.1\nhost:${host}\nx-amz-date:${amzDate}\nx-amz-target:${target}\n`;
  const signedHeaders = "content-type;host;x-amz-date;x-amz-target";
  const canonicalReq = ["POST", "/", "", canonicalHeaders, signedHeaders, bodyHash].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, hashHex(canonicalReq)].join("\n");

  const sig = hmac(signingKey(secretAccessKey, dateStamp, region, service), stringToSign).toString("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${sig}`;

  const resp = await fetch(`https://${host}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "Host": host,
      "X-Amz-Date": amzDate,
      "X-Amz-Target": target,
      "Authorization": authorization,
    },
    body: bodyStr,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Rekognition ${resp.status}: ${errText}`);
  }
  return resp.json();
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!(await checkRateLimit(req, res))) return;

  const { imageUrl } = req.body ?? {};
  if (typeof imageUrl !== "string") return res.status(400).json({ error: "imageUrl required" });

  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const region = process.env.AWS_REGION ?? "us-east-1";

  if (!accessKeyId || !secretAccessKey) {
    return res.json({ flagged: false, reason: "moderation_unavailable" });
  }

  try {
    const imgResp = await fetch(imageUrl);
    if (!imgResp.ok) return res.status(400).json({ error: "could not fetch image" });
    const buffer = Buffer.from(await imgResp.arrayBuffer());

    const result = await rekognitionDetect(buffer, region, accessKeyId, secretAccessKey);

    const flaggedLabels: string[] = (result.ModerationLabels ?? [])
      .filter((l: any) =>
        FLAGGED_PARENT_CATEGORIES.some(
          (cat) => l.ParentName === cat || l.Name === cat
        )
      )
      .map((l: any) => l.Name as string);

    if (flaggedLabels.length > 0) {
      return res.json({ flagged: true, labels: flaggedLabels });
    }
    return res.json({ flagged: false });
  } catch (err: any) {
    console.error("Rekognition error:", err?.message);
    return res.json({ flagged: false, reason: "moderation_error" });
  }
}
