/**
 * Shared `TokenStorage` instance.
 *
 * Both `registerAuthTools` (for `ensureAuthenticated`) and `handleCheckAuthStatus`
 * need to read the persisted token. Sharing one instance avoids duplicate
 * caches and keeps refresh deduplication working across callers.
 */
import TokenStorage from './token-storage.js'

export const tokenStorage = new TokenStorage()
