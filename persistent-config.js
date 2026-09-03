const { ChannelType, PermissionFlagsBits } = require('discord.js');

// Compatível com o canal criado pelas versões antigas do bot.
const STORAGE_CHANNEL_NAME = 'cda-bot-storage';
const PREFIX = 'CDA_CONFIG::';
const TEXT_PREFIX = 'CDA_TEXT::';
const TEXT_CHUNK_SIZE = 1650;
const MAX_SCAN_MESSAGES = 5000;

let storageChannel = null;
let enabled = false;
const messageCache = new Map();
const valueCache = new Map();
const textCache = new Map();

function serialize(key, value) {
  return `${PREFIX}${String(key)}::${JSON.stringify(value)}`;
}

function parseMessage(content) {
  if (!content?.startsWith(PREFIX)) return null;
  const rest = content.slice(PREFIX.length);
  const sep = rest.indexOf('::');
  if (sep < 1) return null;
  const key = rest.slice(0, sep);
  try {
    return { key, value: JSON.parse(rest.slice(sep + 2)) };
  } catch {
    return null;
  }
}

function serializeTextChunk(key, version, index, total, text) {
  return `${TEXT_PREFIX}${String(key)}::${version}::${index}::${total}::${text}`;
}

function parseTextChunk(content) {
  if (!content?.startsWith(TEXT_PREFIX)) return null;
  const rest = content.slice(TEXT_PREFIX.length);
  const parts = rest.split('::');
  if (parts.length < 5) return null;
  const key = parts.shift();
  const version = Number(parts.shift());
  const index = Number(parts.shift());
  const total = Number(parts.shift());
  const text = parts.join('::');
  if (!key || !Number.isFinite(version) || !Number.isInteger(index) || !Number.isInteger(total) || index < 0 || total < 1) return null;
  return { key, version, index, total, text };
}

function isStorageTopic(channel) {
  return channel?.type === ChannelType.GuildText &&
    String(channel.topic || '').toLowerCase().includes('armazenamento interno das configura');
}

function clone(value) {
  if (value === undefined) return undefined;
  try { return structuredClone(value); } catch {}
  try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
}

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function isMissing(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return !v.trim();
  if (Array.isArray(v)) return v.length === 0;
  if (isPlainObject(v)) return Object.keys(v).length === 0;
  return false;
}

// Preenche campos que uma versão nova zerou por falta de restore, mas preserva
// valores realmente existentes na versão mais recente.
function deepBackfill(newer, older) {
  if (isMissing(newer)) return clone(older);
  if (Array.isArray(newer) && Array.isArray(older)) {
    const objectList = newer.every(x => isPlainObject(x) && x.id != null) && older.every(x => isPlainObject(x) && x.id != null);
    if (!objectList) return clone(newer);
    const oldById = new Map(older.map(x => [String(x.id), x]));
    const out = newer.map(item => oldById.has(String(item.id)) ? deepBackfill(item, oldById.get(String(item.id))) : clone(item));
    const seen = new Set(out.map(x => String(x.id)));
    for (const item of older) if (!seen.has(String(item.id))) out.push(clone(item));
    return out;
  }
  if (isPlainObject(newer) && isPlainObject(older)) {
    const out = clone(newer) || {};
    for (const [key, oldValue] of Object.entries(older)) {
      if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = clone(oldValue);
      else out[key] = deepBackfill(out[key], oldValue);
    }
    return out;
  }
  return clone(newer);
}

function addOnlyMissingKeys(base, newer) {
  if (!isPlainObject(base) || !isPlainObject(newer)) return clone(base);
  const out = clone(base) || {};
  for (const [key, val] of Object.entries(newer)) {
    if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = clone(val);
    else if (isPlainObject(out[key]) && isPlainObject(val)) out[key] = addOnlyMissingKeys(out[key], val);
  }
  return out;
}

function hasAny(values) {
  return values.some(v => Array.isArray(v) ? v.length > 0 : Boolean(String(v || '').trim()));
}

function isLikelyResetConfig(key, value) {
  const v = value || {};
  if (key === 'management_extras') {
    return !hasAny([
      v.evaluation?.panelChannelId, v.evaluation?.resultChannelId, v.evaluation?.announcementChannelId,
      v.evaluation?.evaluatorRoleIds || [], v.evaluation?.evaluableRoleIds || [],
      v.bugs?.panelChannelId, v.bugs?.reportChannelId, v.bugs?.managerRoleIds || [],
    ]);
  }
  if (key === 'suggestions') {
    return !hasAny([
      v.guildId, v.suggestionChannelId, v.reviewChannelId, v.directorChannelId,
      v.suggestionTeamRoleIds || [], v.directorRoleIds || [],
    ]);
  }
  if (key === 'tickets') {
    return !hasAny([
      v.guildId, v.panelChannelId, v.categoryId, v.logChannelId, v.teamAnnouncementsChannelId,
      v.staffRoleIds || [], v.vipRoleIds || [],
    ]);
  }
  return false;
}

