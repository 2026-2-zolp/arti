/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USE_MOCK?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_DEFAULT_EXHIBITION_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
