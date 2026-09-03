const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} = require('discord.js');

const path = require('path');
const { migrateJson, loadJson, saveJson } = require('./storage');
const { loadPersistentConfig, savePersistentConfig, loadPersistentText, savePersistentText } = require('./persistent-config');
const { mainConfigEmbed, mainConfigComponents } = require('./management-extras');
const MAIN_CONFIG = require('./config.json');

const ORANGE = 0xFF8C00;
const CONFIG_PATH = migrateJson('tickets-config.json', path.join(__dirname, 'tickets-config.json'), {});
const STATE_PATH = migrateJson('tickets-state.json', path.join(__dirname, 'tickets-state.json'), { lastId: 0 });
const LEGACY_PROMPT_PATH = migrateJson('tickets-ai-prompt.json', path.join(__dirname, 'tickets-ai-prompt.json'), { prompt: '' });
const AI_BASE_PATH = migrateJson('tickets-ai-base.json', path.join(__dirname, 'tickets-ai-base.json'), { base: '' });
const AI_BEHAVIOR_PATH = migrateJson('tickets-ai-behavior.json', path.join(__dirname, 'tickets-ai-behavior.json'), { prompt: '' });
const TICKET_RUNTIME_PATH = migrateJson('tickets-runtime-v55.json', path.join(__dirname, 'tickets-runtime-v55.json'), {});
const ANALYTICS_PATH = migrateJson('tickets-analytics-v55.json', path.join(__dirname, 'tickets-analytics-v55.json'), { users: {}, staff: {}, tickets: {} });
const WAIT_REMINDER_MS = Math.max(10, Number(process.env.TICKET_WAIT_REMINDER_MINUTES || 120)) * 60_000;

const DEFAULT_TICKET_FUNCTIONS = [
  { id: 'suporte', emoji: '🛟', label: 'Suporte', description: 'Dúvidas e ajuda geral.', categoryId: '', enabled: true, system: true },
  { id: 'denuncia', emoji: '🚨', label: 'Denúncia', description: 'Denúncias relacionadas à comunidade.', categoryId: '', enabled: true, system: true },
  { id: 'bug', emoji: '🐛', label: 'Bug', description: 'Problemas técnicos e bugs.', categoryId: '', enabled: true, system: true },
  { id: 'staff', emoji: '👥', label: 'Staff', description: 'Assuntos relacionados à equipe.', categoryId: '', enabled: true, system: true },
  { id: 'parceria', emoji: '🤝', label: 'Parceria', description: 'Parcerias e assuntos comerciais.', categoryId: '', enabled: true, system: true },
  { id: 'comprar', emoji: '🛒', label: 'Comprar', description: 'Compras, VIPs, produtos e benefícios.', categoryId: '', enabled: true, system: true },
  { id: 'outros', emoji: '💬', label: 'Outros', description: 'Assuntos que não se encaixam acima.', categoryId: '', enabled: true, system: true },
];

const DEFAULT_EMOJIS = {
  claim: '🙋',
  transfer: '🔁',
  add: '➕',
  remove: '➖',
  close: '🔒',
  aiSuggest: '✨',
  aiSummary: '📋',
  staffPanel: '🛠️',
  memberPanel: '👤',
  memberRole: '🏷️',
  subject: '📌',
  description: '📝',
  responsible: '👮',
  ai: '🤖',
  attendance: '⏱️',
  rating: '⭐',
  panelTitle: '🎫',
  author: '👤',
  type: '📂',
  messages: '💬',
  reason: '📝',
  notifyUser: '📨',
  escalate: '⬆️',
  priority: '💎',
  wait: '⏳',
  history: '🕘',
  notifyStaff: '🔔',
  setRole: '🏷️',
  rename: '✏️',
  approve: '✅',
  reject: '❌',
};

const DEFAULT_CONFIG = {
  guildId: '',
  panelChannelId: '',
  categoryId: '',
  logChannelId: '',
  teamAnnouncementsChannelId: '',
  staffRoleIds: [],
  vipRoleIds: [],
  panelMessageId: '',
  panelFooter: 'Cidade Alta [RP] © 2026 • Todos os direitos reservados.',
  aiMode: 'disabled', // disabled | automatic | assistant
  aiProvider: 'auto', // auto | gemini | groq
  ticketFunctions: DEFAULT_TICKET_FUNCTIONS,
  emojis: DEFAULT_EMOJIS,
};

const LEGACY_DEFAULT_PROMPT =
  'Você é o assistente de atendimento do Cidade Alta RP (CDA). Responda em português brasileiro, de forma curta, educada e útil. ' +
  'Nunca invente regras, punições, benefícios, valores ou informações que não estejam no contexto. Se faltar informação, diga que um membro da equipe continuará o atendimento. ' +
  'Não peça senhas, tokens, códigos de autenticação, dados bancários completos ou outras informações sensíveis.';

const DEFAULT_AI_BEHAVIOR = `Você é a assistente oficial de atendimento do Cidade Alta RP (CDA).
Responda em português brasileiro, de forma natural, curta, clara e educada. Não diga que é Gemini, Groq ou outro modelo.

REGRA PRINCIPAL:
Use somente informações confirmadas na BASE DE CONHECIMENTO e nos DADOS ATUAIS DO SERVIDOR enviados pelo sistema. Nunca invente preços, regras, punições, datas, estoque, disponibilidade, anúncios, benefícios ou decisões administrativas.
Se não houver informação confirmada, diga que um membro real da equipe continuará o atendimento.
Não peça senhas, tokens, códigos de autenticação, dados bancários completos ou outras informações sensíveis.

CORPORAÇÕES / TIMES:
Quando alguém quiser assumir uma corporação ou time, use exclusivamente a seção DADOS ATUAIS — ANÚNCIOS DE TIMES fornecida pelo bot.
Só considere uma vaga confirmada quando houver anúncio claro de disponibilidade. Se houver mensagem posterior indicando que o time foi assumido, encerrado ou indisponível, trate como fechado. Se não houver confirmação clara, informe que não existe disponibilidade confirmada no momento.

Se houver anúncio ativo, faça a triagem UMA PERGUNTA POR VEZ, nesta ordem:
1. Qual corporação/time deseja assumir?
2. Qual seu nick/ID no Roblox?
3. Já possui uma equipe? Se sim, aproximadamente quantos membros?
4. Já teve experiência administrando corporação, facção ou equipe em RP?
5. Qual sua disponibilidade para manter o time ativo?
6. Por que acredita que seria uma boa pessoa para assumir esse time?
7. Está de acordo em seguir as regras e exigências do Cidade Alta RP?

Depois de receber todas as respostas, produza um resumo curto com: Time solicitado, Nick/ID, quantidade aproximada de membros, experiência, disponibilidade e motivo apresentado. Informe que a decisão final será feita por uma pessoa real da equipe. No FINAL dessa resposta inclua exatamente o marcador [ENCAMINHAR_STAFF]. Nunca aprove ou negue a candidatura.

Use [ENCAMINHAR_STAFF] somente quando uma triagem de corporação estiver concluída ou quando for realmente necessário transferir o atendimento para humano. Não mostre nem explique esse marcador ao usuário.`;

const DEFAULT_KNOWLEDGE_BASE = `BASE DE CONHECIMENTO — CIDADE ALTA RP

VIPs:
Os VIPs podem ser comprados com dinheiro real ou Robux. Em dinheiro real, a compra é feita no canal específico de produtos/compras do Discord. Em Robux, a compra é feita pelo Roblox.
Valores em dinheiro real informados atualmente:
• VIP Bronze — R$ 2,75
• VIP Ouro — R$ 9,45
• VIP Platina — R$ 15,00
• VIP Diamante — R$ 25,00
Nunca invente benefícios dos VIPs. Para valores em Robux, use apenas informação confirmada pelo sistema ou oriente a consultar o Roblox.

Produtos e pacotes:
• Velozes e Furiosos — R$ 25,00. Inclui Supra MK4 e Skyline R34.
• Combo Páscoa — R$ 45,99. Inclui Urus, Carrera e 3 milhões em dinheiro do jogo.
• Limousine Exclusiva — R$ 25,00.
• Mercedes GT Exclusivo — R$ 18,00.
• Mazda RX7 Exclusivo — R$ 21,00.
O estoque pode mudar; nunca garanta disponibilidade sem confirmação atual.

Bugs:
Existe um canal específico para reportar bugs. Oriente o usuário a usar esse canal e explicar o problema com detalhes.

Staff:
A entrada na Staff acontece somente por formulário. Os formulários são liberados em períodos variados. Nunca invente datas de abertura, aprovação ou resultado.

Regras:
As regras oficiais ficam no canal de Regras. Se houver dúvida não confirmada, encaminhe para uma pessoa real da equipe.

Banimentos e advertências:
Existe um canal específico com relatórios de banimentos e advertências, incluindo o nick da pessoa envolvida. Oriente o usuário a consultar esse canal quando necessário.

Corporações e times:
A disponibilidade para assumir um time deve ser confirmada pelo canal de anúncios de times configurado no bot. A IA pode realizar somente a triagem inicial quando houver anúncio ativo. A decisão final sempre pertence a uma pessoa real da equipe.`;

let runtimeConfig = { ...DEFAULT_CONFIG };
let runtimeBehaviorPrompt = DEFAULT_AI_BEHAVIOR;
let runtimeKnowledgeBase = DEFAULT_KNOWLEDGE_BASE;
let runtimeState = { lastId: 0 };
const aiBusy = new Set();
const pendingEmojiChanges = new Map();
const pendingTextChanges = new Map();
const memberNotifyCooldown = new Map();
const pendingRoleProofs = new Map();
let ticketRuntimeData = {};
let ticketAnalytics = { users: {}, staff: {}, tickets: {} };
let saveRuntimeTimer = null;
let saveAnalyticsTimer = null;

function normalizeTicketFunctions(functions) {
  const src = Array.isArray(functions) && functions.length ? functions : DEFAULT_TICKET_FUNCTIONS;
  const seen = new Set();
  const normalized = [];
  for (const raw of src) {
    const id = sanitizeName(raw?.id || raw?.label || 'funcao').replace(/-/g, '_').slice(0, 32) || 'funcao';
    if (seen.has(id) || normalized.length >= 24) continue;
    seen.add(id);
    normalized.push({
      id,
      emoji: String(raw?.emoji || '🎫').trim().slice(0, 80) || '🎫',
      label: String(raw?.label || id).trim().slice(0, 80) || id,
      description: String(raw?.description || 'Atendimento personalizado.').trim().slice(0, 100) || 'Atendimento personalizado.',
      categoryId: String(raw?.categoryId || ''),
      enabled: raw?.enabled !== false,
      system: Boolean(raw?.system),
    });
  }
  return normalized.length ? normalized : DEFAULT_TICKET_FUNCTIONS.map(x => ({ ...x }));
}

function compactConfig(v = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...v,
    staffRoleIds: Array.isArray(v.staffRoleIds) ? v.staffRoleIds.map(String).slice(0, 10) : [],
    vipRoleIds: Array.isArray(v.vipRoleIds) ? v.vipRoleIds.map(String).slice(0, 10) : [],
    ticketFunctions: normalizeTicketFunctions(v.ticketFunctions),
    emojis: { ...DEFAULT_EMOJIS, ...(v.emojis || {}) },
  };
}

function loadLocalConfig() {
  return compactConfig(loadJson(CONFIG_PATH, DEFAULT_CONFIG));
}

function saveLocalConfig(v) {
  runtimeConfig = compactConfig(v);
  saveJson(CONFIG_PATH, runtimeConfig);
}

function loadLocalState() {
  const state = loadJson(STATE_PATH, { lastId: 0 });
  return { lastId: Number.isInteger(state.lastId) ? state.lastId : Number(state.lastId) || 0 };
}

function saveLocalState(v) {
  runtimeState = { lastId: Number(v?.lastId) || 0 };
  saveJson(STATE_PATH, runtimeState);
}

function loadLegacyPrompt() {
  const p = loadJson(LEGACY_PROMPT_PATH, { prompt: '' });
  return String(p?.prompt || '').trim();
}

function loadLocalKnowledgeBase() {
  const data = loadJson(AI_BASE_PATH, { base: '' });
  return String(data?.base || '').trim();
}

function saveLocalKnowledgeBase(base) {
  runtimeKnowledgeBase = String(base || '').trim();
  saveJson(AI_BASE_PATH, { base: runtimeKnowledgeBase });
}

function loadLocalBehaviorPrompt() {
  const data = loadJson(AI_BEHAVIOR_PATH, { prompt: '' });
  return String(data?.prompt || '').trim() || DEFAULT_AI_BEHAVIOR;
}

function saveLocalBehaviorPrompt(prompt) {
  runtimeBehaviorPrompt = String(prompt || '').trim() || DEFAULT_AI_BEHAVIOR;
  saveJson(AI_BEHAVIOR_PATH, { prompt: runtimeBehaviorPrompt });
}


