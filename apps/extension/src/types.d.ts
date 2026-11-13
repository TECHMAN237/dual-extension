interface ImportMetaEnv {
  /** Production backend URL, set in apps/extension/.env.production (see .env.production.example). */
  readonly VITE_DEFAULT_BACKEND_URL?: string;
}

declare module "*?script&iife" {
  const path: string;
  export default path;
}
declare module "*?script" {
  const path: string;
  export default path;
}
