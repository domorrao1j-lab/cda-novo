const fs = require('fs');
const path = require('path');

// Dados mutáveis ficam separados do código enviado em cada atualização.
// Não coloque arquivos desta pasta dentro do ZIP de commit da Discloud.
const STORAGE_DIR = process.env.CDA_STORAGE_DIR
  ? path.resolve(process.env.CDA_STORAGE_DIR)
  : path.join(__dirname, 'storage');

function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function ensureStorageDir() {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

function storagePath(fileName) {
  ensureStorageDir();
  return path.join(STORAGE_DIR, fileName);
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function atomicWriteJson(file, value) {
  ensureStorageDir();
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function migrateJson(fileName, legacyPath, fallback) {
  const target = storagePath(fileName);
  if (fs.existsSync(target)) return target;

  let initial = clone(fallback);
  if (legacyPath && fs.existsSync(legacyPath)) {
    try {
      initial = readJsonFile(legacyPath);
      console.log(`💾 Storage migrado: ${path.basename(legacyPath)} -> storage/${fileName}`);
    } catch (error) {
      console.warn(`⚠️ Não consegui migrar ${path.basename(legacyPath)}: ${error.message}`);
    }
  } else {
    console.log(`💾 Storage criado: storage/${fileName}`);
  }

  atomicWriteJson(target, initial);
  return target;
}

function loadJson(file, fallback) {
  try {
    return readJsonFile(file);
  } catch (error) {
    console.warn(`⚠️ Falha ao ler ${path.basename(file)}: ${error.message}`);
    return clone(fallback);
  }
}

function saveJson(file, value) {
  atomicWriteJson(file, value);
}

module.exports = {
  STORAGE_DIR,
  storagePath,
  migrateJson,
  loadJson,
  saveJson,
};