function safeJsonParse(text, fallback) {
  try {
    const parsed = JSON.parse(String(text || ''));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch { return fallback; }
}

function compactRuntimeData(data = ticketRuntimeData) {
  const entries = Object.entries(data || {}).slice(-300);
  return Object.fromEntries(entries);
}

function compactAnalytics(data = ticketAnalytics) {
  const users = Object.fromEntries(Object.entries(data?.users || {}).slice(-150));
  const staff = Object.fromEntries(Object.entries(data?.staff || {}).slice(-80));
  const ticketEntries = Object.entries(data?.tickets || {})
    .sort((a, b) => Number(a[1]?.createdAt || 0) - Number(b[1]?.createdAt || 0))
    .slice(-250);
  return { users, staff, tickets: Object.fromEntries(ticketEntries) };
}

function scheduleRuntimeSave() {
  saveJson(TICKET_RUNTIME_PATH, compactRuntimeData());
  clearTimeout(saveRuntimeTimer);
  saveRuntimeTimer = setTimeout(() => {
    savePersistentText('tickets_runtime_v55', JSON.stringify(compactRuntimeData())).catch(() => {});
  }, 1200);
}

function scheduleAnalyticsSave() {
  ticketAnalytics = compactAnalytics(ticketAnalytics);
  saveJson(ANALYTICS_PATH, ticketAnalytics);
  clearTimeout(saveAnalyticsTimer);
  saveAnalyticsTimer = setTimeout(() => {
    savePersistentText('tickets_analytics_v55', JSON.stringify(ticketAnalytics)).catch(() => {});
  }, 1500);
}

function getTicketRuntime(channelId) {
  const id = String(channelId);
  if (!ticketRuntimeData[id]) ticketRuntimeData[id] = { priority: 'normal', waitReason: '', waitSince: 0, reminderSent: false, escalatedAt: 0, escalationReason: '' };
  return ticketRuntimeData[id];
}

function updateTicketRuntime(channelId, patch = {}) {
  const current = getTicketRuntime(channelId);
  ticketRuntimeData[String(channelId)] = { ...current, ...patch };
  scheduleRuntimeSave();
  return ticketRuntimeData[String(channelId)];
}

function ensureUserStats(userId) {
  const id = String(userId);
  if (!ticketAnalytics.users[id]) ticketAnalytics.users[id] = { opened: 0, closed: 0, ratings: 0, ratingSum: 0, lastTickets: [] };
  return ticketAnalytics.users[id];
}

function ensureStaffStats(userId) {
  const id = String(userId);
  if (!ticketAnalytics.staff[id]) ticketAnalytics.staff[id] = { claimed: 0, resolved: 0, transfersIn: 0, transfersOut: 0, ratings: 0, ratingSum: 0, totalResolutionMs: 0 };
  return ticketAnalytics.staff[id];
}

function recordTicketOpened(meta, channelId, priority) {
  const user = ensureUserStats(meta.ownerId);
  user.opened += 1;
  user.lastTickets = [meta.id, ...(user.lastTickets || []).filter(x => x !== meta.id)].slice(0, 8);
  ticketAnalytics.tickets[String(meta.id)] = { ownerId: meta.ownerId, channelId: String(channelId), type: meta.type, priority, createdAt: meta.createdAt, claimedBy: '', closedAt: 0, closedBy: '', reason: '', summary: '', score: 0, feedback: '' };
  scheduleAnalyticsSave();
}

function recordClaim(meta, staffId) {
  ensureStaffStats(staffId).claimed += 1;
  const t = ticketAnalytics.tickets[String(meta.id)] || {};
  ticketAnalytics.tickets[String(meta.id)] = { ...t, ownerId: meta.ownerId, type: meta.type, createdAt: meta.createdAt, claimedBy: String(staffId) };
  scheduleAnalyticsSave();
}

function recordTransfer(meta, fromId, toId, reason) {
  if (fromId) ensureStaffStats(fromId).transfersOut += 1;
  ensureStaffStats(toId).transfersIn += 1;
  const t = ticketAnalytics.tickets[String(meta.id)] || {};
  ticketAnalytics.tickets[String(meta.id)] = { ...t, claimedBy: String(toId), transferReason: String(reason || '').slice(0, 500) };
  scheduleAnalyticsSave();
}

function recordClosed(meta, closedBy, reason, summary = '') {
  const now = Date.now();
  const user = ensureUserStats(meta.ownerId); user.closed += 1;
  if (meta.claimedBy) {
    const st = ensureStaffStats(meta.claimedBy);
    st.resolved += 1;
    st.totalResolutionMs += Math.max(0, now - Number(meta.createdAt || now));
  }
  const t = ticketAnalytics.tickets[String(meta.id)] || {};
  ticketAnalytics.tickets[String(meta.id)] = { ...t, ownerId: meta.ownerId, type: meta.type, createdAt: meta.createdAt, claimedBy: meta.claimedBy || '', closedAt: now, closedBy: String(closedBy), reason: String(reason || '').slice(0, 500), summary: String(summary || '').slice(0, 1800) };
  scheduleAnalyticsSave();
}

function recordRating(ticketId, userId, score, feedback = null) {
  const user = ensureUserStats(userId);
  const t = ticketAnalytics.tickets[String(ticketId)] || {};
  if (!t.score) { user.ratings += 1; user.ratingSum += Number(score); }
  if (t.claimedBy && !t.score) { const st = ensureStaffStats(t.claimedBy); st.ratings += 1; st.ratingSum += Number(score); }
  ticketAnalytics.tickets[String(ticketId)] = { ...t, score: Number(score), ...(feedback !== null ? { feedback: String(feedback).slice(0, 1000) } : {}) };
  scheduleAnalyticsSave();
}

async function sendOrganizedLog(client, title, fields = [], color = ORANGE) {
  const logChannel = runtimeConfig.logChannelId ? await client.channels.fetch(runtimeConfig.logChannelId).catch(() => null) : null;
  if (!logChannel?.isTextBased()) return false;
  await logChannel.send({ embeds: [new EmbedBuilder().setColor(color).setTitle(title).addFields(fields).setTimestamp()], allowedMentions: { parse: [] } }).catch(() => {});
  return true;
}

function avgRating(stat) {
  return stat?.ratings ? (Number(stat.ratingSum || 0) / Number(stat.ratings)).toFixed(1) : '—';
}

function formatDuration(ms) {
  const mins = Math.max(0, Math.round(Number(ms || 0) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${h}h${m ? ` ${m}min` : ''}`;
}

function userHistoryEmbed(userId) {
  const st = ensureUserStats(userId);
  const recent = (st.lastTickets || []).slice(0, 5).map(id => {
    const t = ticketAnalytics.tickets[String(id)] || {};
    const status = t.closedAt ? 'Fechado' : 'Aberto';
    return `• **${ticketCode(id)}** — ${status}${t.score ? ` — ${t.score}/5 ⭐` : ''}`;
  }).join('\n') || 'Nenhum histórico registrado ainda.';
  return new EmbedBuilder().setColor(ORANGE).setTitle('🕘 Histórico do usuário').setDescription(`<@${userId}>`).addFields(
    { name: 'Tickets abertos', value: String(st.opened || 0), inline: true },
    { name: 'Tickets concluídos', value: String(st.closed || 0), inline: true },
    { name: 'Média de avaliação', value: avgRating(st), inline: true },
    { name: 'Últimos atendimentos', value: recent, inline: false },
  );
}

async function dashboardEmbed(guild) {
  await guild.channels.fetch().catch(() => {});
  const open = guild.channels.cache.filter(ch => Boolean(parseTopic(ch))).size;
  const staffRows = Object.entries(ticketAnalytics.staff || {}).map(([id, st]) => ({ id, ...st }))
    .sort((a,b) => (b.resolved || 0) - (a.resolved || 0)).slice(0, 10);
  const ranking = staffRows.map((st, i) => `${i+1}. <@${st.id}> — **${st.resolved || 0}** resolvidos • ⭐ ${avgRating(st)} • média ${formatDuration(st.resolved ? st.totalResolutionMs / st.resolved : 0)}`).join('\n') || 'Ainda não há dados suficientes.';
  const allTickets = Object.values(ticketAnalytics.tickets || {});
  const closed = allTickets.filter(t => t.closedAt).length;
  const scores = allTickets.filter(t => t.score).map(t => t.score);
  const globalAvg = scores.length ? (scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(1) : '—';
  return new EmbedBuilder().setColor(ORANGE).setTitle('📊 Dashboard de desempenho — Tickets').addFields(
    { name: 'Abertos agora', value: String(open), inline: true },
    { name: 'Concluídos registrados', value: String(closed), inline: true },
    { name: 'Avaliação geral', value: `${globalAvg}${globalAvg !== '—' ? '/5' : ''}`, inline: true },
    { name: 'Ranking de atendimento', value: ranking, inline: false },
  ).setTimestamp();
}

function findEscalationRole(member, guild) {
  const roles = (runtimeConfig.staffRoleIds || []).map(id => guild.roles.cache.get(String(id))).filter(Boolean).sort((a,b)=>a.position-b.position);
  const higher = roles.filter(r => r.position > (member?.roles?.highest?.position || 0));
  return higher[0] || roles.at(-1) || null;
}

function mergeRequiredKnowledge(base) {
  const current = String(base || '').trim();
  if (!current) return DEFAULT_KNOWLEDGE_BASE;
  // Migração da V5.2.1: mantém tudo que o usuário já escreveu e acrescenta a nova base solicitada uma única vez.
  if (current.includes('VIP Bronze') && current.includes('Combo Páscoa') && current.includes('Velozes e Furiosos')) return current;
  return `${current}

--- INFORMAÇÕES ADICIONADAS NA V5.3 ---
${DEFAULT_KNOWLEDGE_BASE}`.slice(0, 50000);
}

async function initTicketsPersistentConfig() {
  const localConfig = loadLocalConfig();
  const restoredConfig = await loadPersistentConfig('tickets', localConfig);
  saveLocalConfig(restoredConfig || localConfig);

  const localState = loadLocalState();
  const restoredState = await loadPersistentConfig('tickets_state', localState);
  saveLocalState(restoredState || localState);

  // Recupera a base antiga de até 1500 caracteres para não perder o que já estava configurado.
  const legacyLocal = loadLegacyPrompt();
  const legacyRestored = await loadPersistentConfig('tickets_ai_prompt', { prompt: legacyLocal || LEGACY_DEFAULT_PROMPT });
  const legacyValue = String(legacyRestored?.prompt || legacyLocal || '').trim();

  const localBase = loadLocalKnowledgeBase() || (legacyValue && legacyValue !== LEGACY_DEFAULT_PROMPT ? legacyValue : '');
  const baseFallback = mergeRequiredKnowledge(localBase);
  const restoredBase = await loadPersistentText('tickets_ai_base', baseFallback);
  const mergedBase = mergeRequiredKnowledge(restoredBase);
  saveLocalKnowledgeBase(mergedBase);
  if (mergedBase !== restoredBase) savePersistentText('tickets_ai_base', mergedBase).catch(() => {});

  const localBehavior = loadLocalBehaviorPrompt();
  const restoredBehavior = await loadPersistentText('tickets_ai_behavior_text', localBehavior);
  saveLocalBehaviorPrompt(restoredBehavior || localBehavior);

  const localRuntime = loadJson(TICKET_RUNTIME_PATH, {});
  const restoredRuntimeText = await loadPersistentText('tickets_runtime_v55', JSON.stringify(localRuntime));
  ticketRuntimeData = safeJsonParse(restoredRuntimeText, localRuntime || {});
  saveJson(TICKET_RUNTIME_PATH, compactRuntimeData(ticketRuntimeData));

  const localAnalytics = loadJson(ANALYTICS_PATH, { users: {}, staff: {}, tickets: {} });
  const restoredAnalyticsText = await loadPersistentText('tickets_analytics_v55', JSON.stringify(localAnalytics));
  ticketAnalytics = compactAnalytics(safeJsonParse(restoredAnalyticsText, localAnalytics));
  saveJson(ANALYTICS_PATH, ticketAnalytics);

  return runtimeConfig;
}

function saveConfig(v) {
  saveLocalConfig(v);
  savePersistentConfig('tickets', runtimeConfig).catch(err =>
    console.error('❌ Falha ao sincronizar tickets com o canal de storage:', err.message)
  );
}

function saveState(v) {
  saveLocalState(v);
  savePersistentConfig('tickets_state', runtimeState).catch(err =>
    console.error('❌ Falha ao sincronizar contador de tickets:', err.message)
  );
}

function saveKnowledgeBase(base) {
  const value = String(base || '').trim().slice(0, 50000);
  saveLocalKnowledgeBase(value);
  savePersistentText('tickets_ai_base', runtimeKnowledgeBase).catch(err =>
    console.error('❌ Falha ao sincronizar base grande da IA:', err.message)
  );
}

function saveBehaviorPrompt(prompt) {
  saveLocalBehaviorPrompt(String(prompt || '').slice(0, 12000));
  savePersistentText('tickets_ai_behavior_text', runtimeBehaviorPrompt).catch(err =>
    console.error('❌ Falha ao sincronizar prompt de comportamento da IA:', err.message)
  );
}

function isAdmin(i) {
  return Boolean(i.memberPermissions?.has(PermissionFlagsBits.Administrator));
}

function hasStaffRole(member, config = runtimeConfig) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  return (config.staffRoleIds || []).some(id => member.roles?.cache?.has(String(id)));
}

function channelMention(id) {
  return id ? `<#${id}>` : '`Não configurado`';
}

function roleMentions(ids = []) {
  return ids.length ? ids.map(id => `<@&${id}>`).join(', ') : '`Não configurado`';
}

function one(...components) {
  return new ActionRowBuilder().addComponents(...components);
}

function ticketCode(id) {
  return `CDA-TKT-${String(id).padStart(4, '0')}`;
}

function sanitizeName(value) {
  return String(value || 'usuario')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'usuario';
}

function getFunctions(config = runtimeConfig) {
  return normalizeTicketFunctions(config.ticketFunctions);
}

function getEnabledFunctions(config = runtimeConfig) {
  return getFunctions(config).filter(f => f.enabled).slice(0, 24);
}

function getFunction(id, config = runtimeConfig) {
  return getFunctions(config).find(f => f.id === id) || getFunctions(config).find(f => f.id === 'outros') || getFunctions(config)[0];
}

function getEmoji(key, config = runtimeConfig) {
  return String(config.emojis?.[key] || DEFAULT_EMOJIS[key] || '🎫');
}

function makeFunctionId(label) {
  const base = sanitizeName(label).replace(/-/g, '_').slice(0, 24) || 'funcao';
  const used = new Set(getFunctions().map(f => f.id));
  if (!used.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}_${n}`.slice(0, 32);
    if (!used.has(candidate)) return candidate;
  }
  return `funcao_${Date.now().toString(36)}`.slice(0, 32);
}

function parseEmojiMessage(content) {
  const text = String(content || '').trim();
  const custom = text.match(/^<a?:[A-Za-z0-9_~]+:\d+>$/);
  if (custom) return custom[0];
  if (!text || text.length > 24 || /\s/.test(text)) return null;
  const looksLikeEmoji = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3/u.test(text);
  return looksLikeEmoji ? text : null;
}

function emojiTargetLabel(target) {
  const labels = {
    claim: 'Botão Assumir', transfer: 'Botão Transferir', add: 'Botão Adicionar', remove: 'Botão Remover', close: 'Botão Fechar', staffPanel: 'Painel Staff', memberPanel: 'Painel Membro', memberRole: 'Cargo do membro',
    aiSuggest: 'Sugerir resposta IA', aiSummary: 'Resumir ticket', subject: 'Campo Assunto', description: 'Campo Descrição',
    responsible: 'Campo Responsável', ai: 'IA/Assistente', attendance: 'Atendimento', rating: 'Avaliação',
    panelTitle: 'Título do painel', author: 'Autor do ticket', type: 'Tipo do ticket', messages: 'Contador de mensagens', reason: 'Motivo do encerramento',
    notifyUser: 'Notificar Usuário', escalate: 'Escalonar atendimento', priority: 'Prioridade', wait: 'Motivo de Espera', history: 'Histórico do Usuário',
    notifyStaff: 'Notificar Staff Resp.', setRole: 'Setar Cargo', rename: 'Renomear Ticket', approve: 'Aprovar', reject: 'Recusar',
  };
  return labels[target] || target;
}

function encodeTopic(meta) {
  return [
    'CDA_TICKET',
    `id=${meta.id}`,
    `owner=${meta.ownerId}`,
    `type=${meta.type}`,
    `claimed=${meta.claimedBy || '0'}`,
    `handoff=${meta.handoff ? '1' : '0'}`,
    `created=${meta.createdAt || Date.now()}`,
  ].join('|');
}

function parseTopic(channel) {
  const topic = String(channel?.topic || '');
  if (!topic.startsWith('CDA_TICKET|')) return null;
  const parts = Object.fromEntries(topic.split('|').slice(1).map(part => {
    const idx = part.indexOf('=');
    return idx === -1 ? [part, ''] : [part.slice(0, idx), part.slice(idx + 1)];
  }));
  const id = Number(parts.id);
  if (!id || !parts.owner) return null;
  return {
    id,
    ownerId: parts.owner,
    type: parts.type || 'outros',
    claimedBy: parts.claimed && parts.claimed !== '0' ? parts.claimed : '',
    handoff: parts.handoff === '1',
    createdAt: Number(parts.created) || Date.now(),
  };
}

async function updateTopic(channel, patch = {}) {
  const current = parseTopic(channel);
  if (!current) return null;
  const next = { ...current, ...patch };
  await channel.setTopic(encodeTopic(next)).catch(() => {});
  return next;
}

function panelEmbed(config = runtimeConfig) {
  return new EmbedBuilder()
    .setColor(ORANGE)
    .setTitle(`${getEmoji('panelTitle', config)} CENTRAL DE ATENDIMENTO — CDA`)
    .setDescription(
      'Precisa falar com a equipe do **Cidade Alta RP**? Selecione abaixo o setor que melhor representa o seu atendimento.\n\n' +
      'Antes de abrir um ticket, explique o problema com o máximo de clareza possível. Isso ajuda a equipe a resolver mais rápido.'
    )
    .addFields(
      ...getEnabledFunctions(config).map(type => ({
        name: `${type.emoji} ${type.label}`,
        value: type.description,
        inline: true,
      })),
      { name: `${getEmoji('attendance', config)} Atendimento`, value: 'Após abrir, aguarde um membro da equipe assumir. Evite marcar a staff repetidamente.', inline: false },
    )
    .setFooter({ text: 'Cidade Alta [RP] © 2026 • Todos os direitos reservados.' });
}

function panelComponents(config = runtimeConfig) {
  const functions = getEnabledFunctions(config);
  if (!functions.length) return [];
  const menu = new StringSelectMenuBuilder()
    .setCustomId('cda_ticket_open')
    .setPlaceholder('Selecione o tipo de atendimento')
    .addOptions(functions.map(type =>
      new StringSelectMenuOptionBuilder()
        .setLabel(type.label)
        .setDescription(type.description.slice(0, 100))
        .setValue(type.id)
        .setEmoji(type.emoji)
    ));
  return [one(menu)];
}

function configEmbed(config = runtimeConfig) {
  const keyGemini = Boolean(process.env.GEMINI_API_KEY);
  const keyGroq = Boolean(process.env.GROQ_API_KEY);
  const modeLabel = {
    disabled: '🔴 Desativada',
    automatic: '🟢 Automática até um staff assumir',
    assistant: '🔵 Assistente da staff',
  }[config.aiMode] || config.aiMode;

  return new EmbedBuilder()
    .setColor(ORANGE)
    .setTitle('🎫 Configurar Tickets')
    .setDescription('Configure o painel, a equipe responsável e a IA de atendimento.')
    .addFields(
      { name: '📌 Canal do painel', value: channelMention(config.panelChannelId), inline: true },
      { name: '📁 Categoria padrão', value: channelMention(config.categoryId), inline: true },
      { name: '📜 Canal de logs/transcripts', value: channelMention(config.logChannelId), inline: true },
      { name: '🏢 Anúncios de times', value: channelMention(config.teamAnnouncementsChannelId), inline: true },
      { name: '👮 Equipe de atendimento', value: roleMentions(config.staffRoleIds), inline: false },
      { name: '💎 Cargos VIP', value: roleMentions(config.vipRoleIds), inline: false },
      { name: '🧩 Funções no painel', value: `**${getEnabledFunctions(config).length}** ativas de **${getFunctions(config).length}** configuradas`, inline: true },
      { name: '🎨 Emojis', value: 'Personalizáveis pelo chat.', inline: true },
      { name: '🤖 IA', value: `${modeLabel}\nProvedor: **${config.aiProvider}**`, inline: true },
      { name: '🔑 Chaves detectadas', value: `Gemini: **${keyGemini ? 'SIM' : 'NÃO'}**\nGroq: **${keyGroq ? 'SIM' : 'NÃO'}**`, inline: true },
      { name: '🧠 Base da IA', value: `**${runtimeKnowledgeBase.length.toLocaleString('pt-BR')} / 50.000** caracteres`, inline: true },
      { name: '⚙️ Prompt da IA', value: `**${runtimeBehaviorPrompt.length.toLocaleString('pt-BR')}** caracteres`, inline: true },
    );
}

function configComponents() {
  return [
    one(
      new ButtonBuilder().setCustomId('cda_ticket_cfg_channels').setLabel('Canais').setEmoji('📁').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('cda_ticket_cfg_roles').setLabel('Cargos').setEmoji('👮').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('cda_ticket_cfg_functions').setLabel('Selecionar Funções').setEmoji('🧩').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('cda_ticket_cfg_team_channel').setLabel('Anúncios Times').setEmoji('🏢').setStyle(ButtonStyle.Primary),
    ),
    one(
      new ButtonBuilder().setCustomId('cda_ticket_cfg_emojis').setLabel('Emojis').setEmoji('🎨').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('cda_ticket_cfg_ai').setLabel('IA').setEmoji('🤖').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('cda_ticket_cfg_prompt').setLabel('Base da IA').setEmoji('🧠').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('cda_ticket_cfg_behavior').setLabel('Prompt da IA').setEmoji('⚙️').setStyle(ButtonStyle.Secondary),
    ),
    one(
      new ButtonBuilder().setCustomId('cda_ticket_cfg_publish').setLabel('Publicar painel').setEmoji('📨').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('cda_main_back').setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function channelsComponents() {
  return [
    one(new ChannelSelectMenuBuilder().setCustomId('cda_ticket_cfg_panel_channel').setPlaceholder('Canal do painel público').addChannelTypes(ChannelType.GuildText)),
    one(new ChannelSelectMenuBuilder().setCustomId('cda_ticket_cfg_category').setPlaceholder('Categoria padrão dos tickets').addChannelTypes(ChannelType.GuildCategory)),
    one(new ChannelSelectMenuBuilder().setCustomId('cda_ticket_cfg_log_channel').setPlaceholder('Canal de logs e transcripts').addChannelTypes(ChannelType.GuildText)),
    one(new ButtonBuilder().setCustomId('cda_ticket_cfg_back').setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary)),
  ];
}

function rolesComponents() {
  return [
    one(new RoleSelectMenuBuilder()
      .setCustomId('cda_ticket_cfg_staff_roles')
      .setPlaceholder('Cargos que podem atender tickets')
      .setMinValues(1)
      .setMaxValues(10)),
    one(new RoleSelectMenuBuilder()
      .setCustomId('cda_ticket_cfg_vip_roles')
      .setPlaceholder('Cargos considerados VIP (somente estes geram ping)')
      .setMinValues(0)
      .setMaxValues(10)),
    one(new ButtonBuilder().setCustomId('cda_ticket_cfg_back').setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary)),
  ];
}

function teamAnnouncementsComponents() {
  return [
    one(new ChannelSelectMenuBuilder()
      .setCustomId('cda_ticket_cfg_team_announcements_channel')
      .setPlaceholder('Canal onde são anunciados times/corporações disponíveis')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
    one(
      new ButtonBuilder().setCustomId('cda_ticket_cfg_team_channel_clear').setLabel('Remover canal').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('cda_ticket_cfg_back').setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function aiComponents(config = runtimeConfig) {
  return [
    one(new StringSelectMenuBuilder()
      .setCustomId('cda_ticket_cfg_ai_mode')
      .setPlaceholder('Modo da IA')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('Desativada').setValue('disabled').setEmoji('🔴').setDefault(config.aiMode === 'disabled'),
        new StringSelectMenuOptionBuilder().setLabel('Automática').setDescription('Responde até a staff assumir').setValue('automatic').setEmoji('🟢').setDefault(config.aiMode === 'automatic'),
        new StringSelectMenuOptionBuilder().setLabel('Assistente').setDescription('Só responde quando a staff pedir').setValue('assistant').setEmoji('🔵').setDefault(config.aiMode === 'assistant'),
      )),
    one(new StringSelectMenuBuilder()
      .setCustomId('cda_ticket_cfg_ai_provider')
      .setPlaceholder('Provedor da IA')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('Automático').setDescription('Gemini primeiro, depois Groq').setValue('auto').setDefault(config.aiProvider === 'auto'),
        new StringSelectMenuOptionBuilder().setLabel('Google Gemini').setValue('gemini').setDefault(config.aiProvider === 'gemini'),
        new StringSelectMenuOptionBuilder().setLabel('Groq').setValue('groq').setDefault(config.aiProvider === 'groq'),
      )),
    one(new ButtonBuilder().setCustomId('cda_ticket_cfg_back').setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary)),
  ];
}

function knowledgeBaseEmbed() {
  return new EmbedBuilder()
    .setColor(ORANGE)
    .setTitle('🧠 Base de conhecimento da IA')
    .setDescription(
      `A base aceita até **50.000 caracteres** e é salva no storage do Discord.\n\n` +
      `Tamanho atual: **${runtimeKnowledgeBase.length.toLocaleString('pt-BR')} / 50.000** caracteres.\n` +
      'Para editar, o bot vai pedir que você envie o texto em **quantas mensagens precisar**. Depois clique em **Finalizar**.'
    );
}

function knowledgeBaseComponents() {
  return [
    one(
      new ButtonBuilder().setCustomId('cda_ticket_cfg_base_replace').setLabel('Substituir base').setEmoji('✏️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('cda_ticket_cfg_base_append').setLabel('Adicionar à base').setEmoji('➕').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('cda_ticket_cfg_base_reset').setLabel('Restaurar base CDA').setEmoji('♻️').setStyle(ButtonStyle.Secondary),
    ),
    one(new ButtonBuilder().setCustomId('cda_ticket_cfg_back').setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary)),
  ];
}

function behaviorPromptEmbed() {
  return new EmbedBuilder()
    .setColor(ORANGE)
    .setTitle('⚙️ Prompt de comportamento da IA')
    .setDescription(
      'Este prompt controla **como a IA age**. A Base da IA guarda as informações do CDA.\n\n' +
      `Tamanho atual: **${runtimeBehaviorPrompt.length.toLocaleString('pt-BR')}** caracteres.`
    );
}

function behaviorPromptComponents() {
  return [
    one(
      new ButtonBuilder().setCustomId('cda_ticket_cfg_behavior_replace').setLabel('Editar prompt').setEmoji('✏️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('cda_ticket_cfg_behavior_reset').setLabel('Restaurar prompt CDA').setEmoji('♻️').setStyle(ButtonStyle.Secondary),
    ),
    one(new ButtonBuilder().setCustomId('cda_ticket_cfg_back').setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary)),
  ];
}

function textCaptureComponents(kind) {
  return [
    one(
      new ButtonBuilder().setCustomId(`cda_ticket_text_finish:${kind}`).setLabel('Finalizar').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`cda_ticket_text_cancel:${kind}`).setLabel('Cancelar').setEmoji('❌').setStyle(ButtonStyle.Danger),
    ),
  ];
}

function beginTextCapture(interaction, kind) {
  const key = `${interaction.guildId}:${interaction.user.id}`;
  const maxChars = kind.startsWith('base_') ? 50000 : 12000;
  const label = kind.startsWith('base_') ? 'Base da IA' : 'Prompt da IA';
  pendingTextChanges.set(key, {
    kind,
    chunks: [],
    charCount: 0,
    maxChars,
    label,
    channelId: interaction.channelId,
    expiresAt: Date.now() + 15 * 60_000,
    interaction,
  });
  return interaction.update({
    embeds: [new EmbedBuilder().setColor(ORANGE).setTitle(`✍️ Editando ${label}`).setDescription(
      `Envie o conteúdo neste canal em **quantas mensagens precisar**. O bot vai apagar as mensagens depois de capturá-las.\n\n` +
      `Limite: **${maxChars.toLocaleString('pt-BR')} caracteres**. Quando terminar, clique em **✅ Finalizar**.`
    )],
    components: textCaptureComponents(kind),
    content: null,
  });
}

function functionsConfigEmbed(config = runtimeConfig) {
  const lines = getFunctions(config).map(f => {
    const status = f.enabled ? '✅' : '❌';
    const category = f.categoryId ? `<#${f.categoryId}>` : '`Categoria padrão`';
    return `${status} ${f.emoji} **${f.label}** → ${category}`;
  });
  return new EmbedBuilder()
    .setColor(ORANGE)
    .setTitle('🧩 Selecionar Funções')
    .setDescription(`Marque quais funções aparecem no painel. Você também pode criar novas funções e definir uma **categoria diferente para cada uma**.\n\n${lines.join('\n') || '`Nenhuma função configurada.`'}`);
}

function functionsComponents(config = runtimeConfig) {
  const funcs = getFunctions(config);
  const enabled = funcs.filter(f => f.enabled);
  const rows = [];
  if (funcs.length) {
    rows.push(one(new StringSelectMenuBuilder()
      .setCustomId('cda_ticket_cfg_func_enabled')
      .setPlaceholder('Selecione as funções que vão aparecer')
      .setMinValues(1)
      .setMaxValues(Math.min(25, funcs.length))
      .addOptions(funcs.map(f => new StringSelectMenuOptionBuilder()
        .setLabel(f.label).setValue(f.id).setDescription(f.description.slice(0, 100)).setEmoji(f.emoji).setDefault(enabled.some(e => e.id === f.id))))));
    rows.push(one(new StringSelectMenuBuilder()
      .setCustomId('cda_ticket_cfg_func_category_pick')
      .setPlaceholder('Definir categoria de uma função')
      .addOptions(funcs.map(f => new StringSelectMenuOptionBuilder()
        .setLabel(f.label).setValue(f.id).setEmoji(f.emoji).setDescription(f.categoryId ? 'Categoria própria configurada' : 'Usando categoria padrão')))));
  }
  rows.push(one(
    new ButtonBuilder().setCustomId('cda_ticket_cfg_func_create').setLabel('Criar Função').setEmoji('➕').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('cda_ticket_cfg_back').setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
  ));
  return rows.slice(0, 5);
}

function functionCategoryComponents(functionId) {
  const f = getFunction(functionId);
  return [
    one(new ChannelSelectMenuBuilder().setCustomId(`cda_ticket_cfg_func_category:${f.id}`).setPlaceholder(`Categoria para ${f.label}`).addChannelTypes(ChannelType.GuildCategory)),
    one(
      new ButtonBuilder().setCustomId(`cda_ticket_cfg_func_category_default:${f.id}`).setLabel('Usar categoria padrão').setEmoji('📁').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('cda_ticket_cfg_functions').setLabel('Voltar às funções').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function emojiConfigEmbed(config = runtimeConfig) {
  const funcs = getFunctions(config).map(f => `${f.emoji} **${f.label}**`).join(' • ');
  return new EmbedBuilder()
    .setColor(ORANGE)
    .setTitle('🎨 Emojis dos Tickets')
    .setDescription(`Escolha abaixo **qual emoji quer trocar**. Depois o bot vai pedir para você **mandar o novo emoji como uma mensagem neste canal**. Não abre formulário.\n\n**Funções:**\n${funcs}`);
}

function emojiComponents(config = runtimeConfig) {
  const funcs = getFunctions(config);
  const actionKeys = ['claim','transfer','add','remove','close','aiSuggest','aiSummary','staffPanel','memberPanel','memberRole','subject','description','responsible','ai','attendance','rating','panelTitle','author','type','messages','reason','notifyUser','escalate','priority','wait','history','notifyStaff','setRole','rename','approve','reject'];
  const rows = [];
  if (funcs.length) {
    rows.push(one(new StringSelectMenuBuilder()
      .setCustomId('cda_ticket_cfg_emoji_function')
      .setPlaceholder('Trocar emoji de uma função')
      .addOptions(funcs.map(f => new StringSelectMenuOptionBuilder().setLabel(f.label).setValue(f.id).setEmoji(f.emoji)))));
  }
  rows.push(one(new StringSelectMenuBuilder()
    .setCustomId('cda_ticket_cfg_emoji_action')
    .setPlaceholder('Trocar emoji de botões/campos')
    .addOptions(actionKeys.map(key => new StringSelectMenuOptionBuilder().setLabel(emojiTargetLabel(key)).setValue(key).setEmoji(getEmoji(key, config))))));
  rows.push(one(new ButtonBuilder().setCustomId('cda_ticket_cfg_back').setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary)));
  return rows;
}

function beginEmojiChange(interaction, target) {
  const key = `${interaction.guildId}:${interaction.user.id}`;
  pendingEmojiChanges.set(key, { ...target, interaction, channelId: interaction.channelId, expiresAt: Date.now() + 60_000 });
  return interaction.update({
    embeds: [emojiConfigEmbed()],
    components: emojiComponents(),
    content: `🎨 **Envie agora o novo emoji como uma mensagem neste canal.**\nPode ser emoji normal ou personalizado. Você tem **60 segundos**.`,
  });
}

function ticketActionRows(meta) {
  const claimLabel = meta.claimedBy ? 'Assumido' : 'Assumir';
  return [
    one(
      new ButtonBuilder().setCustomId('cda_ticket_claim').setLabel(claimLabel).setEmoji(getEmoji('claim')).setStyle(meta.claimedBy ? ButtonStyle.Secondary : ButtonStyle.Success).setDisabled(Boolean(meta.claimedBy)),
      new ButtonBuilder().setCustomId('cda_ticket_staff_panel').setLabel('Painel Staff').setEmoji(getEmoji('staffPanel')).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('cda_ticket_member_panel').setLabel('Painel Membro').setEmoji(getEmoji('memberPanel')).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('cda_ticket_close').setLabel('Fechar ticket').setEmoji(getEmoji('close')).setStyle(ButtonStyle.Danger),
    ),
  ];
}

function staffPanelRows() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('cda_ticket_staff_routebar')
    .setPlaceholder('Selecione uma função do Painel Staff')
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel('Transferir atendimento').setValue('transfer').setEmoji(getEmoji('transfer')).setDescription('Transferir para outro staff com motivo.'),
      new StringSelectMenuOptionBuilder().setLabel('Notificar Usuário').setValue('notify_user').setEmoji(getEmoji('notifyUser')).setDescription('Enviar uma notificação por DM ao autor.'),
      new StringSelectMenuOptionBuilder().setLabel('Escalonar atendimento').setValue('escalate').setEmoji(getEmoji('escalate')).setDescription('Encaminhar o caso para uma hierarquia superior.'),
      new StringSelectMenuOptionBuilder().setLabel('Prioridade').setValue('priority').setEmoji(getEmoji('priority')).setDescription('Alternar entre Normal e VIP.'),
      new StringSelectMenuOptionBuilder().setLabel('Motivo de Espera').setValue('wait').setEmoji(getEmoji('wait')).setDescription('Colocar o atendimento em espera com motivo.'),
      new StringSelectMenuOptionBuilder().setLabel('Histórico do Usuário').setValue('history').setEmoji(getEmoji('history')).setDescription('Ver histórico e avaliações do usuário.'),
      new StringSelectMenuOptionBuilder().setLabel('Sugerir resposta IA').setValue('ai_suggest').setEmoji(getEmoji('aiSuggest')).setDescription('Gerar uma sugestão de resposta para a staff.'),
      new StringSelectMenuOptionBuilder().setLabel('Resumo IA').setValue('ai_summary').setEmoji(getEmoji('aiSummary')).setDescription('Gerar um resumo rápido do ticket.'),
      new StringSelectMenuOptionBuilder().setLabel('Setar Cargo').setValue('set_role').setEmoji(getEmoji('setRole')).setDescription('Dar um cargo não-staff com prova obrigatória.'),
      new StringSelectMenuOptionBuilder().setLabel('Renomear Ticket').setValue('rename').setEmoji(getEmoji('rename')).setDescription('Alterar o nome do canal deste ticket.'),
    );
  return [one(menu)];
}

function memberPanelRows() {
  return [
    one(
      new ButtonBuilder().setCustomId('cda_ticket_add').setLabel('Solicitar Adição').setEmoji(getEmoji('add')).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('cda_ticket_remove').setLabel('Solicitar Remoção').setEmoji(getEmoji('remove')).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('cda_ticket_notify_staff').setLabel('Notificar Staff Resp.').setEmoji(getEmoji('notifyStaff')).setStyle(ButtonStyle.Primary),
    ),
  ];
}

function protectedStaffRoleIds() {
  const ids = new Set((runtimeConfig.staffRoleIds || []).map(String));
  if (MAIN_CONFIG.teamStaffRoleId) ids.add(String(MAIN_CONFIG.teamStaffRoleId));
  for (const item of MAIN_CONFIG.hierarchy || []) if (item?.roleId) ids.add(String(item.roleId));
  return ids;
}

function validateSetRole(actor, target, role, guild) {
  if (!actor || !target || !role) return 'Não consegui validar o membro/cargo selecionado.';
  if (target.id === guild.client.user.id) return 'O bot não pode receber cargos por essa função.';
  if (role.id === guild.roles.everyone.id) return 'O cargo @everyone não pode ser selecionado.';
  if (role.managed) return 'Esse cargo é gerenciado por integração/bot e não pode ser atribuído manualmente.';
  if (protectedStaffRoleIds().has(String(role.id))) return 'Esse cargo faz parte da Staff e está bloqueado nesta função.';
  if (role.permissions?.has(PermissionFlagsBits.Administrator) || role.permissions?.has(PermissionFlagsBits.ManageGuild) || role.permissions?.has(PermissionFlagsBits.ManageRoles)) {
    return 'Cargos administrativos/gerenciais não podem ser atribuídos por essa função.';
  }
  if (role.position >= (actor.roles?.highest?.position || 0)) return 'Você só pode setar cargos abaixo do seu cargo mais alto.';
  const me = guild.members.me;
  if (!me?.permissions?.has(PermissionFlagsBits.ManageRoles)) return 'O bot não possui a permissão Gerenciar Cargos.';
  if (role.position >= (me.roles?.highest?.position || 0)) return 'O cargo do bot precisa estar acima do cargo que será setado.';
  return '';
}

async function openStaffRouteAction(interaction, action, meta, staff, client) {
  if (!staff) return interaction.reply({ content: '❌ Apenas a equipe pode usar o Painel Staff.', ephemeral: true });

  if (action === 'transfer') {
    return interaction.reply({ content: 'Selecione o membro da equipe que receberá este ticket:', components: [one(new UserSelectMenuBuilder().setCustomId('cda_ticket_transfer_user').setPlaceholder('Selecionar staff').setMinValues(1).setMaxValues(1))], ephemeral: true });
  }
  if (action === 'notify_user') {
    const modal = new ModalBuilder().setCustomId('cda_ticket_notify_user_modal').setTitle('Notificar usuário');
    modal.addComponents(one(new TextInputBuilder().setCustomId('message').setLabel('Mensagem da notificação').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(2).setMaxLength(1000).setPlaceholder('Mensagem que será enviada no privado do usuário.')));
    return interaction.showModal(modal);
  }
  if (action === 'escalate') {
    const modal = new ModalBuilder().setCustomId('cda_ticket_escalate_modal').setTitle('Escalonar atendimento');
    modal.addComponents(one(new TextInputBuilder().setCustomId('reason').setLabel('Motivo do escalonamento').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(3).setMaxLength(500).setPlaceholder('Por que este caso precisa de uma hierarquia superior?')));
    return interaction.showModal(modal);
  }
  if (action === 'priority') {
    const current = getTicketRuntime(interaction.channelId).priority || 'normal';
    return interaction.reply({ content: `Prioridade atual: **${current === 'vip' ? 'VIP' : 'Normal'}**`, components: [one(new StringSelectMenuBuilder().setCustomId('cda_ticket_priority_select').setPlaceholder('Alterar prioridade').addOptions(
      new StringSelectMenuOptionBuilder().setLabel('Normal').setValue('normal').setEmoji('🎫').setDefault(current === 'normal'),
      new StringSelectMenuOptionBuilder().setLabel('VIP').setValue('vip').setEmoji('💎').setDefault(current === 'vip')
    ))], ephemeral: true });
  }
  if (action === 'wait') {
    const modal = new ModalBuilder().setCustomId('cda_ticket_wait_modal').setTitle('Motivo de espera');
    modal.addComponents(one(new TextInputBuilder().setCustomId('reason').setLabel('Por que o ticket está aguardando?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(3).setMaxLength(500).setPlaceholder('Ex.: aguardando resposta do usuário / comprovante / análise.')));
    return interaction.showModal(modal);
  }
  if (action === 'history') return interaction.reply({ embeds: [userHistoryEmbed(meta.ownerId)], ephemeral: true });

  if (action === 'ai_suggest') {
    if (runtimeConfig.aiMode === 'disabled') return interaction.reply({ content: '⚠️ A IA está desativada em `/ticketconfig`.', ephemeral: true });
    if (!selectProvider()) return interaction.reply({ content: '⚠️ Configure `GEMINI_API_KEY` ou `GROQ_API_KEY` nas variáveis da hospedagem.', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    try {
      const answer = await generateAI(interaction.channel, 'Com base na conversa, escreva uma sugestão curta de resposta que um atendente humano possa enviar agora. Não diga que você é uma IA.');
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(ORANGE).setTitle('✨ Sugestão da IA').setDescription(answer)] });
    } catch (err) {
      console.error('❌ Sugestão IA:', err.message);
      return interaction.editReply('⚠️ A IA está temporariamente indisponível. O erro técnico foi registrado no console e outro atendente pode continuar o atendimento.');
    }
  }

  if (action === 'ai_summary') {
    if (runtimeConfig.aiMode === 'disabled') return interaction.reply({ content: '⚠️ A IA está desativada em `/ticketconfig`.', ephemeral: true });
    if (!selectProvider()) return interaction.reply({ content: '⚠️ Configure `GEMINI_API_KEY` ou `GROQ_API_KEY` nas variáveis da hospedagem.', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    try {
      const answer = await generateAI(interaction.channel, 'Resuma este ticket para a staff em no máximo 8 linhas. Use: Motivo, O que aconteceu, O que já foi tentado, Pendência e Próxima ação. Se algo não estiver claro, escreva “não informado”.');
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(ORANGE).setTitle(`📋 Resumo — ${ticketCode(meta.id)}`).setDescription(answer)] });
    } catch (err) {
      console.error('❌ Resumo IA:', err.message);
      return interaction.editReply('⚠️ A IA está temporariamente indisponível. O erro técnico foi registrado no console e outro atendente pode continuar o atendimento.');
    }
  }

  if (action === 'set_role') {
    return interaction.reply({
      content: 'Selecione o membro que receberá o cargo. **Cargos da Staff e cargos administrativos ficam bloqueados.**',
      components: [one(new UserSelectMenuBuilder().setCustomId('cda_ticket_setrole_user').setPlaceholder('Selecionar membro').setMinValues(1).setMaxValues(1))],
      ephemeral: true,
    });
  }

  if (action === 'rename') {
    const modal = new ModalBuilder().setCustomId('cda_ticket_rename_modal').setTitle('Renomear Ticket');
    modal.addComponents(one(new TextInputBuilder().setCustomId('name').setLabel('Novo nome do ticket').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(2).setMaxLength(70).setPlaceholder('Ex.: compra-vip / suporte-veiculo / denuncia')));
    return interaction.showModal(modal);
  }

  return interaction.reply({ content: '⚠️ Função não encontrada.', ephemeral: true });
}

function ticketWelcomeEmbed(meta, subject, description, priority = 'normal') {
  const type = getFunction(meta.type);
  return new EmbedBuilder()
    .setColor(ORANGE)
    .setTitle(`${type.emoji} ${ticketCode(meta.id)} — ${type.label}`)
    .setDescription(`Olá <@${meta.ownerId}>! Seu atendimento foi criado.\n\nA equipe vai analisar o caso e assumir o ticket assim que possível.`)
    .addFields(
      { name: `${getEmoji('subject')} Assunto`, value: subject || 'Não informado', inline: false },
      { name: `${getEmoji('description')} Descrição`, value: description || 'Não informada', inline: false },
      { name: `${getEmoji('responsible')} Responsável`, value: meta.claimedBy ? `<@${meta.claimedBy}>` : '`Aguardando staff`', inline: true },
      { name: '💎 Prioridade', value: priority === 'vip' ? '**VIP**' : 'Normal', inline: true },
      { name: `${getEmoji('ai')} IA`, value: runtimeConfig.aiMode === 'automatic' ? 'Ativa até um staff assumir.' : runtimeConfig.aiMode === 'assistant' ? 'Disponível como assistente da staff.' : 'Desativada.', inline: true },
    )
    .setFooter({ text: 'Cidade Alta [RP] © 2026 • Todos os direitos reservados.' })
    .setTimestamp();
}

async function ensureCommands(guild) {
  const desired = [
    { name: 'ticketconfig', description: 'Configura o sistema de tickets do CDA.' },
    { name: 'painelticket', description: 'Publica o painel oficial de tickets do CDA.' },
    { name: 'ticketdashboard', description: 'Mostra o dashboard de desempenho dos tickets.' },
  ];
  const existing = await guild.commands.fetch();
  for (const cmd of desired) {
    const found = existing.find(c => c.name === cmd.name);
    if (found) await found.edit(cmd);
    else await guild.commands.create(cmd);
  }
}

async function publishPanel(guild, config = runtimeConfig) {
  if (!config.panelChannelId) throw new Error('Canal do painel não configurado.');
  const channel = await guild.channels.fetch(config.panelChannelId).catch(() => null);
  if (!channel?.isTextBased()) throw new Error('Canal do painel inválido.');

  // Limpa painéis antigos mesmo quando o ID salvo foi perdido em outro deploy/hosting.
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (recent) {
    for (const old of recent.values()) {
      const title = old.embeds?.[0]?.title || '';
      if (old.author?.id === guild.client.user.id && title.includes('CENTRAL DE ATENDIMENTO — CDA')) await old.delete().catch(() => {});
    }
  } else if (config.panelMessageId) {
    const old = await channel.messages.fetch(config.panelMessageId).catch(() => null);
    if (old) await old.delete().catch(() => {});
  }

  const msg = await channel.send({ embeds: [panelEmbed(config)], components: panelComponents(config) });
  config.panelMessageId = msg.id;
  saveConfig(config);
  return msg;
}

async function findOpenTicket(guild, ownerId) {
  await guild.channels.fetch().catch(() => {});
  return guild.channels.cache.find(ch => {
    const meta = parseTopic(ch);
    return meta?.ownerId === ownerId;
  }) || null;
}

async function nextTicketId() {
  const id = Number(runtimeState.lastId || 0) + 1;
  saveState({ lastId: id });
  return id;
}

async function createTicket(interaction, typeKey, subject, description) {
  const guild = interaction.guild;
  const config = runtimeConfig;
  const existing = await findOpenTicket(guild, interaction.user.id);
  if (existing) {
    return interaction.reply({ content: `⚠️ Você já possui um ticket aberto: ${existing}`, ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  const id = await nextTicketId();
  const meta = {
    id,
    ownerId: interaction.user.id,
    type: getFunction(typeKey)?.id || 'outros',
    claimedBy: '',
    handoff: false,
    createdAt: Date.now(),
  };

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: interaction.user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks],
    },
    {
      id: guild.members.me?.id || interaction.client.user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks],
    },
  ];
  for (const roleId of config.staffRoleIds || []) {
    overwrites.push({
      id: roleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks],
    });
  }

  let ticketChannel;
  try {
    ticketChannel = await guild.channels.create({
      name: `ticket-${String(id).padStart(4, '0')}-${sanitizeName(interaction.user.username)}`,
      type: ChannelType.GuildText,
      parent: (getFunction(meta.type, config)?.categoryId || config.categoryId || null),
      topic: encodeTopic(meta),
      permissionOverwrites: overwrites,
      reason: `Ticket ${ticketCode(id)} aberto por ${interaction.user.tag}`,
    });
  } catch (err) {
    console.error('❌ Criar ticket:', err);
    return interaction.editReply('❌ Não consegui criar o canal. Confira se o bot possui **Gerenciar Canais** e acesso à categoria configurada.');
  }

  const openerMember = interaction.member || await guild.members.fetch(interaction.user.id).catch(() => null);
  const isVip = (config.vipRoleIds || []).some(roleId => openerMember?.roles?.cache?.has(String(roleId)));
  const priority = isVip ? 'vip' : 'normal';
  updateTicketRuntime(ticketChannel.id, { priority, waitReason: '', waitSince: 0, reminderSent: false });
  recordTicketOpened(meta, ticketChannel.id, priority);

  const staffPing = isVip ? (config.staffRoleIds || []).map(id => `<@&${id}>`).join(' ') : '';
  await ticketChannel.send({
    content: [interaction.user.toString(), staffPing].filter(Boolean).join(' '),
    embeds: [ticketWelcomeEmbed(meta, subject, description, priority)],
    components: ticketActionRows(meta),
    allowedMentions: { users: [interaction.user.id], roles: isVip ? (config.staffRoleIds || []) : [] },
  });
  await sendOrganizedLog(interaction.client, `${isVip ? '💎' : '🎫'} Ticket aberto — ${ticketCode(meta.id)}`, [
    { name: 'Usuário', value: `<@${meta.ownerId}>`, inline: true },
    { name: 'Tipo', value: getFunction(meta.type)?.label || meta.type, inline: true },
    { name: 'Prioridade', value: isVip ? 'VIP — ping enviado' : 'Normal — sem ping', inline: true },
  ]).catch(() => {});

  await interaction.editReply(`✅ Ticket criado: ${ticketChannel}${isVip ? ' • 💎 **Prioridade VIP**' : ''}`);
}

