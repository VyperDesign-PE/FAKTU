import { ActivityIndicator, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { RootStackParamList } from "./types";
import { useApp } from "../context/AppContext";
import { useAuth } from "../context/AuthContext";
import { LoginScreen, RegisterScreen } from "../screens/auth/AuthScreens";
import { HomeScreen } from "../screens/HomeScreen";
import {
  WelcomeScreen, VerifyPhoneScreen, OtpCodeScreen, EnterRucScreen, ConfirmBusinessScreen,
  SunatConnectionDataScreen, AuthorizePseScreen, AuthorizingScreen, EnabledDocumentsScreen, ReadyScreen
} from "../screens/onboarding/OnboardingScreens";
import {
  NewSaleScreen, AddProductScreen, QuickSaleScreen, CartScreen, DocumentTypeScreen,
  CustomerDataScreen, SaleSummaryScreen, EmissionResultScreen, ShareReceiptScreen
} from "../screens/sales/SaleScreens";
import {
  OfflineHomeScreen, OfflineSaleScreen, TemporaryReceiptScreen, PendingReceiptsScreen, SyncingScreen, SyncResultScreen
} from "../screens/offline/OfflineScreens";
import {
  CatalogScreen, ReceiptHistoryScreen, ReceiptDetailScreen, SystemStatusScreen, BusinessScreen, SupportScreen, BillingSettingsScreen
} from "../screens/management/ManagementScreens";
import { CustomerFormScreen, CustomersScreen } from "../screens/customers/CustomerScreens";
import {
  DashboardScreen, HistorialComprobantesScreen, ConfiguracionScreen
} from "../screens/main/MainSectionScreens";
import { PosScreen } from "../screens/pos/PosScreen";
import { ProductFormScreen, ProductosScreen } from "../screens/products/ProductScreens";
import { SeguridadScreen } from "../screens/security/SecurityScreen";
import { PorCobrarScreen } from "../screens/receivables/ReceivableScreens";
import { CashCloseScreen } from "../screens/reports/ReportsScreens";
import { GuideDetailScreen, GuideFormScreen, GuidesScreen } from "../screens/guides/GuideScreens";

const Stack = createNativeStackNavigator<RootStackParamList>();

export function AppRouter() {
  const { hydrated: appHydrated, profile } = useApp();
  const { hydrated: authHydrated, isAuthenticated } = useAuth();

  if (!appHydrated || !authHydrated) {
    return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator size="large" /></View>;
  }

  const initialRouteName: keyof RootStackParamList = !isAuthenticated
    ? "Login"
    : profile.onboardingComplete
      ? "Dashboard"
      : "Welcome";

  return (
    // Al entrar o salir de sesión se reinicia la navegación (evita quedar en pantallas protegidas).
    <NavigationContainer key={isAuthenticated ? "session" : "guest"}>
      <Stack.Navigator initialRouteName={initialRouteName} screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Register" component={RegisterScreen} />

        <Stack.Screen name="Welcome" component={WelcomeScreen} />
        <Stack.Screen name="VerifyPhone" component={VerifyPhoneScreen} />
        <Stack.Screen name="OtpCode" component={OtpCodeScreen} />
        <Stack.Screen name="EnterRuc" component={EnterRucScreen} />
        <Stack.Screen name="ConfirmBusiness" component={ConfirmBusinessScreen} />
        <Stack.Screen name="SunatConnectionData" component={SunatConnectionDataScreen} />
        <Stack.Screen name="AuthorizePse" component={AuthorizePseScreen} />
        <Stack.Screen name="Authorizing" component={AuthorizingScreen} options={{ gestureEnabled: false }} />
        <Stack.Screen name="EnabledDocuments" component={EnabledDocumentsScreen} />
        <Stack.Screen name="Ready" component={ReadyScreen} />

        <Stack.Screen name="Dashboard" component={DashboardScreen} />
        <Stack.Screen name="POSVenta" component={PosScreen} />
        <Stack.Screen name="Productos" component={ProductosScreen} />
        <Stack.Screen name="ProductForm" component={ProductFormScreen} />
        <Stack.Screen name="PorCobrar" component={PorCobrarScreen} />
        <Stack.Screen name="Seguridad" component={SeguridadScreen} />
        <Stack.Screen name="HistorialComprobantes" component={HistorialComprobantesScreen} />
        <Stack.Screen name="Configuracion" component={ConfiguracionScreen} />

        {/* Rutas operativas existentes. Se mantienen separadas del shell responsivo para flujos de pantalla completa. */}
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="NewSale" component={NewSaleScreen} />
        <Stack.Screen name="AddProduct" component={AddProductScreen} />
        <Stack.Screen name="QuickSale" component={QuickSaleScreen} />
        <Stack.Screen name="Cart" component={CartScreen} />
        <Stack.Screen name="DocumentType" component={DocumentTypeScreen} />
        <Stack.Screen name="CustomerData" component={CustomerDataScreen} />
        <Stack.Screen name="SaleSummary" component={SaleSummaryScreen} />
        <Stack.Screen name="EmissionResult" component={EmissionResultScreen} />
        <Stack.Screen name="ShareReceipt" component={ShareReceiptScreen} />

        <Stack.Screen name="OfflineHome" component={OfflineHomeScreen} />
        <Stack.Screen name="OfflineSale" component={OfflineSaleScreen} />
        <Stack.Screen name="TemporaryReceipt" component={TemporaryReceiptScreen} />
        <Stack.Screen name="PendingReceipts" component={PendingReceiptsScreen} />
        <Stack.Screen name="Syncing" component={SyncingScreen} options={{ gestureEnabled: false }} />
        <Stack.Screen name="SyncResult" component={SyncResultScreen} />

        <Stack.Screen name="Catalog" component={CatalogScreen} />
        <Stack.Screen name="ReceiptHistory" component={ReceiptHistoryScreen} />
        <Stack.Screen name="ReceiptDetail" component={ReceiptDetailScreen} />
        <Stack.Screen name="CashClose" component={CashCloseScreen} />
        <Stack.Screen name="Guides" component={GuidesScreen} />
        <Stack.Screen name="GuideForm" component={GuideFormScreen} />
        <Stack.Screen name="GuideDetail" component={GuideDetailScreen} />
        <Stack.Screen name="Customers" component={CustomersScreen} />
        <Stack.Screen name="CustomerForm" component={CustomerFormScreen} />
        <Stack.Screen name="BillingSettings" component={BillingSettingsScreen} />
        <Stack.Screen name="SystemStatus" component={SystemStatusScreen} />
        <Stack.Screen name="Business" component={BusinessScreen} />
        <Stack.Screen name="Support" component={SupportScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
