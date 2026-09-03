const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const fs = require('fs');
const path = require('path');
const { mainConfigEmbed, mainConfigComponents } = require('./management-extras');
const { migrateJson, loadJson, saveJson } = require('./storage');
const { loadPersistentConfig, savePersistentConfig, loadPersistentText, savePersistentText } = require('./persistent-config');

const LEGACY_CONFIG_PATH = path.join(__dirname, 'suggestions-config.json');
const LEGACY_DATA_PATH = path.join(__dirname, 'suggestions-data.json');

const STATUS = {
  em_analise: '🟡 Em análise',
  aguardando_resposta: '🔵 Aguardando resposta',
  recomendada: '⭐ Recomendada à direção',
  aceita: '🟢 Aceita',
  recusada: '🔴 Recusada',
};

const DEFAULT_CONFIG = {
  guildId: '',
  suggestionChannelId: '',
  reviewChannelId: '',
  directorChannelId: '',
  suggestionTeamRoleIds: [],
  directorRoleIds: [],
  embedColor: 0x2b2d31,
  bannerUrl: '',
  panelFooter: 'Cidade Alta • Sistema de Sugestões',
  panelMessageId: '',
  emojis: {
    idea: '💡',
    send: '💡',
    success: '✅',
    approve: '✅',
    reject: '❌',
    details: '💬',
    highlight: '⭐',
    accept: '🟢',
    analysis: '🟡',
    reply: '📝',
  },
};

const CONFIG_PATH = migrateJson('suggestions-config.json', LEGACY_CONFIG_PATH, DEFAULT_CONFIG);
const DATA_PATH = migrateJson('suggestions-data.json', LEGACY_DATA_PATH, { lastId: 0, suggestions: [] });

function loadConfig() {
  return { ...DEFAULT_CONFIG, ...loadJson(CONFIG_PATH, DEFAULT_CONFIG) };
}

async function initSuggestionsPersistentConfig() {
  const local = loadConfig();
  const restored = await loadPersistentConfig('suggestions', local);
  const merged = { ...DEFAULT_CONFIG, ...(restored || {}) };
  saveJson(CONFIG_PATH, merged);

  // Também persiste o histórico das sugestões. Assim rebuild/deploy não zera IDs
  // nem sugestões antigas quando o filesystem da hospedagem é recriado.
  const localData = loadData();
  const restoredDataText = await loadPersistentText('suggestions_data_v561', JSON.stringify(localData));
  let restoredData = localData;
  try {
    const parsed = JSON.parse(restoredDataText || '{}');
    if (parsed && typeof parsed === 'object') restoredData = parsed;
  } catch {}
  if (!Array.isArray(restoredData.suggestions)) restoredData.suggestions = [];
  if (!Number.isInteger(restoredData.lastId)) restoredData.lastId = 0;
  saveJson(DATA_PATH, restoredData);
  return merged;
}

function saveConfig(config) {
  const merged = { ...DEFAULT_CONFIG, ...config };
  saveJson(CONFIG_PATH, merged);
  // Mantém o canal de storage atualizado sem travar a interação do usuário.
  savePersistentConfig('suggestions', merged).catch(err =>
    console.error('❌ Falha ao sincronizar sugestões com o canal de storage:', err.message)
  );
}

function loadData() {
  const d = loadJson(DATA_PATH, { lastId: 0, suggestions: [] });
  if (!Array.isArray(d.suggestions)) d.suggestions = [];
  if (!Number.isInteger(d.lastId)) d.lastId = 0;
  return d;
}

function saveData(data) {
  saveJson(DATA_PATH, data);
  savePersistentText('suggestions_data_v561', JSON.stringify(data)).catch(err =>
    console.error('❌ Falha ao sincronizar dados de sugestões com o storage:', err.message)
  );
}

function code(id) {
  return `CDA-SUG-${String(id).padStart(4, '0')}`;
}

function getSuggestion(id) {
  return loadData().suggestions.find(s => s.id === Number(id)) || null;
}

function updateSuggestion(id, patch) {
  const data = loadData();
  const idx = data.suggestions.findIndex(s => s.id === Number(id));
  if (idx === -1) return null;
  data.suggestions[idx] = { ...data.suggestions[idx], ...patch };
  saveData(data);
  return data.suggestions[idx];
}

function addHistory(id, actorId, action, note = '') {
  const data = loadData();
  const idx = data.suggestions.findIndex(s => s.id === Number(id));
  if (idx === -1) return;
  data.suggestions[idx].history ||= [];
  data.suggestions[idx].history.push({
    actorId,
    action,
    note,
    at: new Date().toISOString(),
  });
  data.suggestions[idx].history = data.suggestions[idx].history.slice(-30);
  saveData(data);
}

function createSuggestion(guildId, userId, title, category, description, benefit) {
  const data = loadData();
  data.lastId += 1;
  const item = {
    id: data.lastId,
    guildId,
    userId,
    title,
    category,
    description,
    benefit,
    status: 'em_analise',
    highlighted: false,
    createdAt: new Date().toISOString(),
    reviewChannelId: '',
    reviewMessageId: '',
    directorChannelId: '',
    directorMessageId: '',
    detailsQuestion: '',
    detailsAnswer: '',
    detailsRequestedBy: '',
    dmMessageId: '',
    reviewNote: '',
    reviewerId: '',
    decisionBy: '',
    decisionAt: '',
    history: [
      { actorId: userId, action: 'Sugestão enviada', note: '', at: new Date().toISOString() },
    ],
  };
  data.suggestions.push(item);
  saveData(data);
  return item;
}

function isAdmin(interaction) {
  return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator));
}

function hasAnyRole(interaction, ids = []) {
  if (isAdmin(interaction)) return true;
  const cache = interaction.member?.roles?.cache;
  if (!cache) return false;
  return ids.some(id => cache.has(String(id)));
}

function isTeam(interaction, config) {
  return isAdmin(interaction)
    || hasAnyRole(interaction, config.suggestionTeamRoleIds)
    || hasAnyRole(interaction, config.directorRoleIds);
}