async function fetchTranscriptMessages(channel, max = 1000) {
  const all = [];
  let before;
  while (all.length < max) {
    const batch = await channel.messages.fetch({ limit: Math.min(100, max - all.length), before }).catch(() => null);
    if (!batch?.size) break;
    const values = [...batch.values()];
    all.push(...values);
    before = values[values.length - 1].id;
    if (batch.size < 100) break;
  }
  return all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function transcriptHtml(channel, meta, messages) {
  const rows = messages.map(msg => {
    const attachments = [...msg.attachments.values()].map(a => `<div class="att"><a href="${esc(a.url)}">📎 ${esc(a.name || 'anexo')}</a></div>`).join('');
    const embeds = msg.embeds?.length ? `<div class="embed">[${msg.embeds.length} embed(s)]</div>` : '';
    return `<article><div class="avatar">${esc((msg.author?.displayName || msg.author?.username || '?').slice(0, 1).toUpperCase())}</div><div class="body"><div class="head"><b>${esc(msg.member?.displayName || msg.author?.username || 'Usuário')}</b><span>${esc(new Date(msg.createdTimestamp).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' }))}</span></div><div class="content">${esc(msg.content || '').replace(/\n/g, '<br>')}</div>${attachments}${embeds}</div></article>`;
  }).join('\n');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${ticketCode(meta.id)}</title><style>body{font-family:Arial,sans-serif;background:#1e1f22;color:#dbdee1;margin:0;padding:28px}.wrap{max-width:920px;margin:auto}.top{background:#2b2d31;padding:20px;border-radius:12px;margin-bottom:18px}.top h1{margin:0 0 8px;color:#fff}.muted{color:#949ba4}article{display:flex;gap:12px;padding:14px 8px;border-bottom:1px solid #313338}.avatar{width:38px;height:38px;border-radius:50%;background:#ff8c00;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:bold;flex:none}.body{min-width:0}.head{display:flex;gap:10px;align-items:baseline}.head b{color:#f2f3f5}.head span{color:#949ba4;font-size:12px}.content{margin-top:4px;word-break:break-word}.att a{color:#00a8fc}.embed{margin-top:6px;padding:7px 10px;border-left:3px solid #ff8c00;background:#2b2d31;color:#b5bac1}</style></head><body><div class="wrap"><div class="top"><h1>🎫 ${ticketCode(meta.id)}</h1><div>Canal: #${esc(channel.name)} • Autor: ${esc(meta.ownerId)} • Tipo: ${esc(meta.type)}</div><div class="muted">Transcript gerado pelo CDA Gestão</div></div>${rows || '<p>Nenhuma mensagem encontrada.</p>'}</div></body></html>`;
}

async function sendCloseLog(client, channel, meta, closedBy, reason, messages, summary = '') {
  const logChannel = runtimeConfig.logChannelId
    ? await client.channels.fetch(runtimeConfig.logChannelId).catch(() => null)
    : null;
  if (!logChannel?.isTextBased()) return false;
  const html = transcriptHtml(channel, meta, messages);
  const file = new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: `${ticketCode(meta.id)}-transcript.html` });
  const embed = new EmbedBuilder()
    .setColor(ORANGE)
    .setTitle(`${getEmoji('close')} Ticket encerrado — ${ticketCode(meta.id)}`)
    .addFields(
      { name: `${getEmoji('author')} Autor`, value: `<@${meta.ownerId}>`, inline: true },
      { name: `${getEmoji('responsible')} Encerrado por`, value: `<@${closedBy}>`, inline: true },
      { name: `${getEmoji('claim')} Atendente`, value: meta.claimedBy ? `<@${meta.claimedBy}>` : '`Não assumido`', inline: true },
      { name: `${getEmoji('type')} Tipo`, value: getFunction(meta.type)?.label || meta.type, inline: true },
      { name: `${getEmoji('messages')} Mensagens`, value: String(messages.length), inline: true },
      { name: `${getEmoji('reason')} Motivo`, value: reason || 'Não informado', inline: false },
      ...(summary ? [{ name: '🤖 Resumo automático', value: String(summary).slice(0, 1024), inline: false }] : []),
    )
    .setTimestamp();
  await logChannel.send({ embeds: [embed], files: [file], allowedMentions: { parse: [] } });
  return true;
}

