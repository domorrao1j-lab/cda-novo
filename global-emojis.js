const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require('discord.js');
const path = require('path');
const { migrateJson, loadJson, saveJson } = require('./storage');
const { loadPersistentText, savePersistentText } = require('./persistent-config');

const ORANGE = 0xFF8C00;
const PAGE_SIZE = 25;
const LOCAL_PATH = migrateJson('global-emojis-v56.json', path.join(__dirname, 'global-emojis-v56.json'), { values: {} });

// Todos os emojis fixos usados pelos módulos atuais do bot. Emojis específicos que já
// possuem configuração própria (Tickets/Sugestões) continuam funcionando; esta camada
// cobre também todos os emojis que antes estavam hardcoded em embeds, botões e mensagens.
const REGISTRY = [
  ['❌', 'Erro / Recusar'], ['✅', 'Sucesso / Aprovar'], ['⚠️', 'Aviso'], ['⭐', 'Estrela / Avaliação'], ['↩️', 'Voltar'],
  ['🎫', 'Ticket'], ['💡', 'Sugestão / Ideia'], ['💬', 'Mensagem / Comentário'], ['📝', 'Texto / Observação'], ['📨', 'Enviar / Notificar'],
  ['🟢', 'Status verde'], ['👤', 'Usuário / Membro'], ['👥', 'Equipe / Pessoas'], ['💎', 'VIP / Prioridade'], ['💾', 'Storage / Salvar'],
  ['📌', 'Assunto / Fixado'], ['📁', 'Pasta / Canais'], ['🟡', 'Status amarelo'], ['🔴', 'Status vermelho'], ['👮', 'Staff / Responsável'],
  ['🖼️', 'Imagem'], ['🎨', 'Emojis / Aparência'], ['🐛', 'Bug'], ['🤖', 'IA'], ['✨', 'Sugestão IA'],
  ['⚙️', 'Configuração'], ['➕', 'Adicionar'], ['🛠️', 'Ferramentas / Staff'], ['🏢', 'Times / Corporações'], ['🔵', 'Status azul'],
  ['⏳', 'Espera'], ['📂', 'Tipo / Categoria'], ['📥', 'Entrada / Recebido'], ['🙋', 'Assumir'], ['🔁', 'Transferir'],
  ['➖', 'Remover'], ['📋', 'Resumo / Lista'], ['📊', 'Dashboard / Dados'], ['🧩', 'Funções'], ['🧠', 'Base / Conhecimento'],
  ['⬆️', 'Escalonar'], ['🔔', 'Notificar Staff'], ['🏆', 'Ranking'], ['💭', 'Pensamento / Análise'], ['🏛️', 'Direção'],
  ['🔎', 'Consulta / Buscar'], ['📜', 'Logs / Documento'], ['⏱️', 'Atendimento / Tempo'], ['🕘', 'Histórico'], ['✏️', 'Editar / Renomear'],
  ['♻️', 'Restaurar'], ['✍️', 'Escrever'], ['⏰', 'Lembrete'], ['🗳️', 'Avaliar / Voto'], ['🎮', 'Jogo'],
  ['🚔', 'Polícia'], ['🎉', 'Evento / Concluído'], ['🛟', 'Suporte'], ['🚨', 'Denúncia / Alerta'], ['🤝', 'Parceria'],
  ['🛒', 'Comprar'], ['🔒', 'Fechar / Bloquear'], ['🏷️', 'Cargo'], ['🔑', 'Chave'], ['🗑️', 'Excluir'],
  ['📎', 'Anexo / Prova'], ['▶️', 'Retomar'], ['📢', 'Anúncio'], ['⚫', 'Status preto'], ['📍', 'Local'],
  ['🥇', '1º lugar'], ['🥈', '2º lugar'], ['🥉', '3º lugar'], ['🏙️', 'Servidor / Cidade'], ['🛡️', 'Segurança / Permissão'],
  ['📚', 'Hierarquia / Conhecimento'], ['🌐', 'Site / Web'], ['🚀', 'Deploy / Iniciar'], ['📦', 'Pacote / Arquivo'], ['🔧', 'Ajustes'],
];

