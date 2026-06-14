'use strict';

// ╔══════════════════════════════════════════════════════════════╗
// ║              ZENITSU MINI — main.js (CommonJS)              ║
// ║         Connexion par pair code · Baileys · Termux          ║
// ╚══════════════════════════════════════════════════════════════╝

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  isJidBroadcast,
  isJidGroup,
  proto,
  getContentType,
} = require('@whiskeysockets/baileys');

const { Boom }   = require('@hapi/boom');
const pino       = require('pino');
const fs         = require('fs');
const path       = require('path');
const readline   = require('readline');

// ──────────────────────────────────────────────
//  CONFIG
// ──────────────────────────────────────────────
const CONFIG = {
  ownerNumber : '50935948231',          // numéro pour le pair code
  prefix      : '.',                    // préfixe des commandes
  sessionDir  : './session',            // dossier de session
  commandsDir : './commands',           // dossier des commandes
  eventsDir   : './events',             // dossier des events
  maxRetries  : 5,                      // reconnexions max
  keepAliveMs : 5 * 60 * 1000,         // keepalive toutes les 5 min (ms)
  botName     : 'Firefox',
};

// ──────────────────────────────────────────────
//  STATS GLOBALES
// ──────────────────────────────────────────────
const stats = {
  startTime      : Date.now(),
  messagesTotal  : 0,
  commandsUsed   : 0,
  eventsHandled  : 0,
  reconnections  : 0,
};

// ──────────────────────────────────────────────
//  LOGGER minimal (pino quiet)
// ──────────────────────────────────────────────
const logger = pino({ level: 'silent' });

// ──────────────────────────────────────────────
//  UTILITAIRES CONSOLE
// ──────────────────────────────────────────────
const now  = () => new Date().toLocaleTimeString('fr-FR');
const log  = (tag, msg) => console.log(`\x1b[36m[${now()}]\x1b[0m \x1b[33m[${tag}]\x1b[0m ${msg}`);
const info = (msg)      => console.log(`\x1b[36m[${now()}]\x1b[0m \x1b[32m[INFO]\x1b[0m  ${msg}`);
const warn = (msg)      => console.log(`\x1b[36m[${now()}]\x1b[0m \x1b[33m[WARN]\x1b[0m  ${msg}`);
const err  = (msg)      => console.log(`\x1b[36m[${now()}]\x1b[0m \x1b[31m[ERR]\x1b[0m   ${msg}`);

// ──────────────────────────────────────────────
//  UPTIME formaté
// ──────────────────────────────────────────────
function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  return `${d}j ${h % 24}h ${m % 60}m ${s % 60}s`;
}

// ──────────────────────────────────────────────
//  CHARGEUR DE COMMANDES
// ──────────────────────────────────────────────
const commands = new Map();

function loadCommands() {
  const dir = path.resolve(CONFIG.commandsDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    warn(`Dossier ${CONFIG.commandsDir} créé (vide).`);
    return;
  }

  // Vider le cache require pour les recharges à chaud
  for (const [name] of commands) {
    const filePath = path.join(dir, `${name}.js`);
    if (require.cache[require.resolve(filePath)]) {
      delete require.cache[require.resolve(filePath)];
    }
  }
  commands.clear();

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  for (const file of files) {
    try {
      const mod = require(path.join(dir, file));
      // Support { name, execute } ou module.exports = { name, execute }
      if (mod && mod.name && typeof mod.execute === 'function') {
        commands.set(mod.name.toLowerCase(), mod);
        log('CMD', `Chargé : .${mod.name}`);
      } else {
        warn(`commands/${file} : export invalide (name + execute requis).`);
      }
    } catch (e) {
      err(`commands/${file} : ${e.message}`);
    }
  }
  info(`${commands.size} commande(s) chargée(s).`);
}

// ──────────────────────────────────────────────
//  CHARGEUR D'EVENTS
// ──────────────────────────────────────────────
const eventHandlers = new Map();