function recoverConfigValue(key, candidates) {
  if (!candidates.length) return null;
  if (key === 'tickets_state') {
    const best = candidates.reduce((acc, c) => Number(c.value?.lastId || 0) > Number(acc?.value?.lastId || 0) ? c : acc, candidates[0]);
    return clone(best.value);
  }

  const newest = candidates[0];
  if (isLikelyResetConfig(key, newest.value)) {
    const olderGood = candidates.slice(1).find(c => !isLikelyResetConfig(key, c.value));
    if (olderGood) {
      console.warn(`♻️ ${key}: detectei uma configuração recente vazia; recuperando o último backup preenchido do storage.`);
      return addOnlyMissingKeys(olderGood.value, newest.value);
    }
  }

  let merged = clone(newest.value);
  for (const candidate of candidates.slice(1)) merged = deepBackfill(merged, candidate.value);
  return merged;
}

function textFromVersion(entry) {
  if (!entry || entry.chunks.size < entry.total) return null;
  let text = '';
  for (let i = 0; i < entry.total; i++) {
    if (!entry.chunks.has(i)) return null;
    text += entry.chunks.get(i);
  }
  return text;
}

function globalEmojiCustomizationScore(text) {
  try {
    const parsed = JSON.parse(text || '{}');
    const vals = parsed?.values || parsed || {};
    let score = 0;
    for (const [glyph, val] of Object.entries(vals)) {
      const s = String(val || '').trim();
      if (s && s !== glyph) score++;
    }
    return score;
  } catch { return 0; }
}

function chooseTextVersion(key, versions) {
  const complete = [...versions.values()]
    .map(v => ({ ...v, text: textFromVersion(v) }))
    .filter(v => v.text !== null)
    .sort((a, b) => b.version - a.version);
  if (!complete.length) return null;

  if (key === 'global_emojis_v56') {
    complete.sort((a, b) => {
      const scoreDiff = globalEmojiCustomizationScore(b.text) - globalEmojiCustomizationScore(a.text);
      return scoreDiff || (b.version - a.version);
    });
  }
  return complete[0];
}

async function fetchAllStorageMessages(channel) {
  const all = [];
  let before;
  while (all.length < MAX_SCAN_MESSAGES) {
    const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!page.size) break;
    const rows = [...page.values()].sort((a, b) => (BigInt(a.id) > BigInt(b.id) ? -1 : 1));
    all.push(...rows);
    const oldest = rows.reduce((min, msg) => BigInt(msg.id) < BigInt(min.id) ? msg : min, rows[0]);
    before = oldest.id;
    if (page.size < 100) break;
  }
  return all.slice(0, MAX_SCAN_MESSAGES);
}

async function cleanupMessages(messages) {
  const unique = [...new Map(messages.filter(Boolean).map(m => [m.id, m])).values()];
  if (!unique.length) return;
  let deleted = 0;
  for (const msg of unique) {
    const ok = await msg.delete().then(() => true).catch(() => false);
    if (ok) deleted++;
  }
  if (deleted) console.log(`🧹 Storage: ${deleted} mensagem(ns) antiga(s)/duplicada(s) removida(s).`);
}

