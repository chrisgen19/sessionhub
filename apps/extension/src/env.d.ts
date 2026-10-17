interface ImportMetaEnv {
  /** SessionHub server origin for this build (see wxt.config.ts). */
  readonly WXT_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
