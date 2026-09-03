const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextDisplayBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} = require('discord.js');
const path = require('path');
const { migrateJson, loadJson, saveJson } = require('./storage');
const { loadPersistentConfig, savePersistentConfig, loadPersistentText, savePersistentText } = require('./persistent-config');

const LEGACY_CONFIG_PATH = path.join(__dirname, 'management-extras-config.json');
const LEGACY_DATA_PATH = path.join(__dirname, 'management-extras-data.json');
const ORANGE = 0xFF8C00;
const EVALUATION_STORAGE_KEY = 'staff_evaluations_v2';
const MANAGEMENT_DATA_STORAGE_KEY = 'management_extras_data_v561';
const EVAL_EMOJIS = Object.freeze({
  title: '<:star:1544934787930923029>',
  user: '<:user:1544934789130223636>',
  correct: '<:correct:1544934786680881182>',
});

let evaluationStoreCache = { lastEvaluationId: 0, evaluations: [] };
let evaluationSaveQueue = Promise.resolve();

const DEFAULT_CONFIG = {
  evaluation: {
    panelChannelId: '',
    resultChannelId: '',
    announcementChannelId: '',
    evaluatorRoleIds: [],
    evaluableRoleIds: [],
    panelFooter: 'Cidade Alta • Sistema de Avaliações',
    rankingHour: 20,
    panelMessageId: '',
  },
  bugs: {
    panelChannelId: '',
    reportChannelId: '',
    managerRoleIds: [],
    panelFooter: 'Cidade Alta • Sistema de Bugs',
    panelMessageId: '',
  },
};

const DEFAULT_DATA = { lastEvaluationId: 0, evaluations: [], lastBugId: 0, bugs: [], lastRankingWeek: '' };

const CONFIG_PATH = migrateJson('management-extras-config.json', LEGACY_CONFIG_PATH, DEFAULT_CONFIG);
const DATA_PATH = migrateJson('management-extras-data.json', LEGACY_DATA_PATH, DEFAULT_DATA);

function deepMerge(base, value) {
  return {
    ...base,
    ...value,
    evaluation: { ...base.evaluation, ...(value?.evaluation || {}) },
    bugs: { ...base.bugs, ...(value?.bugs || {}) },
  };
}
function loadConfig() {
  return deepMerge(DEFAULT_CONFIG, loadJson(CONFIG_PATH, DEFAULT_CONFIG));
}
function normalizeEvaluationStore(value = {}) {
  return {
    lastEvaluationId: Number(value?.lastEvaluationId || 0),
    evaluations: Array.isArray(value?.evaluations) ? value.evaluations.filter(Boolean) : [],
  };
}

function evaluationIdentity(row) {
  return [
    row?.createdAt || '', row?.evaluatorId || '', row?.targetId || '',
    Number(row?.score ?? -1), String(row?.observation || '')
  ].join('|');
}

function mergeEvaluationStores(...stores) {
  const rows = [];
  const seen = new Set();
  let lastEvaluationId = 0;

  for (const raw of stores) {
    const store = normalizeEvaluationStore(raw);
    lastEvaluationId = Math.max(lastEvaluationId, store.lastEvaluationId);
    for (const row of store.evaluations) {
      const key = evaluationIdentity(row);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
      lastEvaluationId = Math.max(lastEvaluationId, Number(row?.id || 0));
    }
  }

  rows.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  return { lastEvaluationId, evaluations: rows };
}

async function initManagementPersistentConfig() {
  const local = loadConfig();
  const restored = await loadPersistentConfig('management_extras', local);
  const merged = deepMerge(DEFAULT_CONFIG, restored || {});
  saveJson(CONFIG_PATH, merged);

  // Restaura primeiro o backup legado (avaliações + bugs).
  // Isso permite migrar automaticamente as avaliações antigas para o novo backup dedicado.
  const localRaw = { ...DEFAULT_DATA, ...loadJson(DATA_PATH, DEFAULT_DATA) };
  if (!Array.isArray(localRaw.evaluations)) localRaw.evaluations = [];
  if (!Array.isArray(localRaw.bugs)) localRaw.bugs = [];

  const restoredDataText = await loadPersistentText(MANAGEMENT_DATA_STORAGE_KEY, JSON.stringify(localRaw));
  let restoredData = localRaw;
  try {
    const parsed = JSON.parse(restoredDataText || '{}');
    if (parsed && typeof parsed === 'object') restoredData = { ...DEFAULT_DATA, ...parsed };
  } catch {}
  if (!Array.isArray(restoredData.evaluations)) restoredData.evaluations = [];
  if (!Array.isArray(restoredData.bugs)) restoredData.bugs = [];

  // Backup V2 exclusivo das avaliações: um commit/rebuild não consegue zerar o histórico
  // apenas porque a pasta local foi substituída. O legado é usado como fallback/migração.
  const legacyEvalStore = normalizeEvaluationStore(restoredData);
  const dedicatedText = await loadPersistentText(EVALUATION_STORAGE_KEY, JSON.stringify(legacyEvalStore));
  let dedicatedStore = legacyEvalStore;
  try {
    const parsed = JSON.parse(dedicatedText || '{}');
    if (parsed && typeof parsed === 'object') dedicatedStore = normalizeEvaluationStore(parsed);
  } catch {}

  evaluationStoreCache = mergeEvaluationStores(legacyEvalStore, dedicatedStore);
  restoredData.lastEvaluationId = evaluationStoreCache.lastEvaluationId;
  restoredData.evaluations = evaluationStoreCache.evaluations;
  saveJson(DATA_PATH, restoredData);

  // Garante a migração das avaliações antigas para o backup dedicado já no primeiro boot.
  await savePersistentText(EVALUATION_STORAGE_KEY, JSON.stringify(evaluationStoreCache)).catch(() => false);
  return merged;
}
function saveConfig(v) {
  const merged = deepMerge(DEFAULT_CONFIG, v);
  saveJson(CONFIG_PATH, merged);
  // Mantém o canal de storage atualizado sem travar a interação do usuário.
  savePersistentConfig('management_extras', merged).catch(err =>
    console.error('❌ Falha ao sincronizar gestão com o canal de storage:', err.message)
  );
}
function loadData() {
  const d = { ...DEFAULT_DATA, ...loadJson(DATA_PATH, DEFAULT_DATA) };
  if (!Array.isArray(d.evaluations)) d.evaluations = [];
  if (!Array.isArray(d.bugs)) d.bugs = [];

  // Nunca deixa outro sistema (ex.: Bugs) sobrescrever o histórico de avaliações
  // usando uma cópia antiga do JSON em memória.
  const mergedEvaluations = mergeEvaluationStores(evaluationStoreCache, d);
  evaluationStoreCache = mergedEvaluations;
  d.lastEvaluationId = mergedEvaluations.lastEvaluationId;
  d.evaluations = mergedEvaluations.evaluations;
  return d;
}
function saveData(v) {
  const mergedEvaluations = mergeEvaluationStores(evaluationStoreCache, v);
  evaluationStoreCache = mergedEvaluations;
  const safe = {
    ...DEFAULT_DATA,
    ...v,
    lastEvaluationId: mergedEvaluations.lastEvaluationId,
    evaluations: mergedEvaluations.evaluations,
    bugs: Array.isArray(v?.bugs) ? v.bugs : [],
  };
  saveJson(DATA_PATH, safe);
  savePersistentText(MANAGEMENT_DATA_STORAGE_KEY, JSON.stringify(safe)).catch(err =>
    console.error('❌ Falha ao sincronizar avaliações/bugs com o storage:', err.message)
  );
}