async function sendRatingDM(client, meta) {
  const user = await client.users.fetch(meta.ownerId).catch(() => null);
  if (!user) return;
  const buttons = [1, 2, 3, 4, 5].map(score =>
    new ButtonBuilder()
      .setCustomId(`cda_ticket_rate:${meta.id}:${score}`)
      .setLabel(String(score))
      .setEmoji(getEmoji('rating'))
      .setStyle(score >= 4 ? ButtonStyle.Success : score === 3 ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );
  await user.send({
    embeds: [new EmbedBuilder()
      .setColor(ORANGE)
      .setTitle(`${getEmoji('rating')} Avalie seu atendimento — ${ticketCode(meta.id)}`)
      .setDescription('De **1 a 5 estrelas**, como foi o atendimento da equipe do Cidade Alta RP?')],
    components: [one(...buttons)],
  }).catch(() => {});
}

async function recentConversation(channel, limit = 30) {
  const msgs = await channel.messages.fetch({ limit }).catch(() => null);
  if (!msgs) return [];
  return [...msgs.values()]
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .filter(m => !m.system)
    .map(m => ({
      role: m.author.id === channel.client.user.id ? 'assistant' : 'user',
      name: m.member?.displayName || m.author.username,
      content: String(m.content || '').trim(),
    }))
    .filter(m => m.content)
    .slice(-28);
}

function selectProvider(config = runtimeConfig) {
  if (config.aiProvider === 'gemini') return process.env.GEMINI_API_KEY ? 'gemini' : null;
  if (config.aiProvider === 'groq') return process.env.GROQ_API_KEY ? 'groq' : null;
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.GROQ_API_KEY) return 'groq';
  return null;
}

