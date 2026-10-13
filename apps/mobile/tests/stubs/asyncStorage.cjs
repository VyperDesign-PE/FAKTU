// Sustituto en memoria de AsyncStorage para probar el almacenamiento sin React Native.
const store = new Map();
const delay = () => new Promise((resolve) => setTimeout(resolve, Math.random() * 3));
module.exports = {
  async getItem(key) { await delay(); return store.has(key) ? store.get(key) : null; },
  async setItem(key, value) { await delay(); store.set(key, value); },
  async removeItem(key) { await delay(); store.delete(key); },
  __clear() { store.clear(); }
};