async function initPersistentConfig(client, guildId) {
  try {
    const guild = await client.guilds.fetch(String(guildId));
    await guild.channels.fetch();

    storageChannel = guild.channels.cache.find(ch =>
      ch.type === ChannelType.GuildText && ch.name === STORAGE_CHANNEL_NAME
    ) || null;

    if (!storageChannel) storageChannel = guild.channels.cache.find(isStorageTopic) || null;

    if (!storageChannel) {
      storageChannel = await guild.channels.create({
        name: STORAGE_CHANNEL_NAME,
        type: ChannelType.GuildText,
        topic: 'Armazenamento interno das configurações do bot. Não apague este canal.',
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          {
            id: client.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.ManageMessages,
            ],
          },
        ],
        reason: 'Armazenamento persistente do /botconfig',
      });
      console.log(`💾 Canal privado #${STORAGE_CHANNEL_NAME} criado para persistir o /botconfig.`);
    } else {
      console.log(`💾 Canal de storage encontrado: #${storageChannel.name} (${storageChannel.id}).`);
    }

    messageCache.clear();
    valueCache.clear();
    textCache.clear();

    const messages = await fetchAllStorageMessages(storageChannel);
    const configCandidates = new Map();
    const textVersions = new Map();

    for (const msg of messages) {
      if (msg.author.id !== client.user.id) continue;

      const textParsed = parseTextChunk(msg.content);
      if (textParsed) {
        if (!textVersions.has(textParsed.key)) textVersions.set(textParsed.key, new Map());
        const versions = textVersions.get(textParsed.key);
        if (!versions.has(textParsed.version)) versions.set(textParsed.version, {
          version: textParsed.version,
          total: textParsed.total,
          chunks: new Map(),
          messages: new Map(),
        });
        const entry = versions.get(textParsed.version);
        entry.total = textParsed.total;
        entry.chunks.set(textParsed.index, textParsed.text);
        entry.messages.set(textParsed.index, msg);
        continue;
      }

      const parsed = parseMessage(msg.content);
      if (parsed) {
        if (!configCandidates.has(parsed.key)) configCandidates.set(parsed.key, []);
        configCandidates.get(parsed.key).push({ msg, value: parsed.value });
      }
    }

    const stale = [];

    for (const [key, candidatesRaw] of configCandidates.entries()) {
      const candidates = candidatesRaw.sort((a, b) => (BigInt(a.msg.id) > BigInt(b.msg.id) ? -1 : 1));
      const newest = candidates[0];
      const recovered = recoverConfigValue(key, candidates);
      messageCache.set(key, newest.msg);
      valueCache.set(key, recovered);

      const content = serialize(key, recovered);
      let canonicalReady = newest.msg.content === content;
      if (content.length <= 2000 && !canonicalReady) {
        const edited = await newest.msg.edit({ content, allowedMentions: { parse: [] } }).catch(() => null);
        if (edited) {
          messageCache.set(key, edited);
          canonicalReady = true;
        }
      }
      // Só apaga backups antigos quando o conteúdo recuperado já está seguro na mensagem canônica.
      if (canonicalReady) for (const old of candidates.slice(1)) stale.push(old.msg);
    }

    for (const [key, versions] of textVersions.entries()) {
      const chosen = chooseTextVersion(key, versions);
      if (!chosen) {
        for (const v of versions.values()) for (const msg of v.messages.values()) stale.push(msg);
        continue;
      }
      textCache.set(key, {
        version: chosen.version,
        total: chosen.total,
        chunks: new Map(chosen.chunks),
        messages: new Map(chosen.messages),
      });
      for (const v of versions.values()) {
        if (v.version === chosen.version) continue;
        for (const msg of v.messages.values()) stale.push(msg);
      }
    }

    enabled = true;
    console.log(`💾 Persistência Discord ativa. ${valueCache.size} configuração(ões), ${textCache.size} texto(s) grande(s), ${messages.length} mensagem(ns) verificadas.`);

    // Limpa versões antigas sem atrasar o restante da inicialização.
    cleanupMessages(stale).catch(err => console.warn('⚠️ Limpeza do storage:', err.message));
    return true;
  } catch (err) {
    enabled = false;
    storageChannel = null;
    messageCache.clear();
    valueCache.clear();
    textCache.clear();
    console.error('❌ Não foi possível ativar a persistência pelo Discord:', err.message);
    console.warn('⚠️ O bot continuará usando o storage local nesta execução.');
    return false;
  }
}

async function loadPersistentConfig(key, fallback) {
  if (!enabled || !storageChannel) return fallback;
  const k = String(key);
  const mirrorKey = `config_mirror_v561_${k}`;

  try {
    const legacy = valueCache.has(k) ? clone(valueCache.get(k)) : null;
    const mirrorText = textFromVersion(textCache.get(mirrorKey));
    if (mirrorText !== null) {
      try {
        const mirrored = JSON.parse(mirrorText);
        let chosen = mirrored;
        if (legacy && isLikelyResetConfig(k, mirrored) && !isLikelyResetConfig(k, legacy)) chosen = legacy;
        else if (legacy) chosen = deepBackfill(mirrored, legacy);
        valueCache.set(k, clone(chosen));
        console.log(`✅ ${k}: configuração restaurada do espelho persistente no #${storageChannel.name}.`);
        return clone(chosen);
      } catch (err) {
        console.warn(`⚠️ ${k}: espelho de configuração inválido; tentando backup legado.`, err.message);
      }
    }

    if (legacy) {
      console.log(`✅ ${k}: configuração restaurada do #${storageChannel.name}.`);
      // Migra automaticamente o backup antigo para o formato chunked, sem limite de 2000 chars.
      savePersistentText(mirrorKey, JSON.stringify(legacy)).catch(() => {});
      return clone(legacy);
    }

    const content = serialize(k, fallback);
    if (content.length <= 2000) {
      const msg = await storageChannel.send({ content, allowedMentions: { parse: [] } });
      messageCache.set(k, msg);
    }
    valueCache.set(k, clone(fallback));
    savePersistentText(mirrorKey, JSON.stringify(fallback)).catch(() => {});
    console.log(`💾 ${k}: nenhum backup antigo; valor local salvo no canal.`);
    return fallback;
  } catch (err) {
    console.error(`❌ Falha ao carregar configuração persistente (${k}):`, err.message);
    return fallback;
  }
}