const ENTRIES = REGISTRY.map(([glyph, label], index) => ({ id: `emoji_${String(index + 1).padStart(3, '0')}`, glyph, label }));
const BY_ID = new Map(ENTRIES.map(x => [x.id, x]));
let values = Object.fromEntries(ENTRIES.map(x => [x.glyph, x.glyph]));
const pending = new Map();
let restPatched = false;
let emojiClient = null;

function one(...components) { return new ActionRowBuilder().addComponents(...components); }
function isAdmin(i) { return Boolean(i.memberPermissions?.has(PermissionFlagsBits.Administrator)); }

function normalize(raw = {}) {
  const next = Object.fromEntries(ENTRIES.map(x => [x.glyph, x.glyph]));
  for (const item of ENTRIES) {
    const v = String(raw?.[item.glyph] || '').trim();
    if (v) next[item.glyph] = v.slice(0, 100);
  }
  return next;
}

function loadLocal() {
  const data = loadJson(LOCAL_PATH, { values: {} });
  return normalize(data?.values || {});
}
function saveLocal(next) {
  values = normalize(next);
  saveJson(LOCAL_PATH, { values });
}

async function initGlobalEmojisPersistentConfig() {
  const local = loadLocal();
  let restored = local;
  try {
    // Não cria uma versão nova a cada reinício. Isso evita encher o
    // #cda-bot-storage e garante que o último backup real seja reutilizado.
    const raw = await loadPersistentText('global_emojis_v56', '');
    if (raw) {
      const parsed = JSON.parse(raw || '{}');
      restored = normalize(parsed?.values || parsed || local);
    } else {
      // Primeiro uso da função: salva somente uma vez.
      await savePersistentText('global_emojis_v56', JSON.stringify({ values: local })).catch(() => {});
    }
  } catch (err) {
    console.warn('⚠️ Emojis globais: backup inválido, mantendo configuração local:', err.message);
  }
  saveLocal(restored);
  return values;
}

function saveAll() {
  saveLocal(values);
  savePersistentText('global_emojis_v56', JSON.stringify({ values })).catch(err =>
    console.error('❌ Falha ao salvar emojis globais:', err.message)
  );
}

function parseEmojiMessage(content) {
  const text = String(content || '').trim();
  const custom = text.match(/^<(a?):([A-Za-z0-9_~]+):(\d+)>$/);
  if (custom) return custom[0];
  if (!text || text.length > 32 || /\s/.test(text)) return null;
  const looksLikeEmoji = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3/u.test(text);
  return looksLikeEmoji ? text : null;
}

function current(glyph) { return String(values[glyph] || glyph); }
function replacementFor(text) {
  if (!Object.prototype.hasOwnProperty.call(values, text)) return text;
  return current(text);
}

function transformText(text) {
  let out = String(text);
  // Nunca altera as mensagens internas de storage: elas precisam manter JSON exato.
  if (out.startsWith('CDA_CONFIG::') || out.startsWith('CDA_TEXT::')) return out;
  for (const item of ENTRIES) {
    const replacement = current(item.glyph);
    if (replacement !== item.glyph && out.includes(item.glyph)) out = out.split(item.glyph).join(replacement);
  }
  return out;
}

function customEmojiObject(value) {
  const m = String(value || '').match(/^<(a?):([A-Za-z0-9_~]+):(\d+)>$/);
  if (!m) return null;
  return { id: m[3], name: m[2], animated: Boolean(m[1]) };
}

function transformPayload(value, parentKey = '') {
  if (typeof value === 'string') return transformText(value);
  if (Array.isArray(value)) return value.map(v => transformPayload(v, parentKey));
  if (!value || typeof value !== 'object') return value;

  // Emojis de componentes são enviados como { name: '✅' }. Se o usuário trocou
  // por emoji personalizado, convertemos para o formato id/name/animated aceito pelo Discord.
  if (parentKey === 'emoji' && typeof value.name === 'string') {
    const originalName = value.name;
    const mapped = replacementFor(originalName);
    const custom = customEmojiObject(mapped);
    if (custom) {
      // Emojis personalizados em componentes só são enviados quando o bot realmente
      // enxerga o emoji. Um ID de servidor externo/inacessível não pode derrubar
      // botões, selects ou respostas de slash commands.
      const usable = Boolean(emojiClient?.emojis?.cache?.has(custom.id));
      if (usable) return { ...value, ...custom };
      return { ...value, name: originalName };
    }
    return { ...value, name: transformText(mapped) };
  }

  const out = {};
  for (const [key, val] of Object.entries(value)) out[key] = transformPayload(val, key);
  return out;
}