function saveEvaluationData(v) {
  // Serializa gravações de avaliações. Sem isso, duas avaliações simultâneas poderiam
  // terminar fora de ordem no storage do Discord e uma versão antiga vencer a mais nova.
  const incoming = {
    ...v,
    evaluations: Array.isArray(v?.evaluations) ? [...v.evaluations] : [],
    bugs: Array.isArray(v?.bugs) ? [...v.bugs] : [],
  };

  const task = async () => {
    const mergedEvaluations = mergeEvaluationStores(evaluationStoreCache, incoming);
    evaluationStoreCache = mergedEvaluations;
    const safe = {
      ...DEFAULT_DATA,
      ...incoming,
      lastEvaluationId: mergedEvaluations.lastEvaluationId,
      evaluations: mergedEvaluations.evaluations,
      bugs: Array.isArray(incoming?.bugs) ? incoming.bugs : [],
    };
    saveJson(DATA_PATH, safe);

    // A avaliação só retorna sucesso depois de tentar gravar o backup dedicado no Discord.
    // O backup completo continua existindo por compatibilidade com as versões anteriores.
    const [evaluationBackup, fullBackup] = await Promise.all([
      savePersistentText(EVALUATION_STORAGE_KEY, JSON.stringify(mergedEvaluations)),
      savePersistentText(MANAGEMENT_DATA_STORAGE_KEY, JSON.stringify(safe)),
    ]);

    if (!evaluationBackup && !fullBackup) {
      console.error('❌ Avaliação salva localmente, mas o backup persistente do Discord não estava disponível.');
    }
    return safe;
  };

  evaluationSaveQueue = evaluationSaveQueue.then(task, task);
  return evaluationSaveQueue;
}

function isAdmin(i) { return Boolean(i.memberPermissions?.has(PermissionFlagsBits.Administrator)); }
function hasRole(i, ids = []) {
  if (isAdmin(i)) return true;
  return ids.some(id => i.member?.roles?.cache?.has(String(id)));
}
function mentions(ids = []) { return ids.length ? ids.map(id => `<@&${id}>`).join(', ') : '`Não configurado`'; }
function channel(id) { return id ? `<#${id}>` : '`Não configurado`'; }
function one(...components) { return new ActionRowBuilder().addComponents(...components); }
function input(id, label, style, required, max, placeholder) {
  return new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(max).setPlaceholder(placeholder || '');
}
function evaluationCode(id) { return `CDA-AVL-${String(id).padStart(4, '0')}`; }
function bugCode(id) { return `CDA-BUG-${String(id).padStart(4, '0')}`; }

function mainConfigEmbed() {
  return new EmbedBuilder()
    .setColor(ORANGE)
    .setTitle('⚙️ Configuração do Bot')
    .setDescription('Escolha abaixo qual sistema você deseja configurar.');
}
function mainConfigComponents() {
  return [one(
    new ButtonBuilder().setCustomId('cda_main_evaluations').setLabel('Configurar Avaliações').setEmoji('⭐').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('cda_main_bugs').setLabel('Configurar Bugs').setEmoji('🐛').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('cda_main_suggestions').setLabel('Configurar Sugestões').setEmoji('💡').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('cda_main_tickets').setLabel('Configurar Tickets').setEmoji('🎫').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('cda_main_global_emojis').setLabel('Todos os Emojis').setEmoji('🎨').setStyle(ButtonStyle.Secondary),
  )];
}

