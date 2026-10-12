import { registerRootComponent } from "expo";
import App from "./App";

// Punto de entrada explícito: en el monorepo, expo se instala en la raíz y
// "node_modules/expo/AppEntry.js" no existe dentro de apps/mobile.
registerRootComponent(App);