function isDirector(interaction, config) {
  return isAdmin(interaction) || hasAnyRole(interaction, config.directorRoleIds);
}

function parseEmoji(value, fallback) {
  const v = String(value || fallback || '').trim();
  const m = v.match(/^<(?:(a)?):([A-Za-z0-9_]+):(\d+)>$/);
  if (m) return { animated: Boolean(m[1]), name: m[2], id: m[3] };
  return v || fallback || '💡';
}

function em(config, key, fallback) {
  return String(config.emojis?.[key] || fallback);
}

function panelEmbed(config) {
  const e = new EmbedBuilder()
    .setColor(config.embedColor || 0x5865f2)
    .setTitle(`${em(config, 'idea', '💡')} CENTRAL DE SUGESTÕES`)
    .setDescription(
      'Tem uma ideia que pode deixar o **Cidade Alta** ainda melhor?\n' +
      'Envie para a nossa equipe — cada sugestão é analisada com atenção.\n\n' +
      '**Escolha qualquer área e conte sua ideia:**'
    )
    .addFields(
      { name: '🎮 Roleplay', value: 'Experiência, sistemas e melhorias no RP.', inline: true },
      { name: '👥 Equipe', value: 'Organização, atendimento e administração.', inline: true },
      { name: '🚔 Times', value: 'Corporações, facções e outros grupos.', inline: true },
      { name: '🎉 Eventos', value: 'Novas atividades, competições e ações.', inline: true },
      { name: '🤖 Discord / Bots', value: 'Canais, bots, comandos e automações.', inline: true },
      { name: '💡 Outras ideias', value: 'Qualquer melhoria que não esteja acima.', inline: true },
      { name: '📨 Como enviar?', value: 'Clique em **Enviar sugestão** abaixo e preencha as informações.', inline: false },
    )
    .setFooter({ text: config.panelFooter || 'Cidade Alta • Sistema de Sugestões' });

  if (config.bannerUrl) e.setImage(config.bannerUrl);
  return e;
}

function reviewEmbed(s, config) {
  const title = `💡 SUGESTÃO — ${code(s.id)}${s.highlighted ? ' ⭐ DESTAQUE' : ''}`;
  const e = new EmbedBuilder()
    .setColor(config.embedColor || 0x2b2d31)
    .setTitle(title)
    .addFields(
      { name: '👤 Autor', value: `<@${s.userId}> (\`${s.userId}\`)`, inline: false },
      { name: '📂 Categoria', value: s.category || '—', inline: true },
      { name: '📌 Status', value: STATUS[s.status] || s.status, inline: true },
      { name: '📝 Título', value: s.title || '—', inline: false },
      { name: '💭 Sugestão', value: s.description || '—', inline: false },
      { name: '✨ Benefício', value: s.benefit || '—', inline: false },
    )
    .setTimestamp(new Date(s.createdAt))
    .setFooter({ text: code(s.id) });

  if (s.detailsQuestion) e.addFields({ name: '💬 Pergunta da equipe', value: s.detailsQuestion, inline: false });
  if (s.detailsAnswer) e.addFields({ name: '📨 Resposta do autor', value: s.detailsAnswer, inline: false });
  if (s.reviewNote) e.addFields({ name: '⭐ Parecer da Equipe', value: s.reviewNote, inline: false });
  return e;
}

function directorEmbed(s, config) {
  const e = new EmbedBuilder()
    .setColor(config.embedColor || 0x2b2d31)
    .setTitle(`⭐ SUGESTÃO RECOMENDADA — ${code(s.id)}`)
    .setDescription('A Equipe de Sugestões recomendou esta ideia para decisão da direção.')
    .addFields(
      { name: '👤 Autor', value: `<@${s.userId}>`, inline: true },
      { name: '📂 Categoria', value: s.category || '—', inline: true },
      { name: '📌 Status', value: STATUS[s.status] || s.status, inline: true },
      { name: '📝 Título', value: s.title || '—', inline: false },
      { name: '💭 Sugestão', value: s.description || '—', inline: false },
      { name: '✨ Benefício', value: s.benefit || '—', inline: false },
      { name: '⭐ Parecer da Equipe', value: s.reviewNote || '—', inline: false },
    );

  if (s.reviewerId) e.addFields({ name: '👮 Analisada por', value: `<@${s.reviewerId}>`, inline: true });
  if (s.decisionBy) e.addFields({ name: '🏛️ Decisão por', value: `<@${s.decisionBy}>`, inline: true });
  return e;
}

function panelComponents(config) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('cda_sug_send')
        .setLabel('Enviar sugestão')
        .setStyle(ButtonStyle.Primary)
        .setEmoji(parseEmoji(config.emojis?.send, '💡'))
    ),
  ];
}

function reviewComponents(config) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cda_sug_approve').setLabel('Aprovar').setStyle(ButtonStyle.Success).setEmoji(parseEmoji(config.emojis?.approve, '✅')),
      new ButtonBuilder().setCustomId('cda_sug_reject').setLabel('Recusar').setStyle(ButtonStyle.Danger).setEmoji(parseEmoji(config.emojis?.reject, '❌')),
      new ButtonBuilder().setCustomId('cda_sug_details').setLabel('Solicitar detalhes').setStyle(ButtonStyle.Secondary).setEmoji(parseEmoji(config.emojis?.details, '💬')),
      new ButtonBuilder().setCustomId('cda_sug_highlight').setLabel('Destacar').setStyle(ButtonStyle.Secondary).setEmoji(parseEmoji(config.emojis?.highlight, '⭐')),
    ),
  ];
}

function directorComponents(config) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cda_sug_final_accept').setLabel('Aceitar').setStyle(ButtonStyle.Success).setEmoji(parseEmoji(config.emojis?.accept, '🟢')),
      new ButtonBuilder().setCustomId('cda_sug_final_reject').setLabel('Recusar').setStyle(ButtonStyle.Danger).setEmoji(parseEmoji(config.emojis?.reject, '❌')),
      new ButtonBuilder().setCustomId('cda_sug_final_analysis').setLabel('Manter em análise').setStyle(ButtonStyle.Secondary).setEmoji(parseEmoji(config.emojis?.analysis, '🟡')),
    ),
  ];
}

