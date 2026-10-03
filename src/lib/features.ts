/**
 * Feature flags for integrations whose backend Edge Functions are not part of this release
 * (`zoom-api`, `send-push`). Both are OFF unless explicitly enabled at build time:
 *   REACT_APP_ENABLE_ZOOM=true   REACT_APP_ENABLE_PUSH=true (push additionally needs REACT_APP_VAPID_PUBLIC_KEY)
 * Do not enable them until the corresponding function exists and is deployed.
 */
export const features = {
  zoom: process.env.REACT_APP_ENABLE_ZOOM === 'true',
  push: process.env.REACT_APP_ENABLE_PUSH === 'true',
} as const;
