// Firefox's `browser` namespace returns promises in every manifest version;
// Chrome MV3's `chrome` namespace does too.
export const api = globalThis.browser ?? globalThis.chrome;
