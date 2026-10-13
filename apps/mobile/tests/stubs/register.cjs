// Redirige "@react-native-async-storage/async-storage" al sustituto en memoria (solo en pruebas).
const Module = require("node:module");
const stub = require("./asyncStorage.cjs");
const load = Module._load;
Module._load = function (request, ...rest) {
  return request === "@react-native-async-storage/async-storage" ? { default: stub, ...stub } : load.call(this, request, ...rest);
};
