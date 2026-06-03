import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Props = {
  uri: string | null;
  caption?: string | null;
  onClose: () => void;
};

export function ImageLightbox({ uri, caption, onClose }: Props) {
  if (!uri) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.bg}>
        {/* Tap anywhere to close */}
        <Pressable style={styles.bgTap} onPress={onClose} />

        {/* Close button */}
        <SafeAreaView style={styles.header} edges={["top"]} pointerEvents="box-none">
          <Pressable style={styles.closeBtn} onPress={onClose}>
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
        </SafeAreaView>

        {/* Full-res image */}
        <Image
          source={{ uri }}
          style={styles.image}
          contentFit="contain"
          cachePolicy="none"
        />

        {/* Optional caption */}
        {caption ? (
          <SafeAreaView style={styles.footer} edges={["bottom"]} pointerEvents="box-none">
            <Text style={styles.caption}>{caption}</Text>
          </SafeAreaView>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.96)",
    justifyContent: "center",
    alignItems: "center",
  },
  bgTap: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
  },
  header: {
    position: "absolute", top: 0, left: 0, right: 0,
    flexDirection: "row", justifyContent: "flex-end",
    zIndex: 10,
  },
  closeBtn: {
    margin: 16,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.15)",
  },
  image: {
    width: "100%",
    height: "80%",
  },
  footer: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    padding: 20,
  },
  caption: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
});
