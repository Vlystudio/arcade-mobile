import { Alert as RNAlert, Platform } from "react-native";

type AlertButton = {
  text?: string;
  onPress?: () => void;
  style?: "default" | "cancel" | "destructive";
};

type AlertOptions = {
  cancelable?: boolean;
  onDismiss?: () => void;
};

// react-native-web's Alert.alert() is a no-op, so error/confirm dialogs
// silently disappear on web. Fall back to window.alert/window.confirm there.
function showWebAlert(title: string, message?: string, buttons?: AlertButton[]) {
  const text = [title, message].filter(Boolean).join("\n\n");

  if (!buttons || buttons.length <= 1) {
    window.alert(text);
    buttons?.[0]?.onPress?.();
    return;
  }

  const cancelButton = buttons.find((b) => b.style === "cancel");
  const confirmButton = buttons.find((b) => b !== cancelButton) ?? buttons[buttons.length - 1];

  if (window.confirm(text)) {
    confirmButton?.onPress?.();
  } else {
    cancelButton?.onPress?.();
  }
}

export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButton[], options?: AlertOptions) {
    if (Platform.OS === "web") {
      showWebAlert(title, message, buttons);
    } else {
      RNAlert.alert(title, message, buttons, options);
    }
  },
};
