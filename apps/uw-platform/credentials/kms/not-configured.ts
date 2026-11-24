import { keyRefusal, type DataKeys } from '../data-keys.ts';

export const notConfiguredDataKeys: DataKeys = {
  generate: async () => keyRefusal('key_service_not_configured'),
  unwrap: async () => keyRefusal('key_service_not_configured'),
};