async function callGemini(systemPrompt, history, instruction = '') {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY não configurada.');

  const configuredModel = String(process.env.GEMINI_MODEL || 'gemini-3.6-flash').trim();
  const fallbackModel = 'gemini-3.6-flash';
  const contents = history.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.role === 'user' ? `${m.name}: ${m.content}` : m.content }],
  }));
  if (instruction) contents.push({ role: 'user', parts: [{ text: instruction }] });

  const request = async model => {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { maxOutputTokens: 650 },
      }),
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  };

  let model = configuredModel;
  let { res, data } = await request(model);

  // Evita o ticket ficar apenas em “digitando...” quando um nome de modelo antigo/inválido foi configurado.
  if (!res.ok && res.status === 404 && model !== fallbackModel) {
    console.warn(`⚠️ Modelo Gemini ${model} não encontrado. Tentando fallback ${fallbackModel}.`);
    model = fallbackModel;
    ({ res, data } = await request(model));
  }

  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${data?.error?.message || 'erro desconhecido'}`);
  return data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim() || '';
}

async function callGroq(systemPrompt, history, instruction = '') {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY não configurada.');
  const model = String(process.env.GROQ_MODEL || 'llama-3.3-70b-versatile').trim();
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map(m => ({ role: m.role, content: m.role === 'user' ? `${m.name}: ${m.content}` : m.content })),
  ];
  if (instruction) messages.push({ role: 'user', content: instruction });
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, max_completion_tokens: 650 }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Groq HTTP ${res.status}: ${data?.error?.message || 'erro desconhecido'}`);
  return String(data?.choices?.[0]?.message?.content || '').trim();
}

function announcementMessageText(message) {
  const parts = [];
  if (message.content?.trim()) parts.push(message.content.trim());
  for (const embed of message.embeds || []) {
    if (embed.title) parts.push(embed.title);
    if (embed.description) parts.push(embed.description);
    for (const field of embed.fields || []) parts.push(`${field.name}: ${field.value}`);
  }
  return parts.join(' | ').replace(/\s+/g, ' ').trim();
}

async function teamAnnouncementsContext(guild) {
  const id = String(runtimeConfig.teamAnnouncementsChannelId || '').trim();
  if (!id) return 'CANAL DE ANÚNCIOS DE TIMES: não configurado. Não existe disponibilidade confirmada pelo sistema.';
  const channel = await guild.channels.fetch(id).catch(() => null);
  if (!channel?.isTextBased()) return 'CANAL DE ANÚNCIOS DE TIMES: canal configurado indisponível. Não confirme vagas.';
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages?.size) return `CANAL DE ANÚNCIOS DE TIMES (${channel.name}): nenhuma mensagem recente encontrada. Não confirme vagas.`;

  const rows = [...messages.values()]
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map(message => {
      const text = announcementMessageText(message);
      if (!text) return null;
      const date = new Date(message.createdTimestamp).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' });
      return `[${date}] ${message.author?.username || 'Sistema'}: ${text}`;
    })
    .filter(Boolean);

  const joined = rows.join('\n');
  return `CANAL DE ANÚNCIOS DE TIMES — DADOS ATUAIS DO SERVIDOR (${channel.name}):\n${joined.slice(-16000) || 'Nenhuma informação textual encontrada.'}`;
}

function looksLikeTeamIntent(history = []) {
  const recent = history.filter(m => m.role === 'user').map(m => m.content).join(' ');
  return /(assumir|assumo|assume|liderar|lideran[cç]a|corpora[cç][aã]o|corp\b|time\b|fac[cç][aã]o|facção|vaga.*time|vaga.*corp)/i.test(recent);
}

async function generateAI(channel, instruction = '') {
  const provider = selectProvider();
  if (!provider) throw new Error('Nenhuma chave de IA configurada.');
  const history = await recentConversation(channel, 30);
  const teamContext = looksLikeTeamIntent(history)
    ? await teamAnnouncementsContext(channel.guild)
    : 'DADOS ATUAIS — ANÚNCIOS DE TIMES: não consultados porque o assunto atual não indica pedido para assumir time/corporação.';
  const systemPrompt = `${runtimeBehaviorPrompt}

BASE DE CONHECIMENTO DO CDA:
${runtimeKnowledgeBase}

DADOS ATUAIS DO SERVIDOR:
${teamContext}

Contexto do ticket: ${channel.name}.`;
  let text = '';
  const attempts = [];
  if (runtimeConfig.aiProvider === 'auto') {
    if (process.env.GEMINI_API_KEY) attempts.push(['gemini', callGemini]);
    if (process.env.GROQ_API_KEY) attempts.push(['groq', callGroq]);
  } else if (provider === 'gemini') {
    attempts.push(['gemini', callGemini]);
    if (process.env.GROQ_API_KEY) attempts.push(['groq', callGroq]);
  } else {
    attempts.push(['groq', callGroq]);
    if (process.env.GEMINI_API_KEY) attempts.push(['gemini', callGemini]);
  }

  const errors = [];
  for (const [name, fn] of attempts) {
    try {
      text = await fn(systemPrompt, history, instruction);
      if (text) {
        if (errors.length) console.log(`✅ IA fallback: ${name} respondeu após falha do provedor anterior.`);
        break;
      }
      errors.push(`${name}: resposta vazia`);
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
      console.warn(`⚠️ IA ${name} falhou; tentando fallback quando disponível: ${err.message}`);
    }
  }
  if (!text) throw new Error(`Todos os provedores de IA falharam. ${errors.join(' | ')}`);
  const marker = '[ENCAMINHAR_STAFF]';
  const hasMarker = text.includes(marker);
  let output = text.slice(0, 3900);
  if (hasMarker && !output.includes(marker)) output = `${output.trim()}\n${marker}`;
  return output;
}

async function logRating(client, ticketId, userId, score, feedback = '') {
  const logChannel = runtimeConfig.logChannelId
    ? await client.channels.fetch(runtimeConfig.logChannelId).catch(() => null)
    : null;
  if (!logChannel?.isTextBased()) return;
  await logChannel.send({
    embeds: [new EmbedBuilder()
      .setColor(ORANGE)
      .setTitle(`${getEmoji('rating')} Avaliação — ${ticketCode(ticketId)}`)
      .addFields(
        { name: '👤 Usuário', value: `<@${userId}>`, inline: true },
        { name: `${getEmoji('rating')} Nota`, value: `${getEmoji('rating').repeat(score)} (${score}/5)`, inline: true },
        ...(feedback ? [{ name: '💬 Feedback', value: String(feedback).slice(0, 1000), inline: false }] : []),
      )
      .setTimestamp()],
    allowedMentions: { parse: [] },
  });
}