function evaluationConfigEmbed(c) {
  const e = c.evaluation;
  return new EmbedBuilder().setColor(ORANGE).setTitle('⭐ Configurar Avaliações')
    .setDescription('Configure os canais e cargos do sistema de avaliações.')
    .addFields(
      { name: '📌 Canal do painel', value: channel(e.panelChannelId), inline: true },
      { name: '📥 Canal das avaliações', value: channel(e.resultChannelId), inline: true },
      { name: '📢 Canal de avisos/ranking', value: channel(e.announcementChannelId), inline: true },
      { name: '🗳️ Quem pode avaliar', value: mentions(e.evaluatorRoleIds), inline: false },
      { name: '👥 Cargos que podem ser avaliados', value: mentions(e.evaluableRoleIds), inline: false },
      { name: '🏆 Ranking semanal', value: `Domingo às ${String(e.rankingHour ?? 20).padStart(2, '0')}:00 (Fortaleza)`, inline: false },
    );
}
function evaluationConfigComponents() {
  return [
    one(new ButtonBuilder().setCustomId('cda_eval_cfg_channels').setLabel('Canais').setEmoji('📁').setStyle(ButtonStyle.Primary)),
    one(new ButtonBuilder().setCustomId('cda_eval_cfg_roles').setLabel('Cargos').setEmoji('👥').setStyle(ButtonStyle.Primary)),
    one(new ButtonBuilder().setCustomId('cda_eval_cfg_publish').setLabel('Publicar painel').setEmoji('📨').setStyle(ButtonStyle.Success)),
    one(new ButtonBuilder().setCustomId('cda_main_back').setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary)),
  ];
}
function evaluationChannelsComponents() {
  return [
    one(new ChannelSelectMenuBuilder().setCustomId('cda_eval_cfg_panel_channel').setPlaceholder('Canal da embed fixa').addChannelTypes(ChannelType.GuildText)),
    one(new ChannelSelectMenuBuilder().setCustomId('cda_eval_cfg_result_channel').setPlaceholder('Canal onde as avaliações serão enviadas').addChannelTypes(ChannelType.GuildText)),
    one(new ChannelSelectMenuBuilder().setCustomId('cda_eval_cfg_announcement_channel').setPlaceholder('Canal de avisos / ranking semanal').addChannelTypes(ChannelType.GuildText)),
    one(new ButtonBuilder().setCustomId('cda_eval_cfg_back').setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary)),
  ];
}
function evaluationRolesComponents() {
  return [
    one(new RoleSelectMenuBuilder().setCustomId('cda_eval_cfg_evaluator_roles').setPlaceholder('Cargo(s) que podem avaliar').setMinValues(1).setMaxValues(5)),
    one(new RoleSelectMenuBuilder().setCustomId('cda_eval_cfg_evaluable_roles').setPlaceholder('Cargo(s) que podem ser avaliados').setMinValues(1).setMaxValues(10)),
    one(new ButtonBuilder().setCustomId('cda_eval_cfg_back').setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary)),
  ];
}

function bugConfigEmbed(c) {
  const b = c.bugs;
  return new EmbedBuilder().setColor(ORANGE).setTitle('🐛 Configurar Bugs')
    .setDescription('Configure o painel, destino dos relatórios e responsáveis.')
    .addFields(
      { name: '📌 Canal do painel', value: channel(b.panelChannelId), inline: true },
      { name: '📥 Canal dos relatórios', value: channel(b.reportChannelId), inline: true },
      { name: '🛠️ Responsáveis pelos bugs', value: mentions(b.managerRoleIds), inline: false },
    );
}
function bugConfigComponents() {
  return [
    one(new ButtonBuilder().setCustomId('cda_bug_cfg_channels').setLabel('Canais').setEmoji('📁').setStyle(ButtonStyle.Primary)),
    one(new ButtonBuilder().setCustomId('cda_bug_cfg_roles').setLabel('Cargos').setEmoji('👥').setStyle(ButtonStyle.Primary)),
    one(new ButtonBuilder().setCustomId('cda_bug_cfg_publish').setLabel('Publicar painel').setEmoji('📨').setStyle(ButtonStyle.Success)),
    one(new ButtonBuilder().setCustomId('cda_main_back').setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary)),
  ];
}
function bugChannelsComponents() {
  return [
    one(new ChannelSelectMenuBuilder().setCustomId('cda_bug_cfg_panel_channel').setPlaceholder('Canal da embed fixa de bugs').addChannelTypes(ChannelType.GuildText)),
    one(new ChannelSelectMenuBuilder().setCustomId('cda_bug_cfg_report_channel').setPlaceholder('Canal que recebe os bugs').addChannelTypes(ChannelType.GuildText)),
    one(new ButtonBuilder().setCustomId('cda_bug_cfg_back').setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary)),
  ];
}
function bugRolesComponents() {
  return [
    one(new RoleSelectMenuBuilder().setCustomId('cda_bug_cfg_manager_roles').setPlaceholder('Cargo(s) que gerenciam bugs').setMinValues(1).setMaxValues(5)),
    one(new ButtonBuilder().setCustomId('cda_bug_cfg_back').setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary)),
  ];
}

