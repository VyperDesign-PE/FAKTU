import { Alert, Platform, Share, type AlertButton } from "react-native";

/**
 * Alert.alert no hace nada en la versión web de React Native: en el navegador
 * se usan los diálogos nativos (alert/confirm) para que el usuario vea el mensaje.
 */
export function showAlert(title: string, message?: string, buttons?: AlertButton[]) {
  if (Platform.OS !== "web") {
    Alert.alert(title, message, buttons);
    return;
  }
  const text = message ? `${title}\n\n${message}` : title;
  if (buttons && buttons.length > 1) {
    const cancel = buttons.find((button) => button.style === "cancel");
    const confirm = [...buttons].reverse().find((button) => button.style !== "cancel");
    (window.confirm(text) ? confirm : cancel)?.onPress?.();
    return;
  }
  window.alert(text);
  buttons?.[0]?.onPress?.();
}

/**
 * Compartir un enlace: hoja nativa en el celular; en el navegador usa
 * navigator.share si existe y, si no, copia el enlace al portapapeles.
 */
export async function shareLink(url: string, message?: string) {
  if (Platform.OS !== "web") {
    await Share.share({ message: message ? `${message} ${url}` : url });
    return;
  }
  const nav = globalThis.navigator as Navigator | undefined;
  if (nav?.share) {
    await nav.share({ text: message, url });
    return;
  }
  if (nav?.clipboard) {
    await nav.clipboard.writeText(url);
    window.alert("Enlace copiado. Pégalo donde quieras compartirlo.");
    return;
  }
  window.prompt("Copia este enlace:", url);
}
