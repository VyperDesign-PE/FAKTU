import AsyncStorage from "@react-native-async-storage/async-storage";
import type { BusinessProfile } from "../domain/types";

const PREFIX = "business_profile_v1";
const emptyProfile: BusinessProfile = { onboardingComplete: false };
const key = (scope: string) => `${PREFIX}:${scope}`;

export async function loadProfile(scope: string): Promise<BusinessProfile> {
  const raw = await AsyncStorage.getItem(key(scope));
  return raw ? { ...emptyProfile, ...JSON.parse(raw) } : emptyProfile;
}

export async function saveProfile(scope: string, profile: BusinessProfile) {
  await AsyncStorage.setItem(key(scope), JSON.stringify(profile));
}

export async function clearProfile(scope: string) {
  await AsyncStorage.removeItem(key(scope));
}