function configHomeEmbed(config) {
  const roleText = ids => ids?.length ? ids.map(id => `<@&${id}>`).join(', ') : '`Não configurado`';
  const ch = id => id ? `<#${id}>` : '`Não configurado`';

  return new EmbedBuilder()
    .setColor(config.embedColor || 0x2b2d31)
    .setTitle('⚙️ Configuração do Bot — Sugestões')
    .setDescription('Configure tudo aqui. As alterações são salvas automaticamente.')
    .addFields(
      { name: '👥 Equipe de Sugestões', value: roleText(config.suggestionTeamRoleIds), inline: false },
      { name: '🏛️ Direção', value: roleText(config.directorRoleIds), inline: false },
      { name: '📨 Canal do painel', value: ch(config.suggestionChannelId), inline: true },
      { name: '📥 Canal de análise/logs', value: ch(config.reviewChannelId), inline: true },
      { name: '⭐ Canal da direção', value: ch(config.directorChannelId), inline: true },
      { name: '🖼️ Imagem da embed', value: config.bannerUrl ? `[Configurada](${config.bannerUrl})` : '`Não configurada`', inline: false },
    )
    .setFooter({ text: 'Somente Administradores podem usar /botconfig.' });
}

function configHomeComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cda_cfg_roles').setLabel('Cargos').setStyle(ButtonStyle.Primary).setEmoji('👥'),
      new ButtonBuilder().setCustomId('cda_cfg_channels').setLabel('Canais').setStyle(ButtonStyle.Primary).setEmoji('📁'),
      new ButtonBuilder().setCustomId('cda_cfg_emojis').setLabel('Emojis').setStyle(ButtonStyle.Secondary).setEmoji('🎨'),
      new ButtonBuilder().setCustomId('cda_cfg_image').setLabel('Imagem').setStyle(ButtonStyle.Secondary).setEmoji('🖼️'),
      new ButtonBuilder().setCustomId('cda_cfg_publish').setLabel('Publicar painel').setStyle(ButtonStyle.Success).setEmoji('📨'),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cda_main_back').setLabel('Voltar ao menu').setStyle(ButtonStyle.Secondary).setEmoji('↩️')
    ),
  ];
}

function configRoleComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId('cda_cfg_team_roles')
        .setPlaceholder('Cargo(s) da Equipe de Sugestões')
        .setMinValues(1)
        .setMaxValues(5)
    ),
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId('cda_cfg_director_roles')
        .setPlaceholder('Cargo(s) da Direção')
        .setMinValues(1)
        .setMaxValues(5)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cda_cfg_back').setLabel('Voltar').setStyle(ButtonStyle.Secondary).setEmoji('↩️')
    ),
  ];
}

function configChannelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('cda_cfg_suggestion_channel')
        .setPlaceholder('Canal público do painel')
        .addChannelTypes(ChannelType.GuildText)
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('cda_cfg_review_channel')
        .setPlaceholder('Canal privado de análise / logs')
        .addChannelTypes(ChannelType.GuildText)
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('cda_cfg_director_channel')
        .setPlaceholder('Canal das melhores sugestões / direção')
        .addChannelTypes(ChannelType.GuildText)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cda_cfg_back').setLabel('Voltar').setStyle(ButtonStyle.Secondary).setEmoji('↩️')
    ),
  ];
}

function configEmojiComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cda_cfg_emoji_main').setLabel('Emojis principais').setStyle(ButtonStyle.Secondary).setEmoji('🎨'),
      new ButtonBuilder().setCustomId('cda_cfg_emoji_extra').setLabel('Emojis extras').setStyle(ButtonStyle.Secondary).setEmoji('✨'),
      new ButtonBuilder().setCustomId('cda_cfg_back').setLabel('Voltar').setStyle(ButtonStyle.Secondary).setEmoji('↩️')
    ),
  ];
}

async function refreshMessages(client, id) {
  const config = loadConfig();
  const s = getSuggestion(id);
  if (!s) return;

  if (s.reviewChannelId && s.reviewMessageId) {
    try {
      const channel = await client.channels.fetch(s.reviewChannelId);
      const msg = await channel.messages.fetch(s.reviewMessageId);
      await msg.edit({ embeds: [reviewEmbed(s, config)], components: reviewComponents(config) });
    } catch {}
  }

  if (s.directorChannelId && s.directorMessageId) {
    try {
      const channel = await client.channels.fetch(s.directorChannelId);
      const msg = await channel.messages.fetch(s.directorMessageId);
      await msg.edit({ embeds: [directorEmbed(s, config)], components: directorComponents(config) });
    } catch {}
  }
}

async function dmStatus(client, userId, id, title, description) {
  try {
    const user = await client.users.fetch(userId);
    await user.send({
      embeds: [
        new EmbedBuilder()
          .setColor(loadConfig().embedColor || 0x2b2d31)
          .setTitle(title)
          .setDescription(`**${code(id)}**\n\n${description}`),
      ],
    });
  } catch {}
}

async function findByMessage(messageId, type) {
  const data = loadData();
  if (type === 'review') return data.suggestions.find(s => s.reviewMessageId === messageId) || null;
  if (type === 'director') return data.suggestions.find(s => s.directorMessageId === messageId) || null;
  if (type === 'dm') return data.suggestions.find(s => s.dmMessageId === messageId) || null;
  return null;
}