function evaluationPanelPayload() {
  const container = new ContainerBuilder()
    .setAccentColor(ORANGE)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ${EVAL_EMOJIS.title} AVALIAÇÃO DE STAFF\n\n` +
        `${EVAL_EMOJIS.user} **Selecione o membro** da equipe que deseja avaliar.\n\n` +
        `${EVAL_EMOJIS.correct} **Avalie** com responsabilidade e informe sua opinião de forma clara.`
      )
    )
    .addActionRowComponents(
      one(
        new ButtonBuilder()
          .setCustomId('cda_eval_start')
          .setLabel('Avaliar Staff')
          .setEmoji(EVAL_EMOJIS.correct)
          .setStyle(ButtonStyle.Primary)
      )
    );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

function evaluationPickerEmbed(state = {}) {
  const target = state.targetId ? `<@${state.targetId}>` : '`Ainda não selecionado`';
  const score = state.score !== undefined ? `**${state.score}/5**` : '`Ainda não selecionada`';
  return new EmbedBuilder()
    .setColor(ORANGE)
    .setTitle(`${EVAL_EMOJIS.title} Avaliar Staff`)
    .setDescription(`${EVAL_EMOJIS.user} **Membro:** ${target}\n${EVAL_EMOJIS.title} **Nota:** ${score}\n\nDepois de selecionar os dois campos, clique em **Continuar**.`);
}

function evaluationPickerComponents(state = {}) {
  const stars = [0,1,2,3,4,5].map(n => new StringSelectMenuOptionBuilder()
    .setLabel(`${n}/5`)
    .setValue(String(n))
    .setDescription(n === 0 ? 'Nota mínima' : `${'⭐'.repeat(n)}${'☆'.repeat(5-n)}`));
  return [
    one(new UserSelectMenuBuilder()
      .setCustomId('cda_eval_pick_user')
      .setPlaceholder(state.targetId ? 'Membro selecionado ✓' : 'Selecione o membro')
      .setMinValues(1).setMaxValues(1)),
    one(new StringSelectMenuBuilder()
      .setCustomId('cda_eval_pick_score')
      .setPlaceholder(state.score !== undefined ? `Nota selecionada: ${state.score}/5` : 'Selecione a nota de 0 a 5')
      .addOptions(stars)),
    one(new ButtonBuilder()
      .setCustomId('cda_eval_continue')
      .setLabel('Continuar')
      .setEmoji(EVAL_EMOJIS.correct)
      .setStyle(ButtonStyle.Success)),
  ];
}

function evaluationResultEmbed(row) {
  const stars = row.score > 0 ? '⭐'.repeat(row.score) : 'Sem estrelas';
  return new EmbedBuilder().setColor(ORANGE).setTitle(`${EVAL_EMOJIS.title} NOVA AVALIAÇÃO — ${evaluationCode(row.id)}`)
    .addFields(
      { name: `${EVAL_EMOJIS.user} Staff avaliado`, value: `<@${row.targetId}>`, inline: true },
      { name: `${EVAL_EMOJIS.title} Nota`, value: `${stars}\n**${row.score}/5**`, inline: true },
      { name: '📝 Observação', value: row.observation, inline: false },
      { name: '🗳️ Avaliado por', value: `<@${row.evaluatorId}>`, inline: true },
    ).setTimestamp(new Date(row.createdAt)).setFooter({ text: evaluationCode(row.id) });
}

function bugPanelEmbed(c) {
  return new EmbedBuilder().setColor(ORANGE).setTitle('🐛 CENTRAL DE RELATÓRIOS DE BUGS')
    .setDescription('Encontrou algum erro no servidor, bot ou sistema? Use o botão abaixo para avisar a equipe responsável.')
    .addFields(
      { name: '📋 Antes de enviar', value: '• Explique claramente o problema\n• Informe onde aconteceu\n• Evite enviar o mesmo bug várias vezes' },
      { name: '🖼️ Evidências', value: 'Depois de preencher o relatório, o bot enviará uma **DM** para você anexar até **3 imagens**. As imagens são opcionais.' },
    ).setFooter({ text: c.bugs.panelFooter || 'Cidade Alta • Sistema de Bugs' });
}
function bugPanelComponents() {
  return [one(new ButtonBuilder().setCustomId('cda_bug_start').setLabel('Reportar Bug').setEmoji('🐛').setStyle(ButtonStyle.Primary))];
}
function bugStatusLabel(status) {
  return ({ pending: '🔴 Pendente', analysis: '🟡 Em análise', fixing: '🔵 Em correção', resolved: '🟢 Resolvido', invalid: '⚫ Inválido' })[status] || status;
}
function bugReportEmbed(row) {
  const e = new EmbedBuilder().setColor(ORANGE).setTitle(`🐛 BUG REPORTADO — ${bugCode(row.id)}`)
    .addFields(
      { name: '📌 Título', value: row.title, inline: false },
      { name: '📍 Onde aconteceu', value: row.location, inline: true },
      { name: '⚠️ Gravidade', value: row.severity, inline: true },
      { name: '📊 Status', value: bugStatusLabel(row.status), inline: true },
      { name: '📝 Descrição', value: row.description, inline: false },
      { name: '👤 Autor', value: `<@${row.userId}>`, inline: true },
    ).setTimestamp(new Date(row.createdAt)).setFooter({ text: bugCode(row.id) });
  if (row.managerId) e.addFields({ name: '🛠️ Atualizado por', value: `<@${row.managerId}>`, inline: true });
  if (row.images?.length) {
    e.setImage(row.images[0]);
    if (row.images.length > 1) e.addFields({ name: '🖼️ Outras evidências', value: row.images.slice(1).map((u,i) => `[Imagem ${i+2}](${u})`).join(' • '), inline: false });
  }
  return e;
}
function bugManageComponents(row) {
  const done = row.status === 'resolved' || row.status === 'invalid';
  return [one(
    new ButtonBuilder().setCustomId(`cda_bug_status:analysis:${row.id}`).setLabel('Em análise').setEmoji('🔎').setStyle(ButtonStyle.Secondary).setDisabled(done),
    new ButtonBuilder().setCustomId(`cda_bug_status:fixing:${row.id}`).setLabel('Em correção').setEmoji('🛠️').setStyle(ButtonStyle.Primary).setDisabled(done),
    new ButtonBuilder().setCustomId(`cda_bug_status:resolved:${row.id}`).setLabel('Resolvido').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(done),
    new ButtonBuilder().setCustomId(`cda_bug_status:invalid:${row.id}`).setLabel('Inválido').setEmoji('❌').setStyle(ButtonStyle.Danger).setDisabled(done),
  )];
}

const evalDrafts = new Map();
const EVAL_DRAFT_TTL = 10 * 60_000;

function evalDraftKey(interaction) {
  return `${interaction.guildId || 'dm'}:${interaction.user.id}`;
}
function getEvalDraft(interaction) {
  const key = evalDraftKey(interaction);
  const draft = evalDrafts.get(key);
  if (!draft) return null;
  if (Date.now() - Number(draft.updatedAt || draft.createdAt || 0) > EVAL_DRAFT_TTL) {
    evalDrafts.delete(key);
    return null;
  }
  return draft;
}
function setEvalDraft(interaction, patch = {}) {
  const key = evalDraftKey(interaction);
  const previous = getEvalDraft(interaction) || { guildId: interaction.guildId, createdAt: Date.now() };
  const next = { ...previous, ...patch, updatedAt: Date.now() };
  evalDrafts.set(key, next);
  return next;
}
function deleteEvalDraft(interaction) {
  evalDrafts.delete(evalDraftKey(interaction));
}

function fortalezaParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza', year:'numeric', month:'2-digit', day:'2-digit', weekday:'short', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(date);
  return Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
}
function weekKey(date = new Date()) {
  const p = fortalezaParts(date);
  const localNoonUtc = new Date(`${p.year}-${p.month}-${p.day}T12:00:00Z`);
  const day = localNoonUtc.getUTCDay();
  const diff = (day + 6) % 7;
  localNoonUtc.setUTCDate(localNoonUtc.getUTCDate() - diff);
  return localNoonUtc.toISOString().slice(0,10);
}

function messageHasMarker(message, marker = '') {
  if (!marker) return false;
  const embedText = (message.embeds || []).map(e => `${e.title || ''}\n${e.description || ''}`).join('\n');
  if (embedText.includes(marker)) return true;
  try {
    const componentJson = (message.components || []).map(c => c.toJSON?.() || c);
    return JSON.stringify(componentJson).includes(marker);
  } catch {
    return false;
  }
}

async function replacePanelMessage(client, channelId, oldMessageId, payload, titleMarker = '') {
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch?.isTextBased()) throw new Error('Canal do painel inválido.');

  // Remove tanto o painel antigo em Embed quanto o novo em Components V2.
  // O ID salvo também é considerado para impedir duplicação a cada refresh.
  const recent = await ch.messages.fetch({ limit: 50 }).catch(() => null);
  if (recent) {
    for (const old of recent.values()) {
      if (old.author?.id !== client.user.id) continue;
      if (old.id === oldMessageId || messageHasMarker(old, titleMarker)) {
        await old.delete().catch(() => {});
      }
    }
  } else if (oldMessageId) {
    const old = await ch.messages.fetch(oldMessageId).catch(() => null);
    if (old) await old.delete().catch(() => {});
  }
  return ch.send(payload);
}
async function publishEvaluationPanel(client, guild, c) {
  if (!c.evaluation.panelChannelId) throw new Error('Canal do painel de avaliações inválido.');
  const msg = await replacePanelMessage(
    client,
    c.evaluation.panelChannelId,
    c.evaluation.panelMessageId,
    evaluationPanelPayload(),
    'AVALIAÇÃO DE STAFF'
  );
  c.evaluation.panelMessageId = msg.id; saveConfig(c); return msg;
}
async function publishBugPanel(client, guild, c) {
  if (!c.bugs.panelChannelId) throw new Error('Canal do painel de bugs inválido.');
  const msg = await replacePanelMessage(client, c.bugs.panelChannelId, c.bugs.panelMessageId, { embeds: [bugPanelEmbed(c)], components: bugPanelComponents() }, 'CENTRAL DE RELATÓRIOS DE BUGS');
  c.bugs.panelMessageId = msg.id; saveConfig(c); return msg;
}
async function refreshManagementPanels(client) {
  const c = loadConfig();
  if (c.evaluation.panelChannelId) await publishEvaluationPanel(client, null, c).catch(e => console.error('⚠️ Auto painel avaliações:', e.message));
  const latest = loadConfig();
  if (latest.bugs.panelChannelId) await publishBugPanel(client, null, latest).catch(e => console.error('⚠️ Auto painel bugs:', e.message));
}

async function finalizeBug(client, bugId) {
  const d = loadData();
  const idx = d.bugs.findIndex(b => b.id === Number(bugId));
  if (idx < 0) return null;
  const row = d.bugs[idx];
  if (row.sent) return row;
  const c = loadConfig();
  const ch = await client.channels.fetch(c.bugs.reportChannelId).catch(() => null);
  if (!ch?.isTextBased()) return null;
  const msg = await ch.send({ embeds: [bugReportEmbed(row)], components: bugManageComponents(row) });
  row.sent = true;
  row.reportChannelId = ch.id;
  row.reportMessageId = msg.id;
  row.evidenceDeadline = '';
  d.bugs[idx] = row;
  saveData(d);
  return row;
}

async function sendWeeklyRanking(client) {
  const c = loadConfig();
  const d = loadData();
  const p = fortalezaParts();
  if (p.weekday !== 'Sun' || Number(p.hour) < Number(c.evaluation.rankingHour ?? 20)) return;
  const wk = weekKey();
  if (d.lastRankingWeek === wk) return;
  const rows = d.evaluations.filter(e => weekKey(new Date(e.createdAt)) === wk);
  const map = new Map();
  for (const e of rows) {
    const x = map.get(e.targetId) || { sum: 0, count: 0 };
    x.sum += Number(e.score); x.count += 1; map.set(e.targetId, x);
  }
  const ranking = [...map.entries()].map(([id,v]) => ({ id, avg: v.sum/v.count, count:v.count })).sort((a,b) => b.avg-a.avg || b.count-a.count);
  const ch = await client.channels.fetch(c.evaluation.announcementChannelId).catch(() => null);
  if (!ch?.isTextBased()) return;
  const medals = ['🥇','🥈','🥉'];
  const text = ranking.length ? ranking.slice(0,10).map((r,i) => `${medals[i] || `**${i+1}º**`} <@${r.id}> — ⭐ **${r.avg.toFixed(2)}/5** (${r.count} avaliação${r.count === 1 ? '' : 'ões'})`).join('\n') : 'Nenhuma avaliação foi registrada nesta semana.';
  await ch.send({ embeds: [new EmbedBuilder().setColor(ORANGE).setTitle('🏆 RANKING SEMANAL DE AVALIAÇÕES').setDescription(text).addFields({ name:'📊 Resumo', value:`**${rows.length}** avaliações • **${ranking.length}** staffs avaliados` }).setFooter({ text:'Cidade Alta • Ranking semanal' }).setTimestamp()] });
  d.lastRankingWeek = wk; saveData(d);
}

function setupManagementExtras(client, startupReady = Promise.resolve()) {
  client.once('ready', async () => {
    await startupReady;
    sendWeeklyRanking(client).catch(console.error);
    setInterval(() => sendWeeklyRanking(client).catch(console.error), 60_000).unref?.();
    setInterval(() => refreshManagementPanels(client).catch(console.error), 20 * 60_000).unref?.();
    setInterval(async () => {
      const d = loadData();
      const now = Date.now();
      const expired = d.bugs.filter(b => !b.sent && b.evidenceDeadline && new Date(b.evidenceDeadline).getTime() <= now);
      for (const b of expired) await finalizeBug(client, b.id).catch(() => {});
    }, 30_000).unref?.();
  });

  client.on('messageCreate', async message => {
    await startupReady;
    if (message.guild || message.author.bot) return;
    const d = loadData();
    const pending = d.bugs.filter(b => !b.sent && b.userId === message.author.id).sort((a,b) => b.id-a.id)[0];
    if (!pending) return;
    const imgs = [...message.attachments.values()].filter(a => a.contentType?.startsWith('image/') || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(a.url)).map(a => a.url);
    if (!imgs.length) return;
    const idx = d.bugs.findIndex(b => b.id === pending.id);
    d.bugs[idx].images = [...(d.bugs[idx].images || []), ...imgs].slice(0,3);
    saveData(d);
    const count = d.bugs[idx].images.length;
    if (count >= 3) {
      await message.reply('✅ Recebi as **3 imagens**. O relatório será enviado agora.');
      await finalizeBug(client, pending.id);
    } else {
      await message.reply({ content: `🖼️ Imagem recebida (**${count}/3**). Você pode enviar mais imagens ou finalizar agora.`, components: [one(new ButtonBuilder().setCustomId(`cda_bug_dm_finish:${pending.id}`).setLabel('Finalizar relatório').setEmoji('✅').setStyle(ButtonStyle.Success))] });
    }
  });

  client.on('interactionCreate', async interaction => {
    if (!global.__CDA_STARTUP_READY) return;
    await startupReady;
    try {
      const c = loadConfig();

      if (interaction.isButton() && interaction.customId === 'cda_main_evaluations') {
        if (!isAdmin(interaction)) return interaction.reply({ content:'❌ Somente Administradores podem configurar.', ephemeral:true });
        return interaction.update({ embeds:[evaluationConfigEmbed(c)], components:evaluationConfigComponents(), content:null });
      }
      if (interaction.isButton() && interaction.customId === 'cda_main_bugs') {
        if (!isAdmin(interaction)) return interaction.reply({ content:'❌ Somente Administradores podem configurar.', ephemeral:true });
        return interaction.update({ embeds:[bugConfigEmbed(c)], components:bugConfigComponents(), content:null });
      }

      if (interaction.isButton() && interaction.customId === 'cda_main_back') {
        if (!isAdmin(interaction)) return interaction.reply({ content:'❌ Sem permissão.', ephemeral:true });
        return interaction.update({ embeds:[mainConfigEmbed()], components:mainConfigComponents(), content:null });
      }

      if (interaction.isButton() && interaction.customId === 'cda_eval_cfg_back') return interaction.update({ embeds:[evaluationConfigEmbed(c)], components:evaluationConfigComponents() });
      if (interaction.isButton() && interaction.customId === 'cda_bug_cfg_back') return interaction.update({ embeds:[bugConfigEmbed(c)], components:bugConfigComponents() });
      if (interaction.isButton() && interaction.customId === 'cda_eval_cfg_channels') return interaction.update({ embeds:[evaluationConfigEmbed(c)], components:evaluationChannelsComponents() });
      if (interaction.isButton() && interaction.customId === 'cda_eval_cfg_roles') return interaction.update({ embeds:[evaluationConfigEmbed(c)], components:evaluationRolesComponents() });
      if (interaction.isButton() && interaction.customId === 'cda_bug_cfg_channels') return interaction.update({ embeds:[bugConfigEmbed(c)], components:bugChannelsComponents() });
      if (interaction.isButton() && interaction.customId === 'cda_bug_cfg_roles') return interaction.update({ embeds:[bugConfigEmbed(c)], components:bugRolesComponents() });

      if (interaction.isChannelSelectMenu() && interaction.customId.startsWith('cda_eval_cfg_')) {
        if (!isAdmin(interaction)) return interaction.reply({ content:'❌ Sem permissão.', ephemeral:true });
        const id = interaction.values[0];
        if (interaction.customId === 'cda_eval_cfg_panel_channel') c.evaluation.panelChannelId = id;
        if (interaction.customId === 'cda_eval_cfg_result_channel') c.evaluation.resultChannelId = id;
        if (interaction.customId === 'cda_eval_cfg_announcement_channel') c.evaluation.announcementChannelId = id;
        saveConfig(c); return interaction.update({ embeds:[evaluationConfigEmbed(c)], components:evaluationChannelsComponents() });
      }
      if (interaction.isChannelSelectMenu() && interaction.customId.startsWith('cda_bug_cfg_')) {
        if (!isAdmin(interaction)) return interaction.reply({ content:'❌ Sem permissão.', ephemeral:true });
        const id = interaction.values[0];
        if (interaction.customId === 'cda_bug_cfg_panel_channel') c.bugs.panelChannelId = id;
        if (interaction.customId === 'cda_bug_cfg_report_channel') c.bugs.reportChannelId = id;
        saveConfig(c); return interaction.update({ embeds:[bugConfigEmbed(c)], components:bugChannelsComponents() });
      }
      if (interaction.isRoleSelectMenu() && interaction.customId.startsWith('cda_eval_cfg_')) {
        if (!isAdmin(interaction)) return interaction.reply({ content:'❌ Sem permissão.', ephemeral:true });
        if (interaction.customId === 'cda_eval_cfg_evaluator_roles') c.evaluation.evaluatorRoleIds = interaction.values;
        if (interaction.customId === 'cda_eval_cfg_evaluable_roles') c.evaluation.evaluableRoleIds = interaction.values;
        saveConfig(c); return interaction.update({ embeds:[evaluationConfigEmbed(c)], components:evaluationRolesComponents() });
      }
      if (interaction.isRoleSelectMenu() && interaction.customId === 'cda_bug_cfg_manager_roles') {
        if (!isAdmin(interaction)) return interaction.reply({ content:'❌ Sem permissão.', ephemeral:true });
        c.bugs.managerRoleIds = interaction.values; saveConfig(c); return interaction.update({ embeds:[bugConfigEmbed(c)], components:bugRolesComponents() });
      }

      if (interaction.isButton() && interaction.customId === 'cda_eval_cfg_publish') {
        if (!isAdmin(interaction)) return interaction.reply({ content:'❌ Sem permissão.', ephemeral:true });
        if (!c.evaluation.panelChannelId) return interaction.reply({ content:'⚠️ Configure o canal do painel primeiro.', ephemeral:true });
        // ACK imediato: publicar o painel pode envolver fetch/delete/send e passar dos 3s do Discord.
        await interaction.deferReply({ ephemeral:true });
        await publishEvaluationPanel(client, interaction.guild, c);
        return interaction.editReply({ content:`✅ Painel de avaliações publicado em <#${c.evaluation.panelChannelId}>.` });
      }
      if (interaction.isButton() && interaction.customId === 'cda_bug_cfg_publish') {
        if (!isAdmin(interaction)) return interaction.reply({ content:'❌ Sem permissão.', ephemeral:true });
        if (!c.bugs.panelChannelId) return interaction.reply({ content:'⚠️ Configure o canal do painel primeiro.', ephemeral:true });
        await publishBugPanel(client, interaction.guild, c); return interaction.reply({ content:`✅ Painel de bugs publicado em <#${c.bugs.panelChannelId}>.`, ephemeral:true });
      }

      if (interaction.isButton() && interaction.customId === 'cda_eval_start') {
        if (c.evaluation.evaluatorRoleIds.length && !hasRole(interaction, c.evaluation.evaluatorRoleIds)) {
          return interaction.reply({ content:'❌ Você não possui um cargo autorizado para avaliar.', ephemeral:true });
        }

        await interaction.deferReply({ ephemeral:true });
        const st = setEvalDraft(interaction, { targetId: undefined, score: undefined });
        return interaction.editReply({ embeds:[evaluationPickerEmbed(st)], components:evaluationPickerComponents(st) });
      }

      if (interaction.isUserSelectMenu() && interaction.customId === 'cda_eval_pick_user') {
        await interaction.deferUpdate();
        let st = getEvalDraft(interaction);
        if (!st) {
          return interaction.followUp({ content:'⚠️ Sua avaliação expirou. Clique em **Avaliar Staff** novamente.', ephemeral:true });
        }

        const targetId = interaction.values[0];
        if (c.evaluation.evaluableRoleIds.length) {
          const member = await interaction.guild.members.fetch(targetId).catch(() => null);
          if (!member || !c.evaluation.evaluableRoleIds.some(id => member.roles.cache.has(id))) {
            st = setEvalDraft(interaction, { targetId: undefined });
            await interaction.editReply({ embeds:[evaluationPickerEmbed(st)], components:evaluationPickerComponents(st) }).catch(()=>{});
            return interaction.followUp({ content:'❌ Esse usuário não possui um dos cargos configurados como avaliáveis.', ephemeral:true });
          }
        }

        st = setEvalDraft(interaction, { targetId });
        return interaction.editReply({ embeds:[evaluationPickerEmbed(st)], components:evaluationPickerComponents(st) });
      }

      if (interaction.isStringSelectMenu() && interaction.customId === 'cda_eval_pick_score') {
        await interaction.deferUpdate();
        let st = getEvalDraft(interaction);
        if (!st) {
          return interaction.followUp({ content:'⚠️ Sua avaliação expirou. Clique em **Avaliar Staff** novamente.', ephemeral:true });
        }
        st = setEvalDraft(interaction, { score: Number(interaction.values[0]) });
        return interaction.editReply({ embeds:[evaluationPickerEmbed(st)], components:evaluationPickerComponents(st) });
      }

      if (interaction.isButton() && interaction.customId === 'cda_eval_continue') {
        const st = getEvalDraft(interaction);
        if (!st?.targetId || st.score === undefined) {
          return interaction.reply({ content:'⚠️ Selecione o membro e a nota antes de continuar.', ephemeral:true });
        }

        const modal = new ModalBuilder().setCustomId('cda_eval_observation_modal').setTitle('Avaliação de Staff');
        modal.addComponents(one(input('observation','Observação',TextInputStyle.Paragraph,true,1000,'Descreva sua avaliação de forma clara...')));
        return interaction.showModal(modal);
      }

      if (interaction.isModalSubmit() && interaction.customId === 'cda_eval_observation_modal') {
        const st = getEvalDraft(interaction);
        if (!st?.targetId || st.score === undefined) {
          return interaction.reply({ content:'⚠️ Sua avaliação expirou. Clique em **Avaliar Staff** novamente.', ephemeral:true });
        }
        if (!c.evaluation.resultChannelId) {
          return interaction.reply({ content:'⚠️ O canal das avaliações ainda não foi configurado.', ephemeral:true });
        }

        await interaction.deferReply({ ephemeral:true });

        const d = loadData();
        const nextId = Math.max(
          Number(d.lastEvaluationId || 0),
          Number(evaluationStoreCache.lastEvaluationId || 0),
          ...d.evaluations.map(e => Number(e?.id || 0))
        ) + 1;

        const row = {
          id: nextId,
          guildId: interaction.guildId,
          evaluatorId: interaction.user.id,
          targetId: st.targetId,
          score: st.score,
          observation: interaction.fields.getTextInputValue('observation'),
          createdAt: new Date().toISOString(),
        };

        d.lastEvaluationId = nextId;
        d.evaluations.push(row);
        await saveEvaluationData(d);
        deleteEvalDraft(interaction);

        const ch = await client.channels.fetch(c.evaluation.resultChannelId).catch(() => null);
        if (!ch?.isTextBased()) {
          return interaction.editReply({ content:'⚠️ A avaliação foi salva, mas não consegui acessar o canal configurado.' });
        }

        await ch.send({ embeds:[evaluationResultEmbed(row)] });
        return interaction.editReply({ content:`${EVAL_EMOJIS.correct} Avaliação enviada com sucesso! **${evaluationCode(row.id)}**` });
      }

      if (interaction.isButton() && interaction.customId === 'cda_bug_start') {
        if (!c.bugs.reportChannelId) return interaction.reply({ content:'⚠️ O canal de relatórios de bugs ainda não foi configurado.', ephemeral:true });
        const modal = new ModalBuilder().setCustomId('cda_bug_report_modal').setTitle('Reportar Bug');
        modal.addComponents(
          one(input('title','Título do bug',TextInputStyle.Short,true,100,'Ex.: Botão não responde')),
          one(input('location','Onde aconteceu?',TextInputStyle.Short,true,100,'Ex.: Bot de gestão / Discord')),
          one(input('severity','Gravidade',TextInputStyle.Short,true,30,'Baixa, Média, Alta ou Crítica')),
          one(input('description','Descrição do problema',TextInputStyle.Paragraph,true,1200,'Explique o que aconteceu e como reproduzir.')),
        );
        return interaction.showModal(modal);
      }
      if (interaction.isModalSubmit() && interaction.customId === 'cda_bug_report_modal') {
        const d = loadData(); d.lastBugId += 1;
        const row = { id:d.lastBugId, guildId:interaction.guildId, userId:interaction.user.id, title:interaction.fields.getTextInputValue('title'), location:interaction.fields.getTextInputValue('location'), severity:interaction.fields.getTextInputValue('severity'), description:interaction.fields.getTextInputValue('description'), status:'pending', images:[], createdAt:new Date().toISOString(), evidenceDeadline:new Date(Date.now()+5*60_000).toISOString(), sent:false, reportMessageId:'', reportChannelId:'', managerId:'' };
        d.bugs.push(row); saveData(d);
        try {
          await interaction.user.send({ embeds:[new EmbedBuilder().setColor(ORANGE).setTitle(`🖼️ Evidências — ${bugCode(row.id)}`).setDescription('Se quiser, envie **até 3 imagens** relacionadas ao bug **nesta DM**.\n\nAs imagens são opcionais. Você pode mandar as imagens e depois finalizar, ou clicar abaixo para enviar o relatório sem imagens.\n\n⏱️ Se você não fizer nada, o relatório será enviado automaticamente em alguns minutos.')], components:[one(new ButtonBuilder().setCustomId(`cda_bug_dm_finish:${row.id}`).setLabel('Finalizar / Sem imagens').setEmoji('✅').setStyle(ButtonStyle.Success))] });
          return interaction.reply({ content:`✅ **${bugCode(row.id)}** criado. Te enviei uma DM para você adicionar imagens opcionais.`, ephemeral:true });
        } catch {
          await finalizeBug(client,row.id);
          return interaction.reply({ content:`✅ **${bugCode(row.id)}** enviado. Não consegui abrir sua DM, então o relatório foi enviado sem imagens.`, ephemeral:true });
        }
      }
      if (interaction.isButton() && interaction.customId.startsWith('cda_bug_dm_finish:')) {
        const id = Number(interaction.customId.split(':')[1]);
        const d = loadData(); const row = d.bugs.find(b => b.id === id);
        if (!row || row.userId !== interaction.user.id) return interaction.reply({ content:'❌ Esse relatório não pertence a você.', ephemeral:true });
        await finalizeBug(client,id);
        return interaction.reply({ content:`✅ **${bugCode(id)}** finalizado e enviado para a equipe.`, ephemeral:true });
      }
      if (interaction.isButton() && interaction.customId.startsWith('cda_bug_status:')) {
        const [,status,idText] = interaction.customId.split(':');
        if (!isAdmin(interaction) && !hasRole(interaction,c.bugs.managerRoleIds)) return interaction.reply({ content:'❌ Você não pode alterar o status dos bugs.', ephemeral:true });
        const d = loadData(); const idx = d.bugs.findIndex(b => b.id === Number(idText));
        if (idx < 0) return interaction.reply({ content:'Bug não encontrado.', ephemeral:true });
        d.bugs[idx].status = status; d.bugs[idx].managerId = interaction.user.id; saveData(d);
        return interaction.update({ embeds:[bugReportEmbed(d.bugs[idx])], components:bugManageComponents(d.bugs[idx]) });
      }
    } catch (e) {
      console.error('❌ Gestão extras:', e);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) interaction.reply({ content:'❌ Ocorreu um erro ao processar essa ação.', ephemeral:true }).catch(()=>{});
    }
  });
}

module.exports = { setupManagementExtras, initManagementPersistentConfig, mainConfigEmbed, mainConfigComponents, evaluationConfigEmbed, evaluationConfigComponents, bugConfigEmbed, bugConfigComponents };
