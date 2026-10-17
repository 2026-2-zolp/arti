import { safeStorage } from '@/utils/storage';

const USER_TOKEN_KEY = 'arti.auth.token';
const ADMIN_TOKEN_KEY = 'arti.admin.token';

export const tokenStorage = {
  getUser: () => safeStorage.get<string>(USER_TOKEN_KEY),
  setUser: (token: string | null) => safeStorage.set(USER_TOKEN_KEY, token),
  getAdmin: () => safeStorage.get<string>(ADMIN_TOKEN_KEY),
  setAdmin: (token: string | null) => safeStorage.set(ADMIN_TOKEN_KEY, token),
};