async function ensureCommands(guild) {
  const desired = [
    {
      name: 'botconfig',
      description: 'Configura o sistema de sugestões pelo Discord.',
    },
    {
      name: 'painelsugestao',
      description: 'Publica o painel oficial de sugestões.',
    },
    {
      name: 'conferirid',
      description: 'Consulta uma conta do Roblox pelo ID numérico.',
      options: [
        {
          type: 3,
          name: 'id',
          description: 'ID numérico do usuário no Roblox.',
          required: true,
          min_length: 1,
          max_length: 20,
        },
      ],
    },
    {
      name: 'minhassugestoes',
      description: 'Mostra suas sugestões recentes.',
    },
    {
      name: 'sugestao',
      description: 'Consulta uma sugestão pelo ID.',
      options: [
        {
          type: 4,
          name: 'id',
          description: 'Número da sugestão. Ex.: 42',
          required: true,
          min_value: 1,
        },
      ],
    },
  ];

  const existing = await guild.commands.fetch();
  for (const cmd of desired) {
    const found = existing.find(c => c.name === cmd.name);
    if (found) await found.edit(cmd);
    else await guild.commands.create(cmd);
  }
}

function modalInput(id, label, style = TextInputStyle.Short, required = true, maxLength = 500, placeholder = '') {
  return new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style)
    .setRequired(required)
    .setMaxLength(maxLength)
    .setPlaceholder(placeholder);
}

function one(input) {
  return new ActionRowBuilder().addComponents(input);
}