function installGlobalEmojiRestPatch(client) {
  if (restPatched || !client?.rest) return;
  restPatched = true;
  emojiClient = client;
  for (const method of ['post', 'put', 'patch']) {
    const original = client.rest[method];
    if (typeof original !== 'function') continue;
    client.rest[method] = function patchedRoute(route, options = {}) {
      const next = options && typeof options === 'object'
        ? { ...options, ...(Object.prototype.hasOwnProperty.call(options, 'body') ? { body: transformPayload(options.body) } : {}) }
        : options;
      return original.call(this, route, next);
    };
  }
  console.log(`🎨 Emojis globais: camada ativa para ${ENTRIES.length} emoji(s) fixos.`);
}

function pageCount() { return Math.max(1, Math.ceil(ENTRIES.length / PAGE_SIZE)); }
function clampPage(page) { return Math.max(0, Math.min(pageCount() - 1, Number(page) || 0)); }
function pageEntries(page) {
  const p = clampPage(page);
  return ENTRIES.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);
}

function emojiEmbed(page = 0) {
  const p = clampPage(page);
  const list = pageEntries(p).map(x => `${x.glyph} **${x.label}** → ${current(x.glyph)}`).join('\n');
  return new EmbedBuilder()
    .setColor(ORANGE)
    .setTitle('🎨 Todos os Emojis do Bot')
    .setDescription(
      `Aqui você pode trocar **todos os emojis fixos do bot**, incluindo Tickets, Sugestões, Avaliações, Bugs, logs, avisos e configurações.\n\n` +
      `Selecione um item e depois envie o novo emoji **como mensagem normal no canal**. Pode ser Unicode ou emoji personalizado.\n\n${list}`
    )
    .setFooter({ text: `Página ${p + 1}/${pageCount()} • Configuração persistente no #cda-bot-storage` });
}