async function savePersistentConfig(key, value) {
  if (!enabled || !storageChannel) return false;
  const k = String(key);
  const mirrorKey = `config_mirror_v561_${k}`;

  try {
    const json = JSON.stringify(value);
    const mirrorOk = await savePersistentText(mirrorKey, json);
    const content = `${PREFIX}${k}::${json}`;

    // Mantém o formato antigo quando couber, para compatibilidade com versões anteriores.
    if (content.length <= 2000) {
      let msg = messageCache.get(k);
      if (msg) msg = await msg.edit({ content, allowedMentions: { parse: [] } });
      else msg = await storageChannel.send({ content, allowedMentions: { parse: [] } });
      messageCache.set(k, msg);
    } else {
      console.log(`💾 ${k}: configuração com ${content.length} caracteres salva no formato chunked (sem limite de 2000).`);
    }

    valueCache.set(k, clone(value));
    return Boolean(mirrorOk);
  } catch (err) {
    console.error(`❌ Falha ao salvar configuração persistente (${k}):`, err.message);
    return false;
  }
}

function splitText(text, chunkSize = TEXT_CHUNK_SIZE) {
  const value = String(text ?? '');
  const chunks = [];
  for (let i = 0; i < value.length; i += chunkSize) chunks.push(value.slice(i, i + chunkSize));
  return chunks.length ? chunks : [''];
}

async function loadPersistentText(key, fallback = '') {
  if (!enabled || !storageChannel) return String(fallback ?? '');
  const k = String(key);
  try {
    const cached = textCache.get(k);
    if (!cached) {
      if (String(fallback ?? '').length) savePersistentText(k, String(fallback)).catch(() => {});
      return String(fallback ?? '');
    }
    const text = textFromVersion(cached);
    if (text === null) {
      console.warn(`⚠️ ${k}: texto grande incompleto no storage; mantendo valor local.`);
      return String(fallback ?? '');
    }
    console.log(`✅ ${k}: texto grande restaurado do #${storageChannel.name} (${text.length} caracteres).`);
    return text;
  } catch (err) {
    console.error(`❌ Falha ao carregar texto persistente (${k}):`, err.message);
    return String(fallback ?? '');
  }
}

async function savePersistentText(key, text) {
  if (!enabled || !storageChannel) return false;
  const k = String(key);
  const value = String(text ?? '');
  const chunks = splitText(value);
  const current = textCache.get(k);
  const currentText = textFromVersion(current);
  if (currentText !== null && currentText === value) return true;

  const version = Date.now();
  const sent = new Map();

  try {
    for (let index = 0; index < chunks.length; index++) {
      const content = serializeTextChunk(k, version, index, chunks.length, chunks[index]);
      if (content.length > 2000) throw new Error(`chunk ${index} excedeu o limite do Discord`);
      const msg = await storageChannel.send({ content, allowedMentions: { parse: [] } });
      sent.set(index, msg);
    }

    const old = textCache.get(k);
    textCache.set(k, {
      version,
      total: chunks.length,
      chunks: new Map(chunks.map((chunk, index) => [index, chunk])),
      messages: sent,
    });

    if (old?.messages) cleanupMessages([...old.messages.values()]).catch(() => {});
    console.log(`💾 ${k}: texto grande salvo em ${chunks.length} parte(s), ${value.length} caracteres.`);
    return true;
  } catch (err) {
    console.error(`❌ Falha ao salvar texto persistente (${k}):`, err.message);
    for (const msg of sent.values()) await msg.delete().catch(() => {});
    return false;
  }
}

module.exports = {
  STORAGE_CHANNEL_NAME,
  initPersistentConfig,
  loadPersistentConfig,
  savePersistentConfig,
  loadPersistentText,
  savePersistentText,
};