async function refreshSuggestionPanel(client) {
  const config = loadConfig();
  if (!config.suggestionChannelId) return;
  const channel = await client.channels.fetch(config.suggestionChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  // Remove painéis anteriores mesmo se o panelMessageId tiver sido perdido em um deploy.
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (recent) {
    for (const old of recent.values()) {
      const title = old.embeds?.[0]?.title || '';
      if (old.author?.id === client.user.id && title.includes('CENTRAL DE SUGESTÕES')) await old.delete().catch(() => {});
    }
  } else if (config.panelMessageId) {
    const old = await channel.messages.fetch(config.panelMessageId).catch(() => null);
    if (old) await old.delete().catch(() => {});
  }

  const msg = await channel.send({ embeds: [panelEmbed(config)], components: panelComponents(config) });
  config.panelMessageId = msg.id;
  saveConfig(config);
}

function setupSuggestions(client, startupReady = Promise.resolve()) {
  client.once('ready', async () => {
    await startupReady;
    try {
      const config = loadConfig();

      // Tenta usar primeiro o ID salvo nas sugestões. Se estiver vazio,
      // reaproveita automaticamente o guildId do config.json principal.
      let mainGuildId = '';
      try {
        const mainConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
        mainGuildId = String(mainConfig.guildId || '').trim();
      } catch {}

      const guildId = String(config.guildId || process.env.GUILD_ID || mainGuildId || '').trim();

      if (!guildId) {
        throw new Error('Guild ID não encontrado em suggestions-config.json, GUILD_ID ou config.json.');
      }

      const guild = await client.guilds.fetch(guildId);
      config.guildId = guild.id;
      saveConfig(config);

      await ensureCommands(guild);
      console.log(`💡 Sistema de Sugestões: comandos registrados em ${guild.name} (${guild.id}).`);
      console.log('✅ /botconfig registrado e pronto para uso.');
      setInterval(() => refreshSuggestionPanel(client).catch(e => console.error('⚠️ Auto painel sugestões:', e.message)), 20 * 60_000).unref?.();
    } catch (e) {
      console.error('❌ Sugestões - comandos:', e.message);
    }
  });

  client.on('interactionCreate', async interaction => {
    if (!global.__CDA_STARTUP_READY) return;
    await startupReady;
    try {
      const config = loadConfig();

      // Slash commands
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'botconfig') {
          // Confirma a interação imediatamente. Assim o Discord nunca estoura os 3s
          // mesmo se a hospedagem/storage estiver lento ou o painel precisar de fallback.
          if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ ephemeral: true });
          }
          if (!isAdmin(interaction)) {
            return interaction.editReply({ content: '❌ Apenas quem possui **Administrador** pode usar `/botconfig`.', embeds: [], components: [] });
          }
          config.guildId = interaction.guildId;
          saveConfig(config);
          try {
            return await interaction.editReply({
              embeds: [mainConfigEmbed()],
              components: mainConfigComponents(),
              content: null,
            });
          } catch (panelErr) {
            console.error('❌ /botconfig painel:', panelErr);
            // Mesmo que algum emoji/componente configurado esteja inválido,
            // o usuário recebe resposta e o erro não vira "o aplicativo não respondeu".
            return interaction.editReply({
              content: '⚠️ O `/botconfig` abriu, mas algum componente/emoji configurado está inválido. O bot aplicou o modo seguro; tente novamente após o painel recarregar.',
              embeds: [],
              components: [],
            }).catch(() => null);
          }
        }

        if (interaction.commandName === 'conferirid') {
          const robloxId = interaction.options.getString('id', true).trim();
          if (!/^\d+$/.test(robloxId) || robloxId === '0') {
            return interaction.reply({ content: '❌ Informe um **ID numérico válido** do Roblox.', ephemeral: true });
          }

          await interaction.deferReply();
          try {
            const userRes = await fetch(`https://users.roblox.com/v1/users/${robloxId}`, {
              headers: { 'Accept': 'application/json', 'User-Agent': 'CDA-Gestao/1.0' },
              signal: AbortSignal.timeout(8000),
            });
            if (userRes.status === 404) return interaction.editReply('❌ Usuário do Roblox não encontrado. Confira o ID e tente novamente.');
            if (!userRes.ok) throw new Error(`Roblox Users API: HTTP ${userRes.status}`);
            const user = await userRes.json();

            let avatarUrl = null;
            const thumbRes = await fetch(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${robloxId}&size=420x420&format=Png&isCircular=false`, {
              headers: { 'Accept': 'application/json', 'User-Agent': 'CDA-Gestao/1.0' },
              signal: AbortSignal.timeout(8000),
            });
            if (thumbRes.ok) {
              const thumb = await thumbRes.json();
              avatarUrl = thumb?.data?.[0]?.imageUrl || null;
            }

            const embed = new EmbedBuilder()
              .setColor(0xFF8C00)
              .setTitle('🔎 CONSULTA DE ID — ROBLOX')
              .addFields(
                { name: '<:emoji_106:1275138504933773312> Username do nerdola', value: `\`${user.name || 'Não disponível'}\``, inline: true },
                { name: '<:emoji_212:1486421109287948439> Display nick do randola', value: `\`${user.displayName || user.name || 'Não disponível'}\``, inline: true },
                { name: '<:notasbs:1362612387026567179> ID', value: `\`${user.id || robloxId}\``, inline: false },
              )
              .setFooter({ text: 'Cidade Alta RP • Gestão' })
              .setTimestamp();
            if (avatarUrl) embed.setImage(avatarUrl);
            return interaction.editReply({ embeds: [embed] });
          } catch (e) {
            console.error('❌ /conferirid:', e.message || e);
            return interaction.editReply('⚠️ Não consegui consultar o Roblox agora. Tente novamente em alguns instantes.');
          }
        }

        if (interaction.commandName === 'painelsugestao') {
          if (!isDirector(interaction, config)) {
            return interaction.reply({ content: '❌ Você não tem permissão para publicar o painel.', ephemeral: true });
          }
          const channel = interaction.guild?.channels.cache.get(config.suggestionChannelId);
          if (!channel || !channel.isTextBased()) {
            return interaction.reply({ content: '⚠️ Configure o canal público primeiro em `/botconfig`.', ephemeral: true });
          }
          const panelMsg = await channel.send({ embeds: [panelEmbed(config)], components: panelComponents(config) });
          config.panelMessageId = panelMsg.id; saveConfig(config);
          return interaction.reply({ content: `✅ Painel publicado em ${channel}.`, ephemeral: true });
        }

        if (interaction.commandName === 'minhassugestoes') {
          const rows = loadData().suggestions
            .filter(s => s.guildId === interaction.guildId && s.userId === interaction.user.id)
            .sort((a, b) => b.id - a.id)
            .slice(0, 10);

          if (!rows.length) return interaction.reply({ content: 'Você ainda não enviou nenhuma sugestão.', ephemeral: true });

          const text = rows.map(s => `**${code(s.id)}** — ${STATUS[s.status] || s.status}\n└ ${s.title}`).join('\n\n');
          return interaction.reply({
            embeds: [new EmbedBuilder().setColor(config.embedColor || 0x2b2d31).setTitle('💡 Minhas sugestões').setDescription(text)],
            ephemeral: true,
          });
        }

        if (interaction.commandName === 'sugestao') {
          if (!isTeam(interaction, config)) {
            return interaction.reply({ content: '❌ Esse comando é exclusivo da equipe.', ephemeral: true });
          }
          const id = interaction.options.getInteger('id', true);
          const s = getSuggestion(id);
          if (!s || s.guildId !== interaction.guildId) {
            return interaction.reply({ content: 'Sugestão não encontrada.', ephemeral: true });
          }
          const hist = (s.history || []).slice(-8).map(h => `• <@${h.actorId}>: **${h.action}**${h.note ? ` — ${h.note.slice(0, 160)}` : ''}`).join('\n');
          const e = reviewEmbed(s, config);
          if (hist) e.addFields({ name: '📜 Histórico recente', value: hist.slice(-1000), inline: false });
          return interaction.reply({ embeds: [e], ephemeral: true });
        }
      }

      // Menu principal do /botconfig
      if (interaction.isButton() && interaction.customId === 'cda_main_suggestions') {
        if (!isAdmin(interaction)) {
          return interaction.reply({ content: '❌ Somente Administradores podem configurar.', ephemeral: true });
        }
        return interaction.update({ embeds: [configHomeEmbed(config)], components: configHomeComponents(), content: null });
      }

      // Config buttons
      if (interaction.isButton() && interaction.customId.startsWith('cda_cfg_')) {
        if (!isAdmin(interaction)) {
          return interaction.reply({ content: '❌ Somente Administradores podem configurar.', ephemeral: true });
        }

        if (interaction.customId === 'cda_cfg_roles') {
          return interaction.update({ embeds: [configHomeEmbed(config)], components: configRoleComponents() });
        }
        if (interaction.customId === 'cda_cfg_channels') {
          return interaction.update({ embeds: [configHomeEmbed(config)], components: configChannelComponents() });
        }
        if (interaction.customId === 'cda_cfg_emojis') {
          return interaction.update({ embeds: [configHomeEmbed(config)], components: configEmojiComponents() });
        }
        if (interaction.customId === 'cda_cfg_image') {
          const modal = new ModalBuilder().setCustomId('cda_cfg_image_modal').setTitle('Imagem da embed');
          const input = modalInput('bannerUrl', 'URL da imagem (vazio = remover)', TextInputStyle.Short, false, 1000, 'https://exemplo.com/banner.png');
          if (config.bannerUrl) input.setValue(config.bannerUrl);
          modal.addComponents(one(input));
          return interaction.showModal(modal);
        }

        if (interaction.customId === 'cda_cfg_back') {
          return interaction.update({ embeds: [configHomeEmbed(config)], components: configHomeComponents() });
        }
        if (interaction.customId === 'cda_cfg_publish') {
          const channel = interaction.guild?.channels.cache.get(config.suggestionChannelId);
          if (!channel || !channel.isTextBased()) {
            return interaction.reply({ content: '⚠️ Primeiro configure o canal público.', ephemeral: true });
          }
          const panelMsg = await channel.send({ embeds: [panelEmbed(config)], components: panelComponents(config) });
          config.panelMessageId = panelMsg.id; saveConfig(config);
          return interaction.reply({ content: `✅ Painel publicado em ${channel}.`, ephemeral: true });
        }

        if (interaction.customId === 'cda_cfg_emoji_main') {
          const modal = new ModalBuilder().setCustomId('cda_cfg_emoji_main_modal').setTitle('Emojis principais');
          modal.addComponents(
            one(modalInput('idea', 'Emoji do painel', TextInputStyle.Short, false, 100, '<:ideia:ID> ou 💡').setValue(config.emojis?.idea || '')),
            one(modalInput('approve', 'Emoji de aprovar', TextInputStyle.Short, false, 100, '<:aprovar:ID> ou ✅').setValue(config.emojis?.approve || '')),
            one(modalInput('reject', 'Emoji de recusar', TextInputStyle.Short, false, 100, '<:recusar:ID> ou ❌').setValue(config.emojis?.reject || '')),
            one(modalInput('details', 'Emoji de solicitar detalhes', TextInputStyle.Short, false, 100, '<:detalhes:ID> ou 💬').setValue(config.emojis?.details || '')),
            one(modalInput('highlight', 'Emoji de destacar', TextInputStyle.Short, false, 100, '<:estrela:ID> ou ⭐').setValue(config.emojis?.highlight || '')),
          );
          return interaction.showModal(modal);
        }

        if (interaction.customId === 'cda_cfg_emoji_extra') {
          const modal = new ModalBuilder().setCustomId('cda_cfg_emoji_extra_modal').setTitle('Emojis extras');
          modal.addComponents(
            one(modalInput('send', 'Emoji de enviar sugestão', TextInputStyle.Short, false, 100, '<:enviar:ID> ou 💡').setValue(config.emojis?.send || '')),
            one(modalInput('success', 'Emoji de sucesso', TextInputStyle.Short, false, 100, '<:sucesso:ID> ou ✅').setValue(config.emojis?.success || '')),
            one(modalInput('accept', 'Emoji de aceitar', TextInputStyle.Short, false, 100, '<:aceitar:ID> ou 🟢').setValue(config.emojis?.accept || '')),
            one(modalInput('analysis', 'Emoji de análise', TextInputStyle.Short, false, 100, '<:analise:ID> ou 🟡').setValue(config.emojis?.analysis || '')),
            one(modalInput('reply', 'Emoji de responder', TextInputStyle.Short, false, 100, '<:responder:ID> ou 📝').setValue(config.emojis?.reply || '')),
          );
          return interaction.showModal(modal);
        }
      }

      // Config select menus
      if (interaction.isRoleSelectMenu()) {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        if (interaction.customId === 'cda_cfg_team_roles') {
          config.suggestionTeamRoleIds = interaction.values;
          saveConfig(config);
          return interaction.reply({ content: `✅ Equipe de Sugestões: ${interaction.values.map(id => `<@&${id}>`).join(', ')}`, ephemeral: true });
        }
        if (interaction.customId === 'cda_cfg_director_roles') {
          config.directorRoleIds = interaction.values;
          saveConfig(config);
          return interaction.reply({ content: `✅ Direção: ${interaction.values.map(id => `<@&${id}>`).join(', ')}`, ephemeral: true });
        }
      }

      if (interaction.isChannelSelectMenu()) {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        const id = interaction.values[0];
        if (interaction.customId === 'cda_cfg_suggestion_channel') config.suggestionChannelId = id;
        if (interaction.customId === 'cda_cfg_review_channel') config.reviewChannelId = id;
        if (interaction.customId === 'cda_cfg_director_channel') config.directorChannelId = id;
        saveConfig(config);
        return interaction.reply({ content: `✅ Canal atualizado: <#${id}>`, ephemeral: true });
      }

      // Public panel -> modal
      if (interaction.isButton() && interaction.customId === 'cda_sug_send') {
        const modal = new ModalBuilder().setCustomId('cda_sug_send_modal').setTitle('Enviar sugestão');
        modal.addComponents(
          one(modalInput('title', 'Título da sugestão', TextInputStyle.Short, true, 80, 'Ex.: Evento semanal entre os times')),
          one(modalInput('category', 'Categoria', TextInputStyle.Short, true, 40, 'RP, Equipe, Times, Eventos, Discord/Bots...')),
          one(modalInput('description', 'Explique sua ideia', TextInputStyle.Paragraph, true, 1000, 'Descreva como sua sugestão funcionaria.')),
          one(modalInput('benefit', 'Por que isso melhoraria o CDA?', TextInputStyle.Paragraph, true, 600, 'Explique o benefício para a comunidade.')),
        );
        return interaction.showModal(modal);
      }

      // Review buttons
      if (interaction.isButton() && ['cda_sug_approve','cda_sug_reject','cda_sug_details','cda_sug_highlight'].includes(interaction.customId)) {
        if (!isTeam(interaction, config)) return interaction.reply({ content: '❌ Você não faz parte da Equipe de Sugestões.', ephemeral: true });
        const s = await findByMessage(interaction.message.id, 'review');
        if (!s) return interaction.reply({ content: 'Sugestão não encontrada.', ephemeral: true });
        if (['aceita','recusada'].includes(s.status)) return interaction.reply({ content: 'Essa sugestão já foi finalizada.', ephemeral: true });

        if (interaction.customId === 'cda_sug_highlight') {
          updateSuggestion(s.id, { highlighted: !s.highlighted });
          addHistory(s.id, interaction.user.id, s.highlighted ? 'Destaque removido' : 'Sugestão destacada');
          await refreshMessages(client, s.id);
          return interaction.reply({ content: '⭐ Destaque atualizado.', ephemeral: true });
        }

        if (interaction.customId === 'cda_sug_approve') {
          const modal = new ModalBuilder().setCustomId(`cda_sug_approve_modal:${s.id}`).setTitle('Recomendar à direção');
          modal.addComponents(one(modalInput('opinion', 'Parecer da Equipe de Sugestões', TextInputStyle.Paragraph, true, 700, 'Por que essa ideia merece ir para a direção?')));
          return interaction.showModal(modal);
        }

        if (interaction.customId === 'cda_sug_reject') {
          const modal = new ModalBuilder().setCustomId(`cda_sug_reject_modal:${s.id}:team`).setTitle('Recusar sugestão');
          modal.addComponents(one(modalInput('reason', 'Motivo', TextInputStyle.Paragraph, true, 600, 'Explique o motivo da recusa.')));
          return interaction.showModal(modal);
        }

        if (interaction.customId === 'cda_sug_details') {
          const modal = new ModalBuilder().setCustomId(`cda_sug_details_modal:${s.id}`).setTitle('Solicitar detalhes');
          modal.addComponents(one(modalInput('question', 'Pergunta para o autor', TextInputStyle.Paragraph, true, 700, 'O que a equipe precisa entender melhor?')));
          return interaction.showModal(modal);
        }
      }

      // Director buttons
      if (interaction.isButton() && ['cda_sug_final_accept','cda_sug_final_reject','cda_sug_final_analysis'].includes(interaction.customId)) {
        if (!isDirector(interaction, config)) return interaction.reply({ content: '❌ Somente a direção pode tomar a decisão final.', ephemeral: true });
        const s = await findByMessage(interaction.message.id, 'director');
        if (!s) return interaction.reply({ content: 'Sugestão não encontrada.', ephemeral: true });
        if (['aceita','recusada'].includes(s.status)) return interaction.reply({ content: 'Essa sugestão já foi finalizada.', ephemeral: true });

        if (interaction.customId === 'cda_sug_final_accept') {
          updateSuggestion(s.id, { status: 'aceita', decisionBy: interaction.user.id, decisionAt: new Date().toISOString() });
          addHistory(s.id, interaction.user.id, 'Decisão final: aceita');
          await refreshMessages(client, s.id);
          await dmStatus(client, s.userId, s.id, '🟢 Sua sugestão foi aceita!', 'A direção aprovou sua ideia. Obrigado por ajudar a melhorar o CDA.');
          return interaction.reply({ content: `🟢 **${code(s.id)}** aceita.`, ephemeral: true });
        }

        if (interaction.customId === 'cda_sug_final_reject') {
          const modal = new ModalBuilder().setCustomId(`cda_sug_reject_modal:${s.id}:director`).setTitle('Recusar sugestão');
          modal.addComponents(one(modalInput('reason', 'Motivo', TextInputStyle.Paragraph, true, 600, 'Explique o motivo da recusa.')));
          return interaction.showModal(modal);
        }

        if (interaction.customId === 'cda_sug_final_analysis') {
          updateSuggestion(s.id, { status: 'recomendada' });
          addHistory(s.id, interaction.user.id, 'Mantida em análise pela direção');
          await refreshMessages(client, s.id);
          return interaction.reply({ content: `🟡 **${code(s.id)}** permanece em análise.`, ephemeral: true });
        }
      }

      // DM reply button
      if (interaction.isButton() && interaction.customId === 'cda_sug_dm_reply') {
        const s = await findByMessage(interaction.message.id, 'dm');
        if (!s) return interaction.reply({ content: 'Essa solicitação não está mais disponível.', ephemeral: true });
        if (interaction.user.id !== s.userId) return interaction.reply({ content: 'Somente o autor pode responder.', ephemeral: true });
        const modal = new ModalBuilder().setCustomId(`cda_sug_dm_reply_modal:${s.id}`).setTitle('Responder à equipe');
        modal.addComponents(one(modalInput('answer', 'Sua resposta', TextInputStyle.Paragraph, true, 1000, 'Explique os detalhes solicitados.')));
        return interaction.showModal(modal);
      }

      // Modals
      if (interaction.isModalSubmit()) {
        if (interaction.customId === 'cda_cfg_image_modal') {
          if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
          const url = interaction.fields.getTextInputValue('bannerUrl').trim();
          if (url && !/^https?:\/\/\S+$/i.test(url)) {
            return interaction.reply({ content: '❌ Use uma URL válida começando com `http://` ou `https://`.', ephemeral: true });
          }
          config.bannerUrl = url;
          saveConfig(config);
          return interaction.reply({
            content: url ? '✅ Imagem da embed atualizada. Publique o painel novamente para visualizar.' : '✅ Imagem da embed removida.',
            ephemeral: true,
          });
        }

        if (interaction.customId === 'cda_cfg_emoji_main_modal') {
          if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
          config.emojis ||= {};
          for (const k of ['idea','approve','reject','details','highlight']) config.emojis[k] = interaction.fields.getTextInputValue(k).trim();
          saveConfig(config);
          return interaction.reply({ content: '✅ Emojis principais atualizados.', ephemeral: true });
        }

        if (interaction.customId === 'cda_cfg_emoji_extra_modal') {
          if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
          config.emojis ||= {};
          for (const k of ['send','success','accept','analysis','reply']) config.emojis[k] = interaction.fields.getTextInputValue(k).trim();
          saveConfig(config);
          return interaction.reply({ content: '✅ Emojis extras atualizados.', ephemeral: true });
        }

        if (interaction.customId === 'cda_sug_send_modal') {
          if (!config.reviewChannelId) return interaction.reply({ content: '⚠️ O canal de análise ainda não foi configurado.', ephemeral: true });

          const s = createSuggestion(
            interaction.guildId,
            interaction.user.id,
            interaction.fields.getTextInputValue('title'),
            interaction.fields.getTextInputValue('category'),
            interaction.fields.getTextInputValue('description'),
            interaction.fields.getTextInputValue('benefit'),
          );

          try {
            const channel = await client.channels.fetch(config.reviewChannelId);
            const msg = await channel.send({ embeds: [reviewEmbed(s, config)], components: reviewComponents(config) });
            updateSuggestion(s.id, { reviewChannelId: channel.id, reviewMessageId: msg.id });
          } catch {
            return interaction.reply({ content: `⚠️ **${code(s.id)}** foi salva, mas não consegui enviar para o canal de análise.`, ephemeral: true });
          }

          return interaction.reply({
            content: `${em(config, 'success', '✅')} **Sugestão enviada!** Seu protocolo é **${code(s.id)}**.`,
            ephemeral: true,
          });
        }

        if (interaction.customId.startsWith('cda_sug_approve_modal:')) {
          if (!isTeam(interaction, config)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
          const id = Number(interaction.customId.split(':')[1]);
          const s = getSuggestion(id);
          if (!s) return interaction.reply({ content: 'Sugestão não encontrada.', ephemeral: true });
          if (!config.directorChannelId) return interaction.reply({ content: '⚠️ O canal da direção ainda não foi configurado.', ephemeral: true });

          const opinion = interaction.fields.getTextInputValue('opinion');
          updateSuggestion(id, { status: 'recomendada', reviewNote: opinion, reviewerId: interaction.user.id });
          addHistory(id, interaction.user.id, 'Recomendada à direção', opinion);

          try {
            const channel = await client.channels.fetch(config.directorChannelId);
            const updated = getSuggestion(id);
            const msg = await channel.send({ embeds: [directorEmbed(updated, config)], components: directorComponents(config) });
            updateSuggestion(id, { directorChannelId: channel.id, directorMessageId: msg.id });
          } catch {
            return interaction.reply({ content: '⚠️ Não consegui enviar para o canal da direção.', ephemeral: true });
          }

          await refreshMessages(client, id);
          return interaction.reply({ content: `✅ **${code(id)}** enviada para a direção.`, ephemeral: true });
        }

        if (interaction.customId.startsWith('cda_sug_reject_modal:')) {
          const [, idText, scope] = interaction.customId.split(':');
          const id = Number(idText);
          const s = getSuggestion(id);
          if (!s) return interaction.reply({ content: 'Sugestão não encontrada.', ephemeral: true });

          const allowed = scope === 'director' ? isDirector(interaction, config) : isTeam(interaction, config);
          if (!allowed) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });

          const reason = interaction.fields.getTextInputValue('reason');
          updateSuggestion(id, { status: 'recusada', decisionBy: interaction.user.id, decisionAt: new Date().toISOString() });
          addHistory(id, interaction.user.id, scope === 'director' ? 'Decisão final: recusada' : 'Sugestão recusada pela equipe', reason);
          await refreshMessages(client, id);
          await dmStatus(client, s.userId, id, '🔴 Sua sugestão foi recusada.', `**Motivo:** ${reason}`);
          return interaction.reply({ content: `🔴 **${code(id)}** recusada.`, ephemeral: true });
        }

        if (interaction.customId.startsWith('cda_sug_details_modal:')) {
          if (!isTeam(interaction, config)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
          const id = Number(interaction.customId.split(':')[1]);
          const s = getSuggestion(id);
          if (!s) return interaction.reply({ content: 'Sugestão não encontrada.', ephemeral: true });

          const question = interaction.fields.getTextInputValue('question');
          try {
            const user = await client.users.fetch(s.userId);
            const msg = await user.send({
              embeds: [
                new EmbedBuilder()
                  .setColor(config.embedColor || 0x2b2d31)
                  .setTitle(`${em(config, 'details', '💬')} A equipe precisa de mais detalhes`)
                  .setDescription(
                    `Sua sugestão **${code(id)}** está sendo analisada.\n\n` +
                    `**Pergunta da equipe:**\n> ${question}\n\n` +
                    'Use o botão abaixo para responder.'
                  ),
              ],
              components: [
                new ActionRowBuilder().addComponents(
                  new ButtonBuilder()
                    .setCustomId('cda_sug_dm_reply')
                    .setLabel('Responder equipe')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji(parseEmoji(config.emojis?.reply, '📝'))
                ),
              ],
            });

            updateSuggestion(id, {
              status: 'aguardando_resposta',
              detailsQuestion: question,
              detailsAnswer: '',
              detailsRequestedBy: interaction.user.id,
              dmMessageId: msg.id,
            });
            addHistory(id, interaction.user.id, 'Detalhes solicitados', question);
            await refreshMessages(client, id);
            return interaction.reply({ content: `💬 Pergunta enviada por DM ao autor de **${code(id)}**.`, ephemeral: true });
          } catch {
            return interaction.reply({ content: '⚠️ Não consegui enviar DM ao autor. As mensagens diretas podem estar fechadas.', ephemeral: true });
          }
        }

        if (interaction.customId.startsWith('cda_sug_dm_reply_modal:')) {
          const id = Number(interaction.customId.split(':')[1]);
          const s = getSuggestion(id);
          if (!s) return interaction.reply({ content: 'Sugestão não encontrada.', ephemeral: true });
          if (interaction.user.id !== s.userId) return interaction.reply({ content: '❌ Somente o autor pode responder.', ephemeral: true });

          const answer = interaction.fields.getTextInputValue('answer');
          updateSuggestion(id, { status: 'em_analise', detailsAnswer: answer });
          addHistory(id, interaction.user.id, 'Autor respondeu à solicitação de detalhes', answer);

          try {
            const channel = await client.channels.fetch(config.reviewChannelId);
            await channel.send({
              embeds: [
                new EmbedBuilder()
                  .setColor(config.embedColor || 0x2b2d31)
                  .setTitle(`📨 Resposta recebida — ${code(id)}`)
                  .addFields(
                    { name: '👤 Autor', value: `<@${s.userId}>`, inline: true },
                    { name: '👮 Solicitado por', value: s.detailsRequestedBy ? `<@${s.detailsRequestedBy}>` : '—', inline: true },
                    { name: '💬 Pergunta', value: s.detailsQuestion || '—', inline: false },
                    { name: '📝 Resposta', value: answer, inline: false },
                  ),
              ],
            });
          } catch {}

          await refreshMessages(client, id);
          try { await interaction.message.edit({ components: [] }); } catch {}
          return interaction.reply({ content: `✅ Resposta enviada para a equipe sobre **${code(id)}**.`, ephemeral: true });
        }
      }
    } catch (e) {
      console.error('❌ Sugestões interaction:', e);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        try { await interaction.reply({ content: '❌ Ocorreu um erro no sistema de sugestões.', ephemeral: true }); } catch {}
      }
    }
  });
}

module.exports = { setupSuggestions, initSuggestionsPersistentConfig };