function emojiComponents(page = 0) {
  const p = clampPage(page);
  const rows = [];
  const options = pageEntries(p).map(x => {
    const option = new StringSelectMenuOptionBuilder()
      .setLabel(x.label.slice(0, 100))
      .setDescription(`${x.glyph} → ${current(x.glyph)}`.slice(0, 100))
      .setValue(x.id);
    try { option.setEmoji(current(x.glyph)); } catch { try { option.setEmoji(x.glyph); } catch {} }
    return option;
  });
  rows.push(one(new StringSelectMenuBuilder()
    .setCustomId(`cda_global_emoji_pick:${p}`)
    .setPlaceholder('Escolha qual emoji deseja alterar')
    .addOptions(options)));
  rows.push(one(
    new ButtonBuilder().setCustomId(`cda_global_emoji_page:${Math.max(0, p - 1)}`).setLabel('Anterior').setEmoji('↩️').setStyle(ButtonStyle.Secondary).setDisabled(p <= 0),
    new ButtonBuilder().setCustomId(`cda_global_emoji_page:${Math.min(pageCount() - 1, p + 1)}`).setLabel('Próxima').setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(p >= pageCount() - 1),
    new ButtonBuilder().setCustomId(`cda_global_emoji_reset_page:${p}`).setLabel('Restaurar página').setEmoji('♻️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('cda_global_emoji_reset_all').setLabel('Restaurar todos').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
  ));
  rows.push(one(new ButtonBuilder().setCustomId('cda_main_back').setLabel('Voltar ao /botconfig').setEmoji('↩️').setStyle(ButtonStyle.Primary)));
  return rows;
}

function setupGlobalEmojis(client, startupReady = Promise.resolve()) {
  client.on('messageCreate', async message => {
    await startupReady;
    if (!message.guild || message.author.bot) return;
    const key = `${message.guild.id}:${message.author.id}`;
    const item = pending.get(key);
    if (!item) return;
    if (item.expiresAt < Date.now()) { pending.delete(key); return; }
    if (item.channelId !== message.channel.id) return;
    const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member?.permissions?.has(PermissionFlagsBits.Administrator)) return;

    const emoji = parseEmojiMessage(message.content);
    if (!emoji) {
      const warn = await message.reply('⚠️ Envie **somente um emoji**. Ex.: `🎨` ou `<:emoji:123456789>`').catch(() => null);
      if (warn) setTimeout(() => warn.delete().catch(() => {}), 5000);
      return;
    }
    values[item.glyph] = emoji;
    saveAll();
    pending.delete(key);
    await message.delete().catch(() => {});
    await item.interaction.editReply({
      content: `✅ **${item.label}** alterado: ${item.glyph} → ${emoji}`,
      embeds: [emojiEmbed(item.page)],
      components: emojiComponents(item.page),
    }).catch(async () => {
      const ok = await message.channel.send(`✅ Emoji **${item.label}** atualizado para ${emoji}.`).catch(() => null);
      if (ok) setTimeout(() => ok.delete().catch(() => {}), 6000);
    });
  });

  client.on('interactionCreate', async interaction => {
    if (!global.__CDA_STARTUP_READY) return;
    await startupReady;
    try {
      if (interaction.isButton() && interaction.customId === 'cda_main_global_emojis') {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Apenas Administradores podem configurar os emojis.', ephemeral: true });
        return interaction.update({ embeds: [emojiEmbed(0)], components: emojiComponents(0), content: null });
      }

      if (interaction.isButton() && interaction.customId.startsWith('cda_global_emoji_page:')) {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        const page = clampPage(interaction.customId.split(':')[1]);
        return interaction.update({ embeds: [emojiEmbed(page)], components: emojiComponents(page), content: null });
      }

      if (interaction.isStringSelectMenu() && interaction.customId.startsWith('cda_global_emoji_pick:')) {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        const page = clampPage(interaction.customId.split(':')[1]);
        const entry = BY_ID.get(interaction.values[0]);
        if (!entry) return interaction.reply({ content: '❌ Emoji não encontrado.', ephemeral: true });
        pending.set(`${interaction.guildId}:${interaction.user.id}`, {
          glyph: entry.glyph, label: entry.label, page, channelId: interaction.channelId,
          interaction, expiresAt: Date.now() + 90_000,
        });
        return interaction.update({
          embeds: [emojiEmbed(page)],
          components: emojiComponents(page),
          content: `🎨 Envie agora o novo emoji para **${entry.label}** como uma **mensagem normal neste canal**. Você tem 90 segundos.`,
        });
      }

      if (interaction.isButton() && interaction.customId.startsWith('cda_global_emoji_reset_page:')) {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        const page = clampPage(interaction.customId.split(':')[1]);
        for (const entry of pageEntries(page)) values[entry.glyph] = entry.glyph;
        saveAll();
        return interaction.update({ content: '✅ Emojis desta página restaurados.', embeds: [emojiEmbed(page)], components: emojiComponents(page) });
      }

      if (interaction.isButton() && interaction.customId === 'cda_global_emoji_reset_all') {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        values = Object.fromEntries(ENTRIES.map(x => [x.glyph, x.glyph]));
        saveAll();
        return interaction.update({ content: '✅ Todos os emojis globais foram restaurados.', embeds: [emojiEmbed(0)], components: emojiComponents(0) });
      }
    } catch (err) {
      console.error('❌ Emojis globais:', err);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        interaction.reply({ content: '❌ Ocorreu um erro ao configurar os emojis.', ephemeral: true }).catch(() => {});
      }
    }
  });
}

module.exports = {
  ENTRIES,
  initGlobalEmojisPersistentConfig,
  installGlobalEmojiRestPatch,
  setupGlobalEmojis,
  transformText,
  transformPayload,
};
