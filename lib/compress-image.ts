import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { Platform } from "react-native";

const MAX_DIMENSION = 1920;
const COMPRESS_QUALITY = 0.75;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

export async function compressImage(uri: string): Promise<string> {
  if (Platform.OS === "web") {
    return uri;
  }
  try {
    // First pass: get current dimensions without transforms
    const probe = await manipulateAsync(uri, [], {
      compress: 1,
      format: SaveFormat.JPEG,
    });

    const actions: { resize: { width?: number; height?: number } }[] = [];
    if (probe.width > MAX_DIMENSION || probe.height > MAX_DIMENSION) {
      if (probe.width >= probe.height) {
        actions.push({ resize: { width: MAX_DIMENSION } });
      } else {
        actions.push({ resize: { height: MAX_DIMENSION } });
      }
    }

    const result = await manipulateAsync(uri, actions, {
      compress: COMPRESS_QUALITY,
      format: SaveFormat.JPEG,
    });

    return result.uri;
  } catch {
    // Compression failed — return original and let upload proceed
    return uri;
  }
}