function loadEvents() {
  const dir = path.resolve(CONFIG.eventsDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    warn(`Dossier ${CONFIG.eventsDir} créé (vide).`);
    return;
  }

  eventHandlers.clear();

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  for (const file of files) {
    try {
      const mod = require(path.join(dir, file));
      if (mod && mod.event && typeof mod.execute === 'function') {
        if (!eventHandlers.has(mod.event)) eventHandlers.set(mod.event, []);
        eventHandlers.get(mod.event).push(mod);
        log('EVT', `Chargé : ${mod.event} (${file})`);
      } else {
        warn(`events/${file} : export invalide (event + execute requis).`);
      }
    } catch (e) {
      err(`events/${file} : ${e.message}`);
    }
  }
  info(`${eventHandlers.size} type(s) d'événement(s) chargé(s).`);
}

// ──────────────────────────────────────────────
//  EXTRACTION DU TEXTE D'UN MESSAGE
// ──────────────────────────────────────────────
function extractText(msg) {
  const type = getContentType(msg.message);
  if (!type) return '';
  const content = msg.message[type];
  if (typeof content === 'string') return content;
  if (content?.text)    return content.text;
  if (content?.caption) return content.caption;
  if (content?.conversation) return content.conversation;
  return '';
}

// ──────────────────────────────────────────────
//  GESTION DES COMMANDES UNIVERSELLES (sans prefix)
// ──────────────────────────────────────────────
async function handleUniversal(sock, msg, text, jid) {
  const lower = text.trim().toLowerCase();

  // ── stat ──────────────────────────────────────
  if (lower === 'stat') {
    const up = formatUptime(Date.now() - stats.startTime);
    const reply =
      `╔═══════════════════════╗\n` +
      `║   📊 *${CONFIG.botName}*   ║\n` +
      `╚═══════════════════════╝\n` +
      `⏱ *Uptime*       : ${up}\n` +
      `💬 *Messages*    : ${stats.messagesTotal}\n` +
      `⚡ *Commandes*   : ${stats.commandsUsed}\n` +
      `🎯 *Événements*  : ${stats.eventsHandled}\n` +
      `🔄 *Reconnexions*: ${stats.reconnections}`;
    await sock.sendMessage(jid, { text: reply }, { quoted: msg });
    return true;
  }

  // ── alive ─────────────────────────────────────
  if (lower === 'alive') {
    await sock.sendMessage(jid, { react: { text: '⚡', key: msg.key } });
    return true;
  }

  return false;
}

// ──────────────────────────────────────────────
//  DISPATCH DES EVENTS PERSONNALISÉS
// ──────────────────────────────────────────────
async function dispatchEvent(eventName, sock, ...args) {
  stats.eventsHandled++;
  const handlers = eventHandlers.get(eventName) || [];
  for (const h of handlers) {
    try {
      await h.execute(sock, ...args);
    } catch (e) {
      err(`Event handler [${eventName}] : ${e.message}`);
    }
  }
}

// ──────────────────────────────────────────────
//  DEMANDE DU PAIR CODE
//  ⚠️  Doit être appelé APRÈS que le WS soit
//      établi (depuis connection.update 'open'
//      ou avec un délai post-makeWASocket).
// ──────────────────────────────────────────────
let pairCodeRequested = false;

async function requestPairCode(sock) {
  if (pairCodeRequested) return;
  pairCodeRequested = true;

  const number = CONFIG.ownerNumber.replace(/[^0-9]/g, '');

  // Attendre que le socket soit réellement prêt (le WS met ~1-2s à s'ouvrir)
  await new Promise(r => setTimeout(r, 5000));

  try {
    const code = await sock.requestPairingCode(number);
    const formatted = code.match(/.{1,4}/g).join('-'); // XXXX-XXXX
    console.log('\n');
    console.log('  \x1b[42m\x1b[30m  VOTRE CODE DE JUMELAGE  \x1b[0m');
    console.log(`  \x1b[1m\x1b[33m  ${formatted}  \x1b[0m`);
    console.log('  Entrez ce code dans WhatsApp → Appareils liés → Lier avec un numéro\n');
  } catch (e) {
    err(`Impossible d'obtenir le pair code : ${e.message}`);
    pairCodeRequested = false; // permettre un retry
  }
}

