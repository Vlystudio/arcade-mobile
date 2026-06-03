import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";

export type PickImageOptions = {
  allowsEditing?: boolean;
  aspect?: [number, number];
  quality?: number;
};

export async function pickFromCamera(opts: PickImageOptions = {}): Promise<ImagePicker.ImagePickerAsset | null> {
  if (Platform.OS !== "web") {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") return null;
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: "images" as any,
    allowsEditing: opts.allowsEditing ?? true,
    aspect: opts.aspect,
    quality: opts.quality ?? 0.85,
  });
  return result.canceled ? null : result.assets[0];
}

export async function pickFromLibrary(opts: PickImageOptions = {}): Promise<ImagePicker.ImagePickerAsset | null> {
  if (Platform.OS !== "web") {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: "images" as any,
    allowsEditing: opts.allowsEditing ?? true,
    aspect: opts.aspect,
    quality: opts.quality ?? 0.85,
  });
  return result.canceled ? null : result.assets[0];
}
