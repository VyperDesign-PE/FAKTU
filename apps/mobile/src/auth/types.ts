export type AuthUser = {
  id: string;
  email: string;
  tenantId: string;
};

export type AuthSession = {
  accessToken: string;
  user: AuthUser;
};