function setupTickets(client, startupReady = Promise.resolve()) {
  client.once('ready', async () => {
    await startupReady;
    try {
      const guildId = String(runtimeConfig.guildId || process.env.GUILD_ID || '').trim();
      let resolvedGuildId = guildId;
      if (!resolvedGuildId) {
        try {
          const main = require('./config.json');
          resolvedGuildId = String(main.guildId || '').trim();
        } catch {}
      }
      if (!resolvedGuildId) throw new Error('Guild ID não configurado.');
      const guild = await client.guilds.fetch(resolvedGuildId);
      runtimeConfig.guildId = guild.id;
      saveConfig(runtimeConfig);
      await ensureCommands(guild);
      console.log(`🎫 Sistema de Tickets: comandos registrados em ${guild.name} (${guild.id}).`);
      if (!client.__cdaTicketReminderInterval) {
        client.__cdaTicketReminderInterval = setInterval(async () => {
          const now = Date.now();
          for (const [channelId, state] of Object.entries(ticketRuntimeData || {})) {
            if (!state?.waitSince || state.reminderSent || now - Number(state.waitSince) < WAIT_REMINDER_MS) continue;
            const channel = await client.channels.fetch(channelId).catch(() => null);
            const meta = parseTopic(channel);
            if (!channel?.isTextBased() || !meta) continue;
            await channel.send({ content: `<@${meta.ownerId}> ⏰ **Lembrete automático:** seu ticket está aguardando sua resposta. Motivo da espera: **${String(state.waitReason || 'Aguardando retorno').slice(0, 300)}**`, allowedMentions: { users: [meta.ownerId] } }).catch(() => {});
            updateTicketRuntime(channelId, { reminderSent: true });
            await sendOrganizedLog(client, `⏰ Lembrete automático — ${ticketCode(meta.id)}`, [{ name: 'Usuário', value: `<@${meta.ownerId}>`, inline: true }, { name: 'Motivo da espera', value: String(state.waitReason || 'Aguardando retorno').slice(0, 1000), inline: false }]).catch(() => {});
          }
        }, 5 * 60_000);
      }
    } catch (err) {
      console.error('❌ Tickets - inicialização:', err.message);
    }
  });

  client.on('messageCreate', async message => {
    await startupReady;
    try {
      if (!message.guild || message.author.bot) return;

      const pendingKey = `${message.guild.id}:${message.author.id}`;

      const pendingText = pendingTextChanges.get(pendingKey);
      if (pendingText) {
        if (pendingText.expiresAt < Date.now()) {
          pendingTextChanges.delete(pendingKey);
        } else if (pendingText.channelId === message.channel.id) {
          const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
          if (member?.permissions?.has(PermissionFlagsBits.Administrator)) {
            const value = String(message.content || '').trim();
            if (!value) {
              const warn = await message.reply('⚠️ Envie uma mensagem de texto com o conteúdo que deseja adicionar.').catch(() => null);
              if (warn) setTimeout(() => warn.delete().catch(() => {}), 5000);
              return;
            }
            const separator = pendingText.chunks.length ? 2 : 0;
            const projected = pendingText.charCount + separator + value.length;
            if (projected > pendingText.maxChars) {
              const warn = await message.reply(`⚠️ Essa mensagem ultrapassaria o limite de **${pendingText.maxChars.toLocaleString('pt-BR')} caracteres**. Restam **${Math.max(0, pendingText.maxChars - pendingText.charCount).toLocaleString('pt-BR')}**.`).catch(() => null);
              if (warn) setTimeout(() => warn.delete().catch(() => {}), 7000);
              return;
            }
            pendingText.chunks.push(value);
            pendingText.charCount = projected;
            await message.delete().catch(() => {});
            await pendingText.interaction?.editReply({
              embeds: [new EmbedBuilder().setColor(ORANGE).setTitle(`✍️ Editando ${pendingText.label}`).setDescription(
                `Conteúdo capturado: **${pendingText.charCount.toLocaleString('pt-BR')} / ${pendingText.maxChars.toLocaleString('pt-BR')}** caracteres.

` +
                'Pode continuar enviando mensagens. Quando terminar, clique em **✅ Finalizar**.'
              )],
              components: textCaptureComponents(pendingText.kind),
              content: null,
            }).catch(() => {});
            return;
          }
        }
      }

      const pending = pendingEmojiChanges.get(pendingKey);
      if (pending) {
        if (pending.expiresAt < Date.now()) {
          pendingEmojiChanges.delete(pendingKey);
        } else if (pending.channelId === message.channel.id) {
          const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
          if (member?.permissions?.has(PermissionFlagsBits.Administrator)) {
            const emoji = parseEmojiMessage(message.content);
            if (!emoji) {
              const warn = await message.reply('⚠️ Mande **somente o emoji** que deseja usar. Ex.: `🎫` ou um emoji personalizado do Discord.').catch(() => null);
              if (warn) setTimeout(() => warn.delete().catch(() => {}), 5000);
              return;
            }
            if (pending.kind === 'function') {
              const funcs = getFunctions();
              const idx = funcs.findIndex(f => f.id === pending.id);
              if (idx >= 0) funcs[idx].emoji = emoji;
              runtimeConfig.ticketFunctions = funcs;
            } else {
              runtimeConfig.emojis = { ...runtimeConfig.emojis, [pending.key]: emoji };
            }
            saveConfig(runtimeConfig);
            pendingEmojiChanges.delete(pendingKey);
            await message.delete().catch(() => {});
            const edited = await pending.interaction?.editReply({
              content: `✅ Emoji de **${pending.label}** alterado para ${emoji} e salvo no storage.`,
              embeds: [emojiConfigEmbed()],
              components: emojiComponents(),
            }).then(() => true).catch(() => false);
            if (!edited) {
              const ok = await message.channel.send(`✅ Emoji de **${pending.label}** alterado para ${emoji} e salvo no storage.`).catch(() => null);
              if (ok) setTimeout(() => ok.delete().catch(() => {}), 6000);
            }
            return;
          }
        }
      }

      const pendingRole = pendingRoleProofs.get(pendingKey);
      if (pendingRole) {
        if (pendingRole.expiresAt < Date.now()) {
          pendingRoleProofs.delete(pendingKey);
        } else if (pendingRole.channelId === message.channel.id) {
          const actor = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
          if (hasStaffRole(actor)) {
            const proofText = String(message.content || '').trim();
            const attachments = [...message.attachments.values()].map(a => a.url).filter(Boolean);
            if (!proofText && !attachments.length) {
              const warn = await message.reply('⚠️ Envie a **prova do cargo** como mensagem normal. Pode ser texto, imagem ou arquivo.').catch(() => null);
              if (warn) setTimeout(() => warn.delete().catch(() => {}), 6000);
              return;
            }

            const target = await message.guild.members.fetch(pendingRole.targetId).catch(() => null);
            const role = await message.guild.roles.fetch(pendingRole.roleId).catch(() => null);
            const validation = validateSetRole(actor, target, role, message.guild);
            if (validation) {
              pendingRoleProofs.delete(pendingKey);
              await message.reply(`❌ Não foi possível setar o cargo: **${validation}**`).catch(() => {});
              return;
            }

            try {
              await target.roles.add(role, `Cargo setado via ticket por ${message.author.tag} • ${pendingRole.ticketCode}`);
              pendingRoleProofs.delete(pendingKey);
              const proofLines = [
                proofText ? `Texto: ${proofText.slice(0, 900)}` : '',
                attachments.length ? `Anexos: ${attachments.slice(0, 3).join('\n')}` : '',
                `Mensagem: ${message.url}`,
              ].filter(Boolean).join('\n');
              await sendOrganizedLog(client, `🏷️ Cargo setado — ${pendingRole.ticketCode}`, [
                { name: 'Staff', value: `<@${message.author.id}>`, inline: true },
                { name: 'Membro', value: `<@${target.id}>`, inline: true },
                { name: 'Cargo', value: `<@&${role.id}>`, inline: true },
                { name: 'Prova', value: proofLines.slice(0, 1000), inline: false },
              ]).catch(() => {});
              await message.reply({
                content: `✅ Cargo <@&${role.id}> setado em <@${target.id}>. A prova ficou vinculada a esta mensagem e ao log.`,
                allowedMentions: { users: [target.id], roles: [] },
              }).catch(() => {});
              return;
            } catch (err) {
              pendingRoleProofs.delete(pendingKey);
              await message.reply(`❌ Não consegui setar o cargo: **${String(err.message || err).slice(0, 300)}**`).catch(() => {});
              return;
            }
          }
        }
      }

      const ticketMetaForMessage = parseTopic(message.channel);
      if (ticketMetaForMessage && ticketMetaForMessage.ownerId === message.author.id) {
        const state = getTicketRuntime(message.channel.id);
        if (state.waitSince) {
          updateTicketRuntime(message.channel.id, { waitReason: '', waitSince: 0, reminderSent: false });
          await sendOrganizedLog(client, `▶️ Atendimento retomado — ${ticketCode(ticketMetaForMessage.id)}`, [{ name: 'Usuário', value: `<@${message.author.id}>`, inline: true }, { name: 'Status', value: 'O usuário respondeu após o ticket entrar em espera.', inline: false }]).catch(() => {});
        }
      }

      if (runtimeConfig.aiMode !== 'automatic') return;
      const meta = ticketMetaForMessage;
      if (!meta || meta.claimedBy || meta.handoff || meta.ownerId !== message.author.id) return;
      if (!message.content?.trim()) return;
      if (!selectProvider()) return;
      if (aiBusy.has(message.channel.id)) return;

      aiBusy.add(message.channel.id);
      try {
        await message.channel.sendTyping();
        const answer = await generateAI(message.channel);
        const shouldHandoff = answer.includes('[ENCAMINHAR_STAFF]');
        const cleanAnswer = answer.replace(/\[ENCAMINHAR_STAFF\]/g, '').trim().slice(0, 1900);
        await message.reply({
          content: `${getEmoji('ai')} **Assistente CDA**
${cleanAnswer}`,
          allowedMentions: { repliedUser: false },
        });
        if (shouldHandoff) {
          await updateTopic(message.channel, { handoff: true }).catch(() => {});
          const roles = runtimeConfig.staffRoleIds || [];
          const staffPing = roles.map(id => `<@&${id}>`).join(' ');
          await message.channel.send({
            content: `${staffPing ? `${staffPing} ` : ''}👮 **Triagem da IA concluída.** Um membro real da equipe deve continuar este atendimento.`,
            allowedMentions: { roles },
          }).catch(() => {});
        }
      } catch (err) {
        console.error('⚠️ IA automática do ticket:', err.message);
        await message.channel.send('⚠️ **Assistente CDA temporariamente indisponível.** A equipe pode continuar o atendimento enquanto a IA se recupera.').catch(() => {});
      } finally {
        aiBusy.delete(message.channel.id);
      }
    } catch (err) {
      console.error('❌ Ticket messageCreate:', err);
    }
  });

  client.on('interactionCreate', async interaction => {
    if (!global.__CDA_STARTUP_READY) return;
    await startupReady;
    try {
      // Avaliação em DM
      if (interaction.isButton() && interaction.customId.startsWith('cda_ticket_rate:')) {
        const [, idRaw, scoreRaw] = interaction.customId.split(':');
        const ticketId = Number(idRaw);
        const score = Number(scoreRaw);
        if (!ticketId || score < 1 || score > 5) return;
        recordRating(ticketId, interaction.user.id, score);
        await logRating(client, ticketId, interaction.user.id, score).catch(() => {});
        return interaction.update({
          embeds: [new EmbedBuilder().setColor(ORANGE).setTitle('✅ Avaliação registrada').setDescription(`Obrigado! Você avaliou o atendimento com **${score}/5**. Se quiser, envie também um comentário sobre o atendimento.`)],
          components: [one(new ButtonBuilder().setCustomId(`cda_ticket_feedback:${ticketId}:${score}`).setLabel('Adicionar comentário').setEmoji('💬').setStyle(ButtonStyle.Primary))],
        });
      }

      if (interaction.isButton() && interaction.customId.startsWith('cda_ticket_feedback:')) {
        const [, idRaw, scoreRaw] = interaction.customId.split(':');
        const modal = new ModalBuilder().setCustomId(`cda_ticket_feedback_modal:${idRaw}:${scoreRaw}`).setTitle('Feedback do atendimento');
        modal.addComponents(one(new TextInputBuilder().setCustomId('feedback').setLabel('O que achou do atendimento?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(2).setMaxLength(1000).setPlaceholder('Conte o que foi bom ou o que poderia melhorar.')));
        return interaction.showModal(modal);
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('cda_ticket_feedback_modal:')) {
        const [, idRaw, scoreRaw] = interaction.customId.split(':');
        const ticketId = Number(idRaw), score = Number(scoreRaw);
        const feedback = interaction.fields.getTextInputValue('feedback');
        recordRating(ticketId, interaction.user.id, score, feedback);
        await logRating(client, ticketId, interaction.user.id, score, feedback).catch(() => {});
        return interaction.reply({ content: '✅ Obrigado! Seu comentário também foi registrado.', ephemeral: true });
      }

      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'ticketconfig') {
          if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Apenas Administradores podem configurar tickets.', ephemeral: true });
          runtimeConfig.guildId = interaction.guildId;
          saveConfig(runtimeConfig);
          return interaction.reply({ embeds: [configEmbed()], components: configComponents(), ephemeral: true });
        }
        if (interaction.commandName === 'painelticket') {
          if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Apenas Administradores podem publicar o painel.', ephemeral: true });
          try {
            const msg = await publishPanel(interaction.guild);
            return interaction.reply({ content: `✅ Painel de tickets publicado em ${msg.channel}.`, ephemeral: true });
          } catch (err) {
            return interaction.reply({ content: `⚠️ ${err.message}`, ephemeral: true });
          }
        }
        if (interaction.commandName === 'ticketdashboard') {
          const member = interaction.member || await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
          if (!hasStaffRole(member)) return interaction.reply({ content: '❌ Apenas a equipe pode visualizar o dashboard.', ephemeral: true });
          return interaction.reply({ embeds: [await dashboardEmbed(interaction.guild)], ephemeral: true });
        }
      }

      if (interaction.isButton() && interaction.customId === 'cda_main_tickets') {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Somente Administradores podem configurar.', ephemeral: true });
        return interaction.update({ embeds: [configEmbed()], components: configComponents(), content: null });
      }

      if (interaction.isButton() && interaction.customId === 'cda_ticket_cfg_back') {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        pendingTextChanges.delete(`${interaction.guildId}:${interaction.user.id}`);
        return interaction.update({ embeds: [configEmbed()], components: configComponents(), content: null });
      }
      if (interaction.isButton() && interaction.customId === 'cda_ticket_cfg_channels') {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        return interaction.update({ embeds: [configEmbed()], components: channelsComponents(), content: null });
      }
      if (interaction.isButton() && interaction.customId === 'cda_ticket_cfg_team_channel') {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        return interaction.update({
          embeds: [new EmbedBuilder().setColor(ORANGE).setTitle('🏢 Canal de anúncios de times').setDescription(
            `Canal atual: ${channelMention(runtimeConfig.teamAnnouncementsChannelId)}

A IA consulta as mensagens recentes deste canal quando alguém pergunta sobre assumir uma corporação/time.`
          )],
          components: teamAnnouncementsComponents(),
          content: null,
        });
      }
      if (interaction.isButton() && interaction.customId === 'cda_ticket_cfg_roles') {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        return interaction.update({ embeds: [configEmbed()], components: rolesComponents(), content: null });
      }
      if (interaction.isButton() && interaction.customId === 'cda_ticket_cfg_functions') {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        return interaction.update({ embeds: [functionsConfigEmbed()], components: functionsComponents(), content: null });
      }
      if (interaction.isButton() && interaction.customId === 'cda_ticket_cfg_emojis') {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        return interaction.update({ embeds: [emojiConfigEmbed()], components: emojiComponents(), content: null });
      }
      if (interaction.isButton() && interaction.customId === 'cda_ticket_cfg_func_create') {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        if (getFunctions().length >= 24) return interaction.reply({ content: '⚠️ O painel do Discord aceita no máximo 24 funções.', ephemeral: true });
        const modal = new ModalBuilder().setCustomId('cda_ticket_cfg_func_create_modal').setTitle('Criar nova função');
        modal.addComponents(
          one(new TextInputBuilder().setCustomId('label').setLabel('Nome da função').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(2).setMaxLength(80).setPlaceholder('Ex.: Comprar / Reembolso / Facções')),
          one(new TextInputBuilder().setCustomId('description').setLabel('Descrição').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(3).setMaxLength(100).setPlaceholder('Explique quando o usuário deve escolher esta função.')),
        );
        return interaction.showModal(modal);
      }
      if (interaction.isButton() && interaction.customId === 'cda_ticket_cfg_ai') {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        return interaction.update({ embeds: [configEmbed()], components: aiComponents(), content: null });
      }
      if (interaction.isButton() && interaction.customId === 'cda_ticket_cfg_prompt') {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        return interaction.update({ embeds: [knowledgeBaseEmbed()], components: knowledgeBaseComponents(), content: null });
      }
      if (interaction.isButton() && interaction.customId === 'cda_ticket_cfg_behavior') {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        return interaction.update({ embeds: [behaviorPromptEmbed()], components: behaviorPromptComponents(), content: null });
      }
      if (interaction.isButton() && interaction.customId === 'cda_ticket_cfg_base_replace') {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        return beginTextCapture(interaction, 'base_replace');
      }
      if (interaction.isButton() && interaction.customId === 'cda_ticket_cfg_base_append') {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        return beginTextCapture(interaction, 'base_append');
      }
      if (interaction.isButton() && interaction.customId === 'cda_ticket_cfg_base_reset') {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        saveKnowledgeBase(DEFAULT_KNOWLEDGE_BASE);
        return interaction.update({ embeds: [knowledgeBaseEmbed()], components: knowledgeBaseComponents(), content: '✅ Base oficial do CDA restaurada.' });
      }
      if (interaction.isButton() && interaction.customId === 'cda_ticket_cfg_behavior_replace') {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        return beginTextCapture(interaction, 'behavior_replace');
      }
      if (interaction.isButton() && interaction.customId === 'cda_ticket_cfg_behavior_reset') {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        saveBehaviorPrompt(DEFAULT_AI_BEHAVIOR);
        return interaction.update({ embeds: [behaviorPromptEmbed()], components: behaviorPromptComponents(), content: '✅ Prompt oficial do CDA restaurado.' });
      }
      if (interaction.isButton() && interaction.customId.startsWith('cda_ticket_text_finish:')) {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        const kind = interaction.customId.split(':')[1];
        const key = `${interaction.guildId}:${interaction.user.id}`;
        const pending = pendingTextChanges.get(key);
        if (!pending || pending.kind !== kind) return interaction.reply({ content: '⚠️ Não existe edição pendente ou ela expirou.', ephemeral: true });
        const text = pending.chunks.join('\n\n').trim();
        if (!text) return interaction.reply({ content: '⚠️ Envie pelo menos uma mensagem antes de finalizar.', ephemeral: true });
        pendingTextChanges.delete(key);
        if (kind === 'base_replace') saveKnowledgeBase(text);
        if (kind === 'base_append') saveKnowledgeBase(`${runtimeKnowledgeBase}

${text}`.slice(0, 50000));
        if (kind === 'behavior_replace') saveBehaviorPrompt(text);
        if (kind.startsWith('base_')) {
          return interaction.update({ embeds: [knowledgeBaseEmbed()], components: knowledgeBaseComponents(), content: '✅ Base da IA salva no storage do Discord.' });
        }
        return interaction.update({ embeds: [behaviorPromptEmbed()], components: behaviorPromptComponents(), content: '✅ Prompt da IA salvo no storage do Discord.' });
      }
      if (interaction.isButton() && interaction.customId.startsWith('cda_ticket_text_cancel:')) {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        const kind = interaction.customId.split(':')[1];
        const key = `${interaction.guildId}:${interaction.user.id}`;
        const pending = pendingTextChanges.get(key);
        if (pending?.kind === kind) pendingTextChanges.delete(key);
        if (kind.startsWith('base_')) return interaction.update({ embeds: [knowledgeBaseEmbed()], components: knowledgeBaseComponents(), content: '❌ Edição cancelada. Nada foi alterado.' });
        return interaction.update({ embeds: [behaviorPromptEmbed()], components: behaviorPromptComponents(), content: '❌ Edição cancelada. Nada foi alterado.' });
      }
      if (interaction.isButton() && interaction.customId === 'cda_ticket_cfg_team_channel_clear') {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        runtimeConfig.teamAnnouncementsChannelId = '';
        saveConfig(runtimeConfig);
        return interaction.update({
          embeds: [new EmbedBuilder().setColor(ORANGE).setTitle('🏢 Canal de anúncios de times').setDescription('Canal removido. A IA não confirmará vagas de times até um novo canal ser configurado.')],
          components: teamAnnouncementsComponents(),
          content: null,
        });
      }
      if (interaction.isButton() && interaction.customId.startsWith('cda_ticket_cfg_func_category_default:')) {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        const id = interaction.customId.split(':')[1];
        const funcs = getFunctions();
        const idx = funcs.findIndex(f => f.id === id);
        if (idx >= 0) funcs[idx].categoryId = '';
        runtimeConfig.ticketFunctions = funcs;
        saveConfig(runtimeConfig);
        return interaction.update({ embeds: [functionsConfigEmbed()], components: functionsComponents(), content: '✅ Esta função agora usa a categoria padrão.' });
      }

      if (interaction.isButton() && interaction.customId === 'cda_ticket_cfg_publish') {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        try {
          const msg = await publishPanel(interaction.guild);
          return interaction.reply({ content: `✅ Painel publicado em ${msg.channel}.`, ephemeral: true });
        } catch (err) {
          return interaction.reply({ content: `⚠️ ${err.message}`, ephemeral: true });
        }
      }

      if (interaction.isChannelSelectMenu() && interaction.customId.startsWith('cda_ticket_cfg_func_category:')) {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        const id = interaction.customId.split(':')[1];
        const funcs = getFunctions();
        const idx = funcs.findIndex(f => f.id === id);
        if (idx < 0) return interaction.reply({ content: '❌ Função não encontrada.', ephemeral: true });
        funcs[idx].categoryId = interaction.values[0];
        runtimeConfig.ticketFunctions = funcs;
        saveConfig(runtimeConfig);
        return interaction.update({ embeds: [functionsConfigEmbed()], components: functionsComponents(), content: `✅ Categoria de **${funcs[idx].label}** atualizada.` });
      }

      if (interaction.isChannelSelectMenu() && interaction.customId === 'cda_ticket_cfg_team_announcements_channel') {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        runtimeConfig.teamAnnouncementsChannelId = interaction.values[0];
        saveConfig(runtimeConfig);
        return interaction.update({
          embeds: [new EmbedBuilder().setColor(ORANGE).setTitle('🏢 Canal de anúncios de times').setDescription(
            `✅ Canal configurado: ${channelMention(runtimeConfig.teamAnnouncementsChannelId)}

A IA vai consultar as **50 mensagens mais recentes** desse canal quando alguém pedir para assumir uma corporação/time.`
          )],
          components: teamAnnouncementsComponents(),
          content: null,
        });
      }

      if (interaction.isChannelSelectMenu() && interaction.customId.startsWith('cda_ticket_cfg_')) {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        const id = interaction.values[0];
        if (interaction.customId === 'cda_ticket_cfg_panel_channel') runtimeConfig.panelChannelId = id;
        if (interaction.customId === 'cda_ticket_cfg_category') runtimeConfig.categoryId = id;
        if (interaction.customId === 'cda_ticket_cfg_log_channel') runtimeConfig.logChannelId = id;
        saveConfig(runtimeConfig);
        return interaction.update({ embeds: [configEmbed()], components: channelsComponents(), content: null });
      }

      if (interaction.isRoleSelectMenu() && interaction.customId === 'cda_ticket_cfg_staff_roles') {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        runtimeConfig.staffRoleIds = interaction.values;
        saveConfig(runtimeConfig);
        return interaction.update({ embeds: [configEmbed()], components: rolesComponents(), content: null });
      }
      if (interaction.isRoleSelectMenu() && interaction.customId === 'cda_ticket_cfg_vip_roles') {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        runtimeConfig.vipRoleIds = interaction.values;
        saveConfig(runtimeConfig);
        return interaction.update({ embeds: [configEmbed()], components: rolesComponents(), content: '✅ Cargos VIP atualizados. Tickets normais não geram ping; usuários com esses cargos geram ping VIP.' });
      }

      if (interaction.isStringSelectMenu() && interaction.customId === 'cda_ticket_cfg_func_enabled') {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        const selected = new Set(interaction.values);
        runtimeConfig.ticketFunctions = getFunctions().map(f => ({ ...f, enabled: selected.has(f.id) }));
        saveConfig(runtimeConfig);
        return interaction.update({ embeds: [functionsConfigEmbed()], components: functionsComponents(), content: '✅ Funções visíveis atualizadas.' });
      }
      if (interaction.isStringSelectMenu() && interaction.customId === 'cda_ticket_cfg_func_category_pick') {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        const id = interaction.values[0];
        const f = getFunction(id);
        return interaction.update({ embeds: [functionsConfigEmbed()], components: functionCategoryComponents(id), content: `📁 Escolha a categoria que receberá os tickets de **${f.label}**.` });
      }
      if (interaction.isStringSelectMenu() && interaction.customId === 'cda_ticket_cfg_emoji_function') {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        const f = getFunction(interaction.values[0]);
        return beginEmojiChange(interaction, { kind: 'function', id: f.id, label: `função ${f.label}` });
      }
      if (interaction.isStringSelectMenu() && interaction.customId === 'cda_ticket_cfg_emoji_action') {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        const key = interaction.values[0];
        return beginEmojiChange(interaction, { kind: 'action', key, label: emojiTargetLabel(key) });
      }

      if (interaction.isStringSelectMenu() && interaction.customId === 'cda_ticket_cfg_ai_mode') {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        runtimeConfig.aiMode = interaction.values[0];
        saveConfig(runtimeConfig);
        return interaction.update({ embeds: [configEmbed()], components: aiComponents(), content: null });
      }
      if (interaction.isStringSelectMenu() && interaction.customId === 'cda_ticket_cfg_ai_provider') {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        runtimeConfig.aiProvider = interaction.values[0];
        saveConfig(runtimeConfig);
        return interaction.update({ embeds: [configEmbed()], components: aiComponents(), content: null });
      }

      if (interaction.isModalSubmit() && interaction.customId === 'cda_ticket_cfg_func_create_modal') {
        if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        const label = interaction.fields.getTextInputValue('label').trim();
        const description = interaction.fields.getTextInputValue('description').trim();
        const funcs = getFunctions();
        if (funcs.length >= 24) return interaction.reply({ content: '⚠️ Limite de 24 funções atingido.', ephemeral: true });
        const id = makeFunctionId(label);
        funcs.push({ id, emoji: '🎫', label: label.slice(0, 80), description: description.slice(0, 100), categoryId: '', enabled: true, system: false });
        runtimeConfig.ticketFunctions = funcs;
        saveConfig(runtimeConfig);
        return interaction.reply({ content: `✅ Função **${label}** criada. Ela já aparece no painel. Use **Selecionar Funções → Categoria** para escolher a categoria e **Emojis** para trocar o 🎫 mandando o emoji no chat.`, ephemeral: true });
      }

      // Fluxo de abertura
      if (interaction.isStringSelectMenu() && interaction.customId === 'cda_ticket_open') {
        const type = interaction.values[0];
        const def = getFunction(type);
        const modal = new ModalBuilder().setCustomId(`cda_ticket_open_modal:${type}`).setTitle(`Abrir ticket • ${def.label}`);
        modal.addComponents(
          one(new TextInputBuilder().setCustomId('subject').setLabel('Assunto').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setPlaceholder('Resuma o motivo do ticket')),
          one(new TextInputBuilder().setCustomId('description').setLabel('Explique o que aconteceu').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(10).setMaxLength(1500).setPlaceholder('Quanto mais claro, melhor para a equipe te ajudar.')),
        );
        return interaction.showModal(modal);
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('cda_ticket_open_modal:')) {
        const type = interaction.customId.split(':')[1] || 'outros';
        const subject = interaction.fields.getTextInputValue('subject');
        const description = interaction.fields.getTextInputValue('description');
        return createTicket(interaction, type, subject, description);
      }

      // Daqui pra frente, precisa estar dentro de um ticket
      const meta = parseTopic(interaction.channel);
      if (!meta) return;
      const staff = hasStaffRole(interaction.member);

      if (interaction.isButton() && interaction.customId === 'cda_ticket_claim') {
        if (!staff) return interaction.reply({ content: '❌ Apenas a equipe configurada pode assumir tickets.', ephemeral: true });
        if (meta.claimedBy) return interaction.reply({ content: `⚠️ Este ticket já foi assumido por <@${meta.claimedBy}>.`, ephemeral: true });
        const next = await updateTopic(interaction.channel, { claimedBy: interaction.user.id });
        recordClaim(meta, interaction.user.id);
        await sendOrganizedLog(client, `🙋 Ticket assumido — ${ticketCode(meta.id)}`, [{ name: 'Atendente', value: `<@${interaction.user.id}>`, inline: true }, { name: 'Usuário', value: `<@${meta.ownerId}>`, inline: true }]).catch(() => {});
        const first = interaction.message.embeds?.[0];
        const embed = first ? EmbedBuilder.from(first) : ticketWelcomeEmbed(next, 'Atendimento', '');
        const fields = embed.data.fields || [];
        const idx = fields.findIndex(f => String(f.name || '').endsWith(' Responsável'));
        if (idx >= 0) fields[idx].value = `<@${interaction.user.id}>`;
        embed.setFields(fields);
        await interaction.update({ embeds: [embed], components: ticketActionRows(next) });
        return interaction.channel.send(`🙋 <@${interaction.user.id}> assumiu o atendimento.`);
      }

      if (interaction.isButton() && interaction.customId === 'cda_ticket_staff_panel') {
        if (!staff) return interaction.reply({ content: '❌ Apenas a equipe pode abrir o Painel Staff.', ephemeral: true });
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(ORANGE).setTitle('🛠️ Painel Staff').setDescription('Ferramentas internas deste atendimento.')],
          components: staffPanelRows(),
          ephemeral: true,
        });
      }

      if (interaction.isStringSelectMenu() && interaction.customId === 'cda_ticket_staff_routebar') {
        if (!staff) return interaction.reply({ content: '❌ Apenas a equipe pode usar o Painel Staff.', ephemeral: true });
        return openStaffRouteAction(interaction, interaction.values[0], meta, staff, client);
      }

      if (interaction.isUserSelectMenu() && interaction.customId === 'cda_ticket_setrole_user') {
        if (!staff) return interaction.reply({ content: '❌ Apenas a equipe pode setar cargos.', ephemeral: true });
        const targetId = interaction.values[0];
        const target = await interaction.guild.members.fetch(targetId).catch(() => null);
        if (!target) return interaction.update({ content: '❌ Não consegui localizar esse membro.', components: [] });
        if (target.id === client.user.id) return interaction.update({ content: '❌ O bot não pode receber cargos por essa função.', components: [] });
        return interaction.update({
          content: `Membro selecionado: <@${targetId}>
Agora escolha o cargo. **Cargos da Staff, administrativos e cargos acima de você ficam bloqueados.**`,
          components: [one(new RoleSelectMenuBuilder().setCustomId(`cda_ticket_setrole_role:${targetId}`).setPlaceholder('Selecionar cargo').setMinValues(1).setMaxValues(1))],
          allowedMentions: { users: [targetId] },
        });
      }

      if (interaction.isRoleSelectMenu() && interaction.customId.startsWith('cda_ticket_setrole_role:')) {
        if (!staff) return interaction.reply({ content: '❌ Apenas a equipe pode setar cargos.', ephemeral: true });
        const targetId = interaction.customId.split(':')[1];
        const roleId = interaction.values[0];
        const actor = interaction.member || await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        const target = await interaction.guild.members.fetch(targetId).catch(() => null);
        const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
        const validation = validateSetRole(actor, target, role, interaction.guild);
        if (validation) return interaction.update({ content: `❌ ${validation}`, components: [] });
        if (target.roles.cache.has(role.id)) return interaction.update({ content: `⚠️ <@${targetId}> já possui o cargo <@&${roleId}>.`, components: [], allowedMentions: { users: [], roles: [] } });

        const key = `${interaction.guildId}:${interaction.user.id}`;
        pendingRoleProofs.set(key, {
          targetId, roleId, channelId: interaction.channelId,
          ticketCode: ticketCode(meta.id), expiresAt: Date.now() + 2 * 60_000,
        });
        return interaction.update({
          content: `📎 **Envie agora a prova do cargo como uma mensagem normal neste ticket.**

Membro: <@${targetId}>
Cargo: <@&${roleId}>

Pode enviar **texto, print/imagem ou arquivo**. O cargo só será aplicado depois da prova. Você tem **2 minutos**.`,
          components: [],
          allowedMentions: { users: [], roles: [] },
        });
      }

      if (interaction.isModalSubmit() && interaction.customId === 'cda_ticket_rename_modal') {
        if (!staff) return interaction.reply({ content: '❌ Apenas a equipe pode renomear tickets.', ephemeral: true });
        const requested = interaction.fields.getTextInputValue('name');
        const clean = sanitizeName(requested).slice(0, 70);
        if (!clean) return interaction.reply({ content: '❌ Nome inválido.', ephemeral: true });
        const nextName = `ticket-${String(meta.id).padStart(4, '0')}-${clean}`.slice(0, 100);
        const oldName = interaction.channel.name;
        await interaction.channel.setName(nextName, `Ticket renomeado por ${interaction.user.tag}`);
        await sendOrganizedLog(client, `✏️ Ticket renomeado — ${ticketCode(meta.id)}`, [
          { name: 'Staff', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Antes', value: `\`${oldName}\``, inline: false },
          { name: 'Depois', value: `\`${nextName}\``, inline: false },
        ]).catch(() => {});
        return interaction.reply({ content: `✅ Ticket renomeado para **${nextName}**.`, ephemeral: true });
      }

      if (interaction.isButton() && interaction.customId === 'cda_ticket_member_panel') {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ViewChannel)) return interaction.reply({ content: '❌ Sem acesso a este ticket.', ephemeral: true });
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(ORANGE).setTitle('👤 Painel Membro').setDescription('Solicite alterações de participantes ou notifique o staff responsável. Adições e remoções precisam de aprovação do responsável.')],
          components: memberPanelRows(),
          ephemeral: true,
        });
      }

      if (interaction.isButton() && interaction.customId === 'cda_ticket_transfer') {
        if (!staff) return interaction.reply({ content: '❌ Apenas a equipe pode transferir tickets.', ephemeral: true });
        return interaction.reply({ content: 'Selecione o membro da equipe que receberá este ticket:', components: [one(new UserSelectMenuBuilder().setCustomId('cda_ticket_transfer_user').setPlaceholder('Selecionar staff').setMinValues(1).setMaxValues(1))], ephemeral: true });
      }

      if (interaction.isUserSelectMenu() && interaction.customId === 'cda_ticket_transfer_user') {
        if (!staff) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        const targetId = interaction.values[0];
        const target = await interaction.guild.members.fetch(targetId).catch(() => null);
        if (!hasStaffRole(target)) return interaction.update({ content: '❌ O usuário selecionado não possui um cargo configurado como equipe de tickets.', components: [] });
        const modal = new ModalBuilder().setCustomId(`cda_ticket_transfer_reason:${targetId}`).setTitle('Transferir atendimento');
        modal.addComponents(one(new TextInputBuilder().setCustomId('reason').setLabel('Motivo da transferência').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(3).setMaxLength(500).setPlaceholder('Explique por que o atendimento será transferido.')));
        return interaction.showModal(modal);
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('cda_ticket_transfer_reason:')) {
        if (!staff) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        const targetId = interaction.customId.split(':')[1];
        const target = await interaction.guild.members.fetch(targetId).catch(() => null);
        if (!hasStaffRole(target)) return interaction.reply({ content: '❌ O destino não é mais um staff válido.', ephemeral: true });
        const reason = interaction.fields.getTextInputValue('reason');
        const oldResponsible = meta.claimedBy || interaction.user.id;
        await updateTopic(interaction.channel, { claimedBy: targetId });
        await interaction.channel.permissionOverwrites.edit(targetId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
        recordTransfer(meta, oldResponsible, targetId, reason);
        await sendOrganizedLog(client, `🔁 Transferência — ${ticketCode(meta.id)}`, [
          { name: 'De', value: `<@${oldResponsible}>`, inline: true }, { name: 'Para', value: `<@${targetId}>`, inline: true }, { name: 'Motivo', value: reason, inline: false }
        ]).catch(() => {});
        await interaction.reply({ content: `✅ Ticket transferido para <@${targetId}>.`, ephemeral: true });
        return interaction.channel.send({ embeds: [new EmbedBuilder().setColor(ORANGE).setTitle('🔁 Atendimento transferido').setDescription(`Novo responsável: <@${targetId}>\n**Motivo:** ${reason}`)], allowedMentions: { users: [targetId] } });
      }

      if (interaction.isButton() && interaction.customId === 'cda_ticket_notify_user') {
        if (!staff) return interaction.reply({ content: '❌ Apenas a equipe pode notificar o usuário.', ephemeral: true });
        const modal = new ModalBuilder().setCustomId('cda_ticket_notify_user_modal').setTitle('Notificar usuário');
        modal.addComponents(one(new TextInputBuilder().setCustomId('message').setLabel('Mensagem da notificação').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(2).setMaxLength(1000).setPlaceholder('Mensagem que será enviada no privado do usuário.')));
        return interaction.showModal(modal);
      }

      if (interaction.isModalSubmit() && interaction.customId === 'cda_ticket_notify_user_modal') {
        if (!staff) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        const text = interaction.fields.getTextInputValue('message');
        const user = await client.users.fetch(meta.ownerId).catch(() => null);
        if (!user) return interaction.reply({ content: '❌ Não consegui localizar o usuário.', ephemeral: true });
        const ok = await user.send({ embeds: [new EmbedBuilder().setColor(ORANGE).setTitle(`📨 Notificação — ${ticketCode(meta.id)}`).setDescription(text).setFooter({ text: 'Cidade Alta [RP] © 2026 • Todos os direitos reservados.' })] }).then(()=>true).catch(()=>false);
        await sendOrganizedLog(client, `📨 Usuário notificado — ${ticketCode(meta.id)}`, [{ name: 'Staff', value: `<@${interaction.user.id}>`, inline: true }, { name: 'Usuário', value: `<@${meta.ownerId}>`, inline: true }, { name: 'Mensagem', value: text, inline: false }]).catch(() => {});
        return interaction.reply({ content: ok ? '✅ Usuário notificado no privado.' : '⚠️ Não consegui enviar DM; o usuário pode estar com o privado fechado.', ephemeral: true });
      }

      if (interaction.isButton() && interaction.customId === 'cda_ticket_notify_staff') {
        const key = `${interaction.channelId}:${interaction.user.id}`;
        const last = memberNotifyCooldown.get(key) || 0;
        if (Date.now() - last < 5 * 60_000) return interaction.reply({ content: '⏳ Você já notificou o responsável recentemente. Aguarde alguns minutos.', ephemeral: true });
        if (!meta.claimedBy) return interaction.reply({ content: '⚠️ Este ticket ainda não possui um staff responsável. Aguarde alguém assumir.', ephemeral: true });
        memberNotifyCooldown.set(key, Date.now());
        await interaction.channel.send({ content: `<@${meta.claimedBy}> 🔔 **${interaction.user} solicitou sua atenção neste ticket.**`, allowedMentions: { users: [meta.claimedBy] } });
        await sendOrganizedLog(client, `🔔 Staff responsável notificado — ${ticketCode(meta.id)}`, [{ name: 'Solicitado por', value: `<@${interaction.user.id}>`, inline: true }, { name: 'Responsável', value: `<@${meta.claimedBy}>`, inline: true }]).catch(() => {});
        return interaction.reply({ content: '✅ Staff responsável notificado.', ephemeral: true });
      }

      if (interaction.isButton() && interaction.customId === 'cda_ticket_escalate') {
        if (!staff) return interaction.reply({ content: '❌ Apenas a equipe pode escalonar atendimentos.', ephemeral: true });
        const modal = new ModalBuilder().setCustomId('cda_ticket_escalate_modal').setTitle('Escalonar atendimento');
        modal.addComponents(one(new TextInputBuilder().setCustomId('reason').setLabel('Motivo do escalonamento').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(3).setMaxLength(500).setPlaceholder('Por que este caso precisa de uma hierarquia superior?')));
        return interaction.showModal(modal);
      }

      if (interaction.isModalSubmit() && interaction.customId === 'cda_ticket_escalate_modal') {
        if (!staff) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        const reason = interaction.fields.getTextInputValue('reason');
        const role = findEscalationRole(interaction.member, interaction.guild);
        updateTicketRuntime(interaction.channelId, { escalatedAt: Date.now(), escalationReason: reason });
        await interaction.reply({ content: '✅ Atendimento escalonado.', ephemeral: true });
        await interaction.channel.send({ content: `${role ? `<@&${role.id}> ` : ''}⬆️ **Atendimento escalonado** por <@${interaction.user.id}>.\n**Motivo:** ${reason}`, allowedMentions: { roles: role ? [role.id] : [], users: [interaction.user.id] } });
        return sendOrganizedLog(client, `⬆️ Atendimento escalonado — ${ticketCode(meta.id)}`, [{ name: 'Staff', value: `<@${interaction.user.id}>`, inline: true }, { name: 'Destino', value: role ? `<@&${role.id}>` : 'Hierarquia não configurada', inline: true }, { name: 'Motivo', value: reason, inline: false }]).catch(() => {});
      }

      if (interaction.isButton() && interaction.customId === 'cda_ticket_priority') {
        if (!staff) return interaction.reply({ content: '❌ Apenas a equipe pode alterar a prioridade.', ephemeral: true });
        const current = getTicketRuntime(interaction.channelId).priority || 'normal';
        return interaction.reply({ content: `Prioridade atual: **${current === 'vip' ? 'VIP' : 'Normal'}**`, components: [one(new StringSelectMenuBuilder().setCustomId('cda_ticket_priority_select').setPlaceholder('Alterar prioridade').addOptions(
          new StringSelectMenuOptionBuilder().setLabel('Normal').setValue('normal').setEmoji('🎫').setDefault(current === 'normal'),
          new StringSelectMenuOptionBuilder().setLabel('VIP').setValue('vip').setEmoji('💎').setDefault(current === 'vip')
        ))], ephemeral: true });
      }

      if (interaction.isStringSelectMenu() && interaction.customId === 'cda_ticket_priority_select') {
        if (!staff) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        const value = interaction.values[0] === 'vip' ? 'vip' : 'normal';
        const old = getTicketRuntime(interaction.channelId).priority || 'normal';
        updateTicketRuntime(interaction.channelId, { priority: value });
        if (value === 'vip' && old !== 'vip') {
          const roles = runtimeConfig.staffRoleIds || [];
          const ping = roles.map(id => `<@&${id}>`).join(' ');
          if (ping) await interaction.channel.send({ content: `${ping} 💎 **${ticketCode(meta.id)} foi marcado como prioridade VIP.**`, allowedMentions: { roles } }).catch(() => {});
        }
        await sendOrganizedLog(client, `${value === 'vip' ? '💎' : '🎫'} Prioridade alterada — ${ticketCode(meta.id)}`, [{ name: 'Alterado por', value: `<@${interaction.user.id}>`, inline: true }, { name: 'Prioridade', value: value === 'vip' ? 'VIP' : 'Normal', inline: true }]).catch(() => {});
        return interaction.update({ content: `✅ Prioridade alterada para **${value === 'vip' ? 'VIP' : 'Normal'}**.${value === 'normal' ? ' Nenhum ping de staff é enviado para prioridade normal.' : ''}`, components: [] });
      }

      if (interaction.isButton() && interaction.customId === 'cda_ticket_wait') {
        if (!staff) return interaction.reply({ content: '❌ Apenas a equipe pode colocar o atendimento em espera.', ephemeral: true });
        const modal = new ModalBuilder().setCustomId('cda_ticket_wait_modal').setTitle('Motivo de espera');
        modal.addComponents(one(new TextInputBuilder().setCustomId('reason').setLabel('Por que o ticket está aguardando?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(3).setMaxLength(500).setPlaceholder('Ex.: aguardando resposta do usuário / comprovante / análise.')));
        return interaction.showModal(modal);
      }

      if (interaction.isModalSubmit() && interaction.customId === 'cda_ticket_wait_modal') {
        if (!staff) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        const reason = interaction.fields.getTextInputValue('reason');
        updateTicketRuntime(interaction.channelId, { waitReason: reason, waitSince: Date.now(), reminderSent: false });
        await interaction.reply({ content: `✅ Ticket colocado em espera. Se o usuário não responder, o lembrete automático será enviado em cerca de **${Math.round(WAIT_REMINDER_MS/60000)} minutos**.`, ephemeral: true });
        await interaction.channel.send({ embeds: [new EmbedBuilder().setColor(ORANGE).setTitle('⏳ Atendimento em espera').setDescription(`**Motivo:** ${reason}\n\nO bot lembrará o usuário automaticamente caso não haja retorno.`)] });
        return sendOrganizedLog(client, `⏳ Ticket em espera — ${ticketCode(meta.id)}`, [{ name: 'Staff', value: `<@${interaction.user.id}>`, inline: true }, { name: 'Motivo', value: reason, inline: false }]).catch(() => {});
      }

      if (interaction.isButton() && interaction.customId === 'cda_ticket_history') {
        if (!staff) return interaction.reply({ content: '❌ Apenas a equipe pode ver o histórico.', ephemeral: true });
        return interaction.reply({ embeds: [userHistoryEmbed(meta.ownerId)], ephemeral: true });
      }

      if (interaction.isButton() && interaction.customId === 'cda_ticket_add') {
        return interaction.reply({ content: 'Selecione quem deseja solicitar para adicionar ao ticket:', components: [one(new UserSelectMenuBuilder().setCustomId('cda_ticket_add_user').setPlaceholder('Selecionar usuário').setMinValues(1).setMaxValues(1))], ephemeral: true });
      }

      if (interaction.isUserSelectMenu() && interaction.customId === 'cda_ticket_add_user') {
        const targetId = interaction.values[0];
        if (targetId === client.user.id) return interaction.update({ content: '⚠️ O bot já faz parte do ticket.', components: [] });
        const resp = meta.claimedBy ? `<@${meta.claimedBy}>` : (runtimeConfig.staffRoleIds || []).map(id => `<@&${id}>`).join(' ');
        const request = await interaction.channel.send({
          content: resp || undefined,
          embeds: [new EmbedBuilder().setColor(ORANGE).setTitle('➕ Solicitação de adicionar membro').setDescription(`Solicitado por <@${interaction.user.id}>\nUsuário: <@${targetId}>\n\nO staff responsável precisa aprovar.`)],
          components: [one(
            new ButtonBuilder().setCustomId(`cda_ticket_memberreq:add:${targetId}:${interaction.user.id}`).setLabel('Aprovar').setEmoji('✅').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`cda_ticket_memberreq_reject:add:${targetId}:${interaction.user.id}`).setLabel('Recusar').setEmoji('❌').setStyle(ButtonStyle.Danger)
          )],
          allowedMentions: meta.claimedBy ? { users: [meta.claimedBy] } : { roles: runtimeConfig.staffRoleIds || [] },
        });
        await sendOrganizedLog(client, `➕ Solicitação de membro — ${ticketCode(meta.id)}`, [{ name: 'Solicitante', value: `<@${interaction.user.id}>`, inline: true }, { name: 'Adicionar', value: `<@${targetId}>`, inline: true }]).catch(() => {});
        return interaction.update({ content: `✅ Pedido criado: ${request}`, components: [] });
      }

      if (interaction.isButton() && interaction.customId === 'cda_ticket_remove') {
        return interaction.reply({ content: 'Selecione quem deseja solicitar para remover do ticket:', components: [one(new UserSelectMenuBuilder().setCustomId('cda_ticket_remove_user').setPlaceholder('Selecionar usuário').setMinValues(1).setMaxValues(1))], ephemeral: true });
      }

      if (interaction.isUserSelectMenu() && interaction.customId === 'cda_ticket_remove_user') {
        const targetId = interaction.values[0];
        if (targetId === meta.ownerId) return interaction.update({ content: '⚠️ O autor principal não pode ser removido do próprio ticket.', components: [] });
        if (targetId === client.user.id) return interaction.update({ content: '⚠️ O bot não pode ser removido.', components: [] });
        const resp = meta.claimedBy ? `<@${meta.claimedBy}>` : (runtimeConfig.staffRoleIds || []).map(id => `<@&${id}>`).join(' ');
        const request = await interaction.channel.send({
          content: resp || undefined,
          embeds: [new EmbedBuilder().setColor(ORANGE).setTitle('➖ Solicitação de remover membro').setDescription(`Solicitado por <@${interaction.user.id}>\nUsuário: <@${targetId}>\n\nO staff responsável precisa aprovar.`)],
          components: [one(
            new ButtonBuilder().setCustomId(`cda_ticket_memberreq:remove:${targetId}:${interaction.user.id}`).setLabel('Aprovar').setEmoji('✅').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`cda_ticket_memberreq_reject:remove:${targetId}:${interaction.user.id}`).setLabel('Recusar').setEmoji('❌').setStyle(ButtonStyle.Danger)
          )],
          allowedMentions: meta.claimedBy ? { users: [meta.claimedBy] } : { roles: runtimeConfig.staffRoleIds || [] },
        });
        await sendOrganizedLog(client, `➖ Solicitação de membro — ${ticketCode(meta.id)}`, [{ name: 'Solicitante', value: `<@${interaction.user.id}>`, inline: true }, { name: 'Remover', value: `<@${targetId}>`, inline: true }]).catch(() => {});
        return interaction.update({ content: `✅ Pedido criado: ${request}`, components: [] });
      }

      if (interaction.isButton() && (interaction.customId.startsWith('cda_ticket_memberreq:') || interaction.customId.startsWith('cda_ticket_memberreq_reject:'))) {
        const reject = interaction.customId.startsWith('cda_ticket_memberreq_reject:');
        const parts = interaction.customId.split(':');
        const action = parts[1], targetId = parts[2], requesterId = parts[3];
        if (meta.claimedBy) {
          if (interaction.user.id !== meta.claimedBy) return interaction.reply({ content: `❌ Somente o staff responsável <@${meta.claimedBy}> pode decidir este pedido.`, ephemeral: true });
        } else if (!staff) return interaction.reply({ content: '❌ Apenas a equipe pode decidir este pedido.', ephemeral: true });
        if (!reject) {
          if (action === 'add') await interaction.channel.permissionOverwrites.edit(targetId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true, EmbedLinks: true });
          if (action === 'remove') await interaction.channel.permissionOverwrites.delete(targetId).catch(() => {});
        }
        const verb = action === 'add' ? 'adição' : 'remoção';
        const status = reject ? 'RECUSADA' : 'APROVADA';
        const embed = interaction.message.embeds?.[0] ? EmbedBuilder.from(interaction.message.embeds[0]) : new EmbedBuilder().setColor(ORANGE);
        embed.setTitle(`${reject ? '❌' : '✅'} Solicitação ${status}`).setFooter({ text: `Decidido por ${interaction.user.username}` });
        await interaction.update({ embeds: [embed], components: [], content: null });
        await interaction.channel.send({ content: `${reject ? '❌' : '✅'} Solicitação de **${verb}** de <@${targetId}> foi **${status.toLowerCase()}** por <@${interaction.user.id}>.`, allowedMentions: { users: [targetId, requesterId] } });
        return sendOrganizedLog(client, `${reject ? '❌' : '✅'} Solicitação ${status} — ${ticketCode(meta.id)}`, [{ name: 'Ação', value: verb, inline: true }, { name: 'Usuário', value: `<@${targetId}>`, inline: true }, { name: 'Decidido por', value: `<@${interaction.user.id}>`, inline: true }]).catch(() => {});
      }

      if (interaction.isButton() && interaction.customId === 'cda_ticket_ai_suggest') {
        if (!staff) return interaction.reply({ content: '❌ Apenas a equipe pode usar o assistente de IA.', ephemeral: true });
        if (runtimeConfig.aiMode === 'disabled') return interaction.reply({ content: '⚠️ A IA está desativada em `/ticketconfig`.', ephemeral: true });
        if (!selectProvider()) return interaction.reply({ content: '⚠️ Configure `GEMINI_API_KEY` ou `GROQ_API_KEY` nas variáveis da Discloud.', ephemeral: true });
        await interaction.deferReply({ ephemeral: true });
        try {
          const answer = await generateAI(interaction.channel, 'Com base na conversa, escreva uma sugestão curta de resposta que um atendente humano possa enviar agora. Não diga que você é uma IA.');
          return interaction.editReply({ embeds: [new EmbedBuilder().setColor(ORANGE).setTitle('✨ Sugestão da IA').setDescription(answer)] });
        } catch (err) {
          console.error('❌ Sugestão IA:', err.message);
          return interaction.editReply('⚠️ A IA está temporariamente indisponível. O erro técnico foi registrado no console e outro atendente pode continuar o atendimento.');
        }
      }

      if (interaction.isButton() && interaction.customId === 'cda_ticket_ai_summary') {
        if (!staff) return interaction.reply({ content: '❌ Apenas a equipe pode resumir tickets.', ephemeral: true });
        if (runtimeConfig.aiMode === 'disabled') return interaction.reply({ content: '⚠️ A IA está desativada em `/ticketconfig`.', ephemeral: true });
        if (!selectProvider()) return interaction.reply({ content: '⚠️ Configure `GEMINI_API_KEY` ou `GROQ_API_KEY` nas variáveis da Discloud.', ephemeral: true });
        await interaction.deferReply({ ephemeral: true });
        try {
          const answer = await generateAI(interaction.channel, 'Resuma este ticket para a staff em no máximo 8 linhas. Use: Motivo, O que aconteceu, O que já foi tentado, Pendência e Próxima ação. Se algo não estiver claro, escreva “não informado”.');
          return interaction.editReply({ embeds: [new EmbedBuilder().setColor(ORANGE).setTitle(`📋 Resumo — ${ticketCode(meta.id)}`).setDescription(answer)] });
        } catch (err) {
          console.error('❌ Resumo IA:', err.message);
          return interaction.editReply('⚠️ A IA está temporariamente indisponível. O erro técnico foi registrado no console e outro atendente pode continuar o atendimento.');
        }
      }

      if (interaction.isButton() && interaction.customId === 'cda_ticket_close') {
        if (!staff && interaction.user.id !== meta.ownerId) return interaction.reply({ content: '❌ Você não pode encerrar este ticket.', ephemeral: true });
        const modal = new ModalBuilder().setCustomId('cda_ticket_close_modal').setTitle(`Encerrar ${ticketCode(meta.id)}`);
        modal.addComponents(one(new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Motivo do encerramento')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMinLength(3)
          .setMaxLength(500)
          .setPlaceholder('Ex.: Dúvida resolvida / atendimento concluído.')));
        return interaction.showModal(modal);
      }

      if (interaction.isModalSubmit() && interaction.customId === 'cda_ticket_close_modal') {
        if (!staff && interaction.user.id !== meta.ownerId) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
        const reason = interaction.fields.getTextInputValue('reason');
        await interaction.deferReply({ ephemeral: true });
        const messages = await fetchTranscriptMessages(interaction.channel).catch(() => []);
        let autoSummary = '';
        if (selectProvider()) {
          try { autoSummary = await generateAI(interaction.channel, 'Gere um resumo final do atendimento em até 6 linhas: motivo, ação tomada, resultado e qualquer pendência. Não invente informações.'); }
          catch (err) { console.warn('⚠️ Resumo automático no fechamento:', err.message); }
        }
        recordClosed(meta, interaction.user.id, reason, autoSummary);
        await sendCloseLog(client, interaction.channel, meta, interaction.user.id, reason, messages, autoSummary).catch(err => console.error('⚠️ Transcript/log:', err.message));
        await sendRatingDM(client, meta).catch(() => {});
        delete ticketRuntimeData[String(interaction.channelId)]; scheduleRuntimeSave();
        await interaction.editReply(`✅ Ticket encerrado. Transcript, logs${autoSummary ? ' e resumo automático' : ''} enviados. A avaliação foi enviada por DM quando possível.`);
        await interaction.channel.delete(`Ticket ${ticketCode(meta.id)} encerrado por ${interaction.user.tag}: ${reason}`).catch(err => console.error('⚠️ Excluir ticket:', err.message));
      }
    } catch (err) {
      console.error('❌ Tickets interaction:', err);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        try { await interaction.reply({ content: '❌ Ocorreu um erro no sistema de tickets.', ephemeral: true }); } catch {}
      }
    }
  });
}

module.exports = {
  setupTickets,
  initTicketsPersistentConfig,
};
