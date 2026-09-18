/** Runtime endpoint can be replaced by a staging origin for QA builds. */
export const FD_RUNTIME_ORIGIN: string = 'https://ai-api.fdsure.com';
export const FD_RUNTIME_API_PREFIX: string = '/api/mobile/v1';
export const FD_LEGACY_API_PREFIX: string = '/api';
export const FD_DEFAULT_MODEL: string = 'deepseek-flash';
export const FD_SUPPORTED_MODELS: Array<string> = [
  'deepseek-flash',
  'deepseek-v4-pro',
  'qwen3.8-max',
  'qwen3.8-flash',
  'glm-5.2',
  'kimi-k3'
];

