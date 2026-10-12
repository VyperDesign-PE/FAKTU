export type LoginErrors = {
  email?: string;
  password?: string;
};

export type RegisterErrors = LoginErrors & {
  confirmPassword?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function validateEmail(value: string): string | undefined {
  const email = normalizeEmail(value);
  if (!email) return "Ingresa tu correo electrónico.";
  if (!EMAIL_RE.test(email)) return "Ingresa un correo electrónico válido.";
  return undefined;
}

export function validatePassword(value: string): string | undefined {
  if (!value) return "Ingresa tu contraseña.";
  if (value.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
  return undefined;
}

export function validateLogin(email: string, password: string): LoginErrors {
  return {
    email: validateEmail(email),
    password: validatePassword(password)
  };
}

export function validateRegistration(email: string, password: string, confirmPassword: string): RegisterErrors {
  const errors: RegisterErrors = {
    email: validateEmail(email),
    password: validatePassword(password)
  };
  if (!confirmPassword) errors.confirmPassword = "Confirma tu contraseña.";
  else if (password !== confirmPassword) errors.confirmPassword = "Las contraseñas no coinciden.";
  return errors;
}

export function hasErrors(errors: object) {
  return Object.values(errors).some(Boolean);
}
