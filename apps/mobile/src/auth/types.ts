export type AuthUser = {
  id: string;
  email: string;
  tenantId: string;
};

export type AuthSession = {
  accessToken: string;
  /** Token de renovación rotativo (el de acceso dura minutos). */
  refreshToken?: string;
  user: AuthUser;
};