// ──────────────────────────────────────────────
//  KEEPALIVE — affichage console toutes les 5 min
// ──────────────────────────────────────────────
let keepAliveTimer = null;
function startKeepAlive(sock) {
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  keepAliveTimer = setInterval(async () => {
    const up = formatUptime(Date.now() - stats.startTime);
    info(`⚡ KeepAlive — uptime: ${up} | msgs: ${stats.messagesTotal} | cmds: ${stats.commandsUsed}`);
    // Ping léger pour maintenir la connexion ouverte
    try { await sock.sendPresenceUpdate('available'); } catch (_) {}
  }, CONFIG.keepAliveMs);
}

// ──────────────────────────────────────────────
//  CONNEXION PRINCIPALE
// ──────────────────────────────────────────────
let retryCount = 0;

async function connect() {
  // Assurer les dossiers
  if (!fs.existsSync(CONFIG.sessionDir)) fs.mkdirSync(CONFIG.sessionDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(CONFIG.sessionDir);
  const { version }          = await fetchLatestBaileysVersion();

  info(`Baileys version : ${version.join('.')}`);

  const sock = makeWASocket({
    version,
    logger,
    auth: {
      creds : state.creds,
      keys  : makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal  : false,   // on utilise le pair code
    markOnlineOnConnect: true,
    syncFullHistory    : false,
    browser            : ['Mac OS', 'Chrome', '1.0.0'],
    generateHighQualityLinkPreview: false,
  });

  // ════════════════════════════════════════════
  //  CONNECTION UPDATE
  // ════════════════════════════════════════════
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    // Pair code demandé dès que le WS est "connecting" (socket ouvert, pas encore auth)
    if (connection === 'connecting' && !sock.authState.creds.registered) {
      requestPairCode(sock); // sans await — ne bloque pas l'event loop
    }

    if (connection === 'open') {
      retryCount = 0;
      pairCodeRequested = false;
      info(`✅ Connecté en tant que ${sock.user?.id}`);
      startKeepAlive(sock);
      await dispatchEvent('connection.open', sock);
    }

    if (connection === 'close') {
      if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }

      const code   = lastDisconnect?.error ? new Boom(lastDisconnect.error)?.output?.statusCode : 0;
      const reason = DisconnectReason;

      warn(`Connexion fermée — code: ${code}`);

      // Session corrompue / logout explicite → supprimer et relancer
      // ⚠️  On ne supprime QUE si la session était déjà enregistrée
      //     (évite la boucle infinie lors d'un 1er login avec pair code)
      const wasRegistered = sock.authState.creds.registered;

      if (code === reason.loggedOut && wasRegistered) {
        err('Session expirée (loggedOut). Suppression et redémarrage...');
        fs.rmSync(CONFIG.sessionDir, { recursive: true, force: true });
        pairCodeRequested = false;
        retryCount = 0;
        return connect();
      }

      // Toute autre fermeture → reconnexion avec backoff
      if (retryCount < CONFIG.maxRetries) {
        retryCount++;
        stats.reconnections++;
        pairCodeRequested = false;
        const delay = Math.min(1000 * 2 ** retryCount, 30000);
        warn(`Reconnexion ${retryCount}/${CONFIG.maxRetries} dans ${delay / 1000}s...`);
        setTimeout(connect, delay);
      } else {
        err(`Échec après ${CONFIG.maxRetries} tentatives. Arrêt.`);
        process.exit(1);
      }
    }

    if (connection === 'connecting') {
      info('Connexion en cours...');
    }

    await dispatchEvent('connection.update', sock, update);
  });

  // ════════════════════════════════════════════
  //  SAUVEGARDE DES CREDENTIALS
  // ════════════════════════════════════════════
  sock.ev.on('creds.update', saveCreds);

  // ════════════════════════════════════════════
  //  MESSAGES — TRAITEMENT PRINCIPAL
  // ════════════════════════════════════════════
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    await dispatchEvent('messages.upsert', sock, { messages, type });

    for (const msg of messages) {
      if (!msg.message) continue;

      stats.messagesTotal++;

      const jid  = msg.key.remoteJid;
      const text = extractText(msg).trim();

      if (!text) continue;

      // ── Commandes universelles (sans prefix) ──
      try {
        const handled = await handleUniversal(sock, msg, text, jid);
        if (handled) { stats.commandsUsed++; continue; }
      } catch (e) {
        err(`Universal handler : ${e.message}`);
        await sock.sendMessage(jid, { text: `❌ Erreur : ${e.message}` }, { quoted: msg }).catch(() => {});
      }

      // ── Commandes avec prefix ──────────────────
      if (!text.startsWith(CONFIG.prefix)) continue;

      const args    = text.slice(CONFIG.prefix.length).trim().split(/\s+/);
      const cmdName = args.shift().toLowerCase();
      const cmd     = commands.get(cmdName);

      if (!cmd) continue;

      log('CMD', `${jid} → ${CONFIG.prefix}${cmdName} [${args.join(', ')}]`);
      stats.commandsUsed++;

      try {
        await cmd.execute({ sock, msg, args, jid, text, config: CONFIG, stats });
      } catch (e) {
        err(`Commande [${cmdName}] : ${e.message}`);
        await sock.sendMessage(jid, { text: `❌ Erreur commande *${cmdName}* :\n${e.message}` }, { quoted: msg }).catch(() => {});
      }
    }
  });

  // ════════════════════════════════════════════
  //  TOUS LES AUTRES ÉVÉNEMENTS WHATSAPP
  // ════════════════════════════════════════════

  // Accusés de réception & lecture
  sock.ev.on('messages.update',          (u) => dispatchEvent('messages.update',          sock, u));
  sock.ev.on('message-receipt.update',   (u) => dispatchEvent('message-receipt.update',   sock, u));
  sock.ev.on('messages.delete',          (u) => dispatchEvent('messages.delete',           sock, u));
  sock.ev.on('messages.reaction',        (u) => dispatchEvent('messages.reaction',         sock, u));
  sock.ev.on('messages.media-update',    (u) => dispatchEvent('messages.media-update',     sock, u));

  // Présence
  sock.ev.on('presence.update',          (u) => dispatchEvent('presence.update',           sock, u));

  // Groupes
  sock.ev.on('groups.update',            (u) => dispatchEvent('groups.update',             sock, u));
  sock.ev.on('groups.upsert',            (u) => dispatchEvent('groups.upsert',             sock, u));
  sock.ev.on('group-participants.update',(u) => dispatchEvent('group-participants.update', sock, u));

  // Contacts & chats
  sock.ev.on('contacts.upsert',          (u) => dispatchEvent('contacts.upsert',           sock, u));
  sock.ev.on('contacts.update',          (u) => dispatchEvent('contacts.update',            sock, u));
  sock.ev.on('chats.upsert',             (u) => dispatchEvent('chats.upsert',               sock, u));
  sock.ev.on('chats.update',             (u) => dispatchEvent('chats.update',               sock, u));
  sock.ev.on('chats.delete',             (u) => dispatchEvent('chats.delete',               sock, u));
  sock.ev.on('chats.phoneNumberShare',   (u) => dispatchEvent('chats.phoneNumberShare',     sock, u));

  // Blocage
  sock.ev.on('blocklist.update',         (u) => dispatchEvent('blocklist.update',           sock, u));
  sock.ev.on('blocklist.set',            (u) => dispatchEvent('blocklist.set',              sock, u));

  // Appels
  sock.ev.on('call',                     (u) => dispatchEvent('call',                       sock, u));

  // Labels (WhatsApp Business)
  sock.ev.on('labels.edit',              (u) => dispatchEvent('labels.edit',                sock, u));
  sock.ev.on('labels.association',       (u) => dispatchEvent('labels.association',         sock, u));

  return sock;
}

// ──────────────────────────────────────────────
//  GESTION DES ERREURS PROCESS GLOBALES
// ──────────────────────────────────────────────
process.on('uncaughtException',  (e) => err(`uncaughtException : ${e.message}\n${e.stack}`));
process.on('unhandledRejection', (e) => err(`unhandledRejection : ${e}`));

// ──────────────────────────────────────────────
//  DÉMARRAGE
// ──────────────────────────────────────────────
(async () => {
  console.log('\n  \x1b[45m\x1b[37m  ⚡ ZENITSU MINI — DÉMARRAGE  \x1b[0m\n');
  loadCommands();
  loadEvents();
  await connect();
})();

// ──────────────────────────────────────────────
//  EXPORTS (utile si utilisé comme module)
// ──────────────────────────────────────────────
module.exports = { commands, eventHandlers, stats, CONFIG };
