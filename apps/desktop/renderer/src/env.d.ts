/// <reference types="vite/client" />
import type { EmilioApi } from '@emilio/shared';
declare global {
  interface Window {
    api?: EmilioApi;
  }
}
