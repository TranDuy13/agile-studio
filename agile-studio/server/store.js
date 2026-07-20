// Compatibility shim: storage now lives under server/store/ split by backend.
// Existing `import { store } from "./store.js"` keeps working; the engine is
// selected at runtime by STORAGE_DRIVER.
export { store } from "./store/index.js";
