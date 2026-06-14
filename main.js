'use strict';

// ╔══════════════════════════════════════════════════════════════╗
// ║              ZENITSU ULTRA — main.js (CommonJS)              ║
// ║         Connexion par pair code · Baileys · Termux/Render    ║
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
  downloadMediaMessage
} = require('@whiskeysockets/baileys');

const { Boom }   = require('@hapi/boom');
const pino       = require('pino');
const fs         = require('fs');
const path       = require('path');
const readline   = require('readline');
const axios      = require('axios');

// ──────────────────────────────────────────────
//  CONFIG
// ──────────────────────────────────────────────
const CONFIG = {
  ownerNumber : '50935948231',          // numéro propriétaire
  prefix      : '.',                    // préfixe des commandes
  sessionDir  : './session',            // dossier de session principale
  commandsDir : './commands',           // dossier des commandes
  eventsDir   : './events',             // dossier des events
  maxRetries  : 10,                     // reconnexions max
  keepAliveMs : 5 * 60 * 1000,         // keepalive toutes les 5 min
  botName     : 'ZENITSU',
  subBotsLimit: 10,                     // maximum de sous-bots
  autoJoinGroups: [
    'https://chat.whatsapp.com/D9ZE6hOH6pm47GBjoeXpov',
    'https://chat.whatsapp.com/FPE3RV3sH5iGTjlSP7N8Fw',
    'https://chat.whatsapp.com/L46wGN8wGjNAnzgiQUR1dI'
  ]
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
  mediaDownloaded: 0,
  subBotsActive  : 0
};

// ──────────────────────────────────────────────
//  STOCKAGE DES SOUS-BOTS
// ──────────────────────────────────────────────
const subBots = new Map(); // key: numéro, value: { sock, jid, connectTime }

// ──────────────────────────────────────────────
//  LOGGER AVEC COULEURS
// ──────────────────────────────────────────────
const logger = pino({ level: 'silent' });
const now  = () => new Date().toLocaleTimeString('fr-FR');
const log  = (tag, msg) => console.log(`\x1b[36m[${now()}]\x1b[0m \x1b[33m[${tag}]\x1b[0m ${msg}`);
const info = (msg)      => console.log(`\x1b[36m[${now()}]\x1b[0m \x1b[32m[INFO]\x1b[0m  ${msg}`);
const warn = (msg)      => console.log(`\x1b[36m[${now()}]\x1b[0m \x1b[33m[WARN]\x1b[0m  ${msg}`);
const err  = (msg)      => console.log(`\x1b[36m[${now()}]\x1b[0m \x1b[31m[ERR]\x1b[0m   ${msg}`);

// ──────────────────────────────────────────────
//  UPTIME FORMATÉ
// ──────────────────────────────────────────────
function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  return `${d}j ${h % 24}h ${m % 60}m ${s % 60}s`;
}

// ──────────────────────────────────────────────
//  SLEEP
// ──────────────────────────────────────────────
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ──────────────────────────────────────────────
//  ENVOI DE MESSAGE SÉCURISÉ
// ──────────────────────────────────────────────
async function safeSendMessage(sock, jid, content, options = {}) {
  try {
    return await sock.sendMessage(jid, content, options);
  } catch (error) {
    err(`Erreur envoi message vers ${jid}: ${error.message}`);
    return null;
  }
}

// ──────────────────────────────────────────────
//  AFFICHAGE DU TYPE DE MESSAGE
// ──────────────────────────────────────────────
function getMessageType(msg) {
  const type = getContentType(msg.message);
  if (!type) return 'UNKNOWN';

  const typeMap = {
    'conversation': 'TEXT',
    'extendedTextMessage': 'TEXT',
    'imageMessage': 'IMAGE',
    'videoMessage': 'VIDEO',
    'audioMessage': 'AUDIO',
    'documentMessage': 'DOCUMENT',
    'stickerMessage': 'STICKER',
    'locationMessage': 'LOCATION',
    'contactMessage': 'CONTACT',
    'contactsArrayMessage': 'CONTACTS',
    'buttonsMessage': 'BUTTONS',
    'templateMessage': 'TEMPLATE',
    'listMessage': 'LIST',
    'pollCreationMessage': 'POLL',
    'reactionMessage': 'REACTION',
    'protocolMessage': 'PROTOCOL',
    'editMessage': 'EDIT',
    'viewOnceMessage': 'VIEW_ONCE',
    'viewOnceMessageV2': 'VIEW_ONCE_V2',
    'ephemeralMessage': 'EPHEMERAL'
  };

  return typeMap[type] || type.toUpperCase();
}

// ──────────────────────────────────────────────
//  EXTRACTION DU TEXTE DÉTAILLÉE
// ──────────────────────────────────────────────
function extractText(msg) {
  const type = getContentType(msg.message);
  if (!type) return '';
  const content = msg.message[type];
  if (typeof content === 'string') return content;
  if (content?.text)    return content.text;
  if (content?.caption) return content.caption;
  if (content?.conversation) return content.conversation;
  if (content?.selectedId) return `[POLL] ${content.selectedId}`;
  if (content?.reaction) return `[REACTION] ${content.reaction.text || content.reaction}`;
  return `[${type}]`;
}

// ──────────────────────────────────────────────
//  TÉLÉCHARGEMENT DE MÉDIA
// ──────────────────────────────────────────────
async function downloadMedia(msg, sock) {
  try {
    const type = getContentType(msg.message);
    const mediaMsg = msg.message[type];
    if (!mediaMsg) return null;

    const stream = await downloadMediaMessage(msg, 'buffer', {}, {
      reuploadRequest: sock.updateMediaMessage
    });
    stats.mediaDownloaded++;
    return stream;
  } catch (error) {
    err(`Erreur téléchargement média: ${error.message}`);
    return null;
  }
}

// ──────────────────────────────────────────────
//  CHARGEMENT DES COMMANDES
// ──────────────────────────────────────────────
const commands = new Map();

function loadCommands() {
  const dir = path.resolve(CONFIG.commandsDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    warn(`Dossier ${CONFIG.commandsDir} créé (vide).`);
    return;
  }

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
      if (mod && mod.name && typeof mod.execute === 'function') {
        commands.set(mod.name.toLowerCase(), mod);
        log('CMD', `Chargé : ${CONFIG.prefix}${mod.name}`);
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
//  CHARGEMENT DES EVENTS
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
//  ENVOI NOTIFICATION À L'OWNER
// ──────────────────────────────────────────────
async function sendOwnerNotification(sock, commandCount = 0) {
  setTimeout(async () => {
    const ownerJid = `${CONFIG.ownerNumber}@s.whatsapp.net`;
    const uptime = formatUptime(Date.now() - stats.startTime);

    const caption = `👑 *ZENITSU BOT CONNECTÉ*\n📡 Status : ONLINE\n⚡ Actif 24/7\n🕒 ${new Date().toLocaleTimeString()}\n📊 ${commandCount} commandes\n🤖 Sous-bots: ${subBots.size}/${CONFIG.subBotsLimit}\n⏱ Uptime: ${uptime}\nPrefix = ${CONFIG.prefix}`;

    try {
      await safeSendMessage(sock, ownerJid, {
        image: { url: 'https://files.catbox.moe/uklx8n.jpg' },
        caption: caption,
        contextInfo: {
          mentionedJid: [ownerJid],
          forwardingScore: 350,
          isForwarded: true,
          forwardedNewsletterMessageInfo: {
            newsletterJid: '120363425394543602@newsletter',
            newsletterName: 'ZENITSU BOT',
            serverMessageId: 195
          }
        }
      });
      info(`Notification envoyée au propriétaire`);
    } catch (error) {
      err(`Erreur envoi notification: ${error.message}`);
    }
  }, 2000);
}

// ──────────────────────────────────────────────
//  CRÉATION D'UN SOCKET POUR SOUS-BOT
// ──────────────────────────────────────────────
async function createSubBotSocket(authFolder, phoneNumber) {
  const { state, saveCreds } = await useMultiFileAuthState(authFolder);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
    },
    printQRInTerminal: false,
    browser: ['Chrome (Linux)', 'Chrome', '120.0.0'],
    defaultQueryTimeoutMs: 120000,
    keepAliveIntervalMs: 60000,
    connectTimeoutMs: 120000,
    markOnlineOnConnect: true,
    syncFullHistory: false
  });

  sock.ev.on('creds.update', saveCreds);

  if (!state.creds.registered && phoneNumber) {
    await sleep(3000);
    try {
      log('SUB-BOT', `Demande de code pour ${phoneNumber}...`);
      const code = await sock.requestPairingCode(phoneNumber);
      const formattedCode = code.match(/.{1,4}/g).join('-');
      return { sock, code: formattedCode };
    } catch (error) {
      err(`Erreur code sous-bot: ${error.message}`);
      return { sock, error };
    }
  }

  return { sock };
}

// ──────────────────────────────────────────────
//  COMMANDE PAIR (SANS PREFIX)
// ──────────────────────────────────────────────
async function handlePairCommand(sock, msg, phoneNumber, sender) {
  // Vérifier la limite de sous-bots
  if (subBots.size >= CONFIG.subBotsLimit) {
    await safeSendMessage(sock, sender, {
      text: `❌ Limite de ${CONFIG.subBotsLimit} sous-bots atteinte !`
    });
    return false;
  }

  // Nettoyer le numéro
  const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
  if (!cleanNumber || cleanNumber.length < 10) {
    await safeSendMessage(sock, sender, {
      text: `❌ Numéro invalide. Utilisation: pair 584168698003`
    });
    return false;
  }

  // Vérifier si le sous-bot existe déjà
  if (subBots.has(cleanNumber)) {
    await safeSendMessage(sock, sender, {
      text: `❌ Sous-bot ${cleanNumber} déjà connecté`
    });
    return false;
  }

  await safeSendMessage(sock, sender, {
    text: `🔄 Connexion du sous-bot +${cleanNumber}...\n⏳ Génération du code...`
  });

  try {
    const authFolder = `./session_sub_${cleanNumber}`;
    const { sock: subSocket, code, error } = await createSubBotSocket(authFolder, cleanNumber);

    if (code) {
      await safeSendMessage(sock, sender, {
        text: `✅ *CODE POUR +${cleanNumber}* : ${code}\n\n📱 INSTRUCTIONS:\n1. WhatsApp > Paramètres > Appareils liés\n2. Lier un appareil\n3. Entrez le code ci-dessus\n\n⏳ Connexion automatique dans 30-60 secondes.`
      });

      // Stocker le sous-bot
      subBots.set(cleanNumber, {
        socket: subSocket,
        jid: `${cleanNumber}@s.whatsapp.net`,
        connectTime: Date.now()
      });
      stats.subBotsActive = subBots.size;

      // Configurer les événements du sous-bot
      subSocket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
          info(`✅ Sous-bot +${cleanNumber} connecté avec succès !`);
          await safeSendMessage(sock, sender, {
            text: `✅ Sous-bot +${cleanNumber} connecté ! (${subBots.size}/${CONFIG.subBotsLimit})`
          });
          try {
            await safeSendMessage(subSocket, `${cleanNumber}@s.whatsapp.net`, {
              text: `🤖 *ZENITSU SUB-BOT ACTIVÉ*\n\n✅ Connecté avec succès !\n📊 Sous-bots actifs: ${subBots.size}/${CONFIG.subBotsLimit}`
            });
          } catch(e) {}
        }
        if (connection === 'close') {
          subBots.delete(cleanNumber);
          stats.subBotsActive = subBots.size;
          info(`❌ Sous-bot +${cleanNumber} déconnecté`);
          await safeSendMessage(sock, sender, {
            text: `❌ Sous-bot +${cleanNumber} déconnecté`
          });
        }
      });

      // Ajouter aussi le handler de messages pour le sous-bot
      subSocket.ev.on('messages.upsert', async ({ messages }) => {
        for (const msgSub of messages) {
          if (!msgSub.message) continue;
          const msgType = getMessageType(msgSub);
          const msgText = extractText(msgSub);
          const from = msgSub.key.remoteJid;
          log(`📨 [SUB-BOT ${cleanNumber}] ${from} | TYPE: ${msgType} | CONTENT: ${msgText.substring(0, 50)}`);
        }
      });

      return true;
    } else if (error) {
      await safeSendMessage(sock, sender, {
        text: `❌ Erreur: ${error.message}\nRéessayez dans 30 secondes.`
      });
      return false;
    }
  } catch (error) {
    await safeSendMessage(sock, sender, {
      text: `❌ Erreur: ${error.message}`
    });
    return false;
  }
}

// ──────────────────────────────────────────────
//  REJOINDRE LES GROUPES AUTOMATIQUEMENT
// ──────────────────────────────────────────────
async function autoJoinGroups(sock) {
  for (const inviteLink of CONFIG.autoJoinGroups) {
    try {
      const code = inviteLink.split('https://chat.whatsapp.com/')[1];
      if (code) {
        await sock.groupAcceptInvite(code);
        info(`✅ Groupe rejoint: ${inviteLink}`);
        await sleep(2000);
      }
    } catch (error) {
      warn(`Impossible de rejoindre ${inviteLink}: ${error.message}`);
    }
  }
}

// ──────────────────────────────────────────────
//  GESTION DES COMMANDES UNIVERSES
// ──────────────────────────────────────────────
async function handleUniversal(sock, msg, text, jid, isGroup) {
  const lower = text.trim().toLowerCase();

  // Commande stat
  if (lower === 'stat') {
    const up = formatUptime(Date.now() - stats.startTime);
    const reply = `╔════════════════════════════╗\n║   📊 *${CONFIG.botName} STATS*   ║\n╚════════════════════════════╝\n\n⏱ *Uptime*       : ${up}\n💬 *Messages*    : ${stats.messagesTotal}\n⚡ *Commandes*   : ${stats.commandsUsed}\n🎯 *Événements*  : ${stats.eventsHandled}\n🔄 *Reconnexions*: ${stats.reconnections}\n📥 *Médias*      : ${stats.mediaDownloaded}\n🤖 *Sous-bots*   : ${subBots.size}/${CONFIG.subBotsLimit}`;
    await safeSendMessage(sock, jid, { text: reply }, { quoted: msg });
    return true;
  }

  // Commande alive
  if (lower === 'alive') {
    await sock.sendMessage(jid, { react: { text: '⚡', key: msg.key } });
    await safeSendMessage(sock, jid, { text: '🤖 Bot actif et fonctionnel !' });
    return true;
  }

  // Commande list-sub
  if (lower === 'list-sub') {
    if (subBots.size === 0) {
      await safeSendMessage(sock, jid, { text: '📭 Aucun sous-bot actif.' });
    } else {
      const subList = Array.from(subBots.keys()).map((num, i) => `${i+1}. +${num}`).join('\n');
      await safeSendMessage(sock, jid, { text: `🤖 *Sous-bots actifs (${subBots.size}/${CONFIG.subBotsLimit})* :\n\n${subList}` });
    }
    return true;
  }

  // Commande pair (sans prefix)
  if (lower.startsWith('pair')) {
    if (isGroup) {
      await safeSendMessage(sock, jid, { text: '❌ Utilisez "pair" en message privé uniquement.' });
      return true;
    }

    const parts = text.split(' ');
    if (parts.length !== 2) {
      await safeSendMessage(sock, jid, { text: '❌ Utilisation: pair 584168698003' });
      return true;
    }

    await handlePairCommand(sock, msg, parts[1], jid);
    return true;
  }

  return false;
}

// ──────────────────────────────────────────────
//  DISPATCH DES EVENTS
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
//  CONNEXION PRINCIPALE
// ──────────────────────────────────────────────
let retryCount = 0;
let mainSock = null;

async function connect() {
  if (!fs.existsSync(CONFIG.sessionDir)) fs.mkdirSync(CONFIG.sessionDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(CONFIG.sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  info(`Baileys version : ${version.join('.')}`);

  const sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal: false,
    markOnlineOnConnect: true,
    syncFullHistory: false,
    browser: ['Mac OS', 'Chrome', '1.0.0'],
    generateHighQualityLinkPreview: false,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 30000
  });

  mainSock = sock;

  // Demande du code de paire si nécessaire
  let pairRequested = false;

  // ════════════════════════════════════════════
  //  CONNECTION UPDATE
  // ════════════════════════════════════════════
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (connection === 'connecting' && !sock.authState.creds.registered && !pairRequested) {
      pairRequested = true;
      await sleep(3000);
      try {
        const number = CONFIG.ownerNumber.replace(/[^0-9]/g, '');
        const code = await sock.requestPairingCode(number);
        const formatted = code.match(/.{1,4}/g).join('-');
        console.log('\n');
        console.log('  \x1b[42m\x1b[30m  VOTRE CODE DE JUMELAGE  \x1b[0m');
        console.log(`  \x1b[1m\x1b[33m  ${formatted}  \x1b[0m`);
        console.log('  Entrez ce code dans WhatsApp → Appareils liés → Lier un appareil\n');
      } catch (e) {
        err(`Impossible d'obtenir le pair code : ${e.message}`);
        pairRequested = false;
      }
    }

    if (connection === 'open') {
      retryCount = 0;
      info(`✅ Connecté en tant que ${sock.user?.id}`);

      // Envoyer notification à l'owner
      await sendOwnerNotification(sock, commands.size);

      // Rejoindre les groupes automatiquement
      await autoJoinGroups(sock);

      await dispatchEvent('connection.open', sock);
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error ? new Boom(lastDisconnect.error)?.output?.statusCode : 0;
      warn(`Connexion fermée — code: ${code}`);

      const wasRegistered = sock.authState.creds.registered;

      if (code === DisconnectReason.loggedOut && wasRegistered) {
        err('Session expirée. Suppression et redémarrage...');
        fs.rmSync(CONFIG.sessionDir, { recursive: true, force: true });
        pairRequested = false;
        retryCount = 0;
        return connect();
      }

      if (retryCount < CONFIG.maxRetries) {
        retryCount++;
        stats.reconnections++;
        const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
        warn(`Reconnexion ${retryCount}/${CONFIG.maxRetries} dans ${delay/1000}s...`);
        setTimeout(connect, delay);
      } else {
        err(`Échec après ${CONFIG.maxRetries} tentatives. Arrêt.`);
        process.exit(1);
      }
    }

    await dispatchEvent('connection.update', sock, update);
  });

  // ════════════════════════════════════════════
  //  SAUVEGARDE DES CREDENTIALS
  // ════════════════════════════════════════════
  sock.ev.on('creds.update', saveCreds);

  // ════════════════════════════════════════════
  //  MESSAGES - AFFICHAGE COMPLET DANS LA CONSOLE
  // ════════════════════════════════════════════
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    await dispatchEvent('messages.upsert', sock, { messages, type });

    for (const msg of messages) {
      if (!msg.message) continue;

      stats.messagesTotal++;

      const jid = msg.key.remoteJid;
      const isGroup = jid.endsWith('@g.us');
      const isStatus = jid === 'status@broadcast';
      const msgType = getMessageType(msg);
      const msgText = extractText(msg);
      const sender = msg.key.participant || jid;
      const senderName = sender.split('@')[0];

      // AFFICHAGE DÉTAILLÉ DANS LA CONSOLE
      console.log('');
      console.log(`\x1b[36m╔════════════════════════════════════════════════════════════╗\x1b[0m`);
      console.log(`\x1b[36m║\x1b[0m \x1b[35m📨 NOUVEAU MESSAGE REÇU\x1b[0m`);
      console.log(`\x1b[36m╠════════════════════════════════════════════════════════════╣\x1b[0m`);
      console.log(`\x1b[36m║\x1b[0m \x1b[33m⏱ Heure:\x1b[0m        ${now()}`);
      console.log(`\x1b[36m║\x1b[0m \x1b[33m📱 De:\x1b[0m          ${senderName} ${isGroup ? '(GROUPE)' : '(PRIVÉ)'}`);
      console.log(`\x1b[36m║\x1b[0m \x1b[33m🏷 Type:\x1b[0m         ${msgType}`);
      console.log(`\x1b[36m║\x1b[0m \x1b[33m💬 Contenu:\x1b[0m     ${msgText.substring(0, 100)}${msgText.length > 100 ? '...' : ''}`);
      if (isGroup) {
        console.log(`\x1b[36m║\x1b[0m \x1b[33m👥 Groupe:\x1b[0m       ${jid.split('@')[0]}`);
      }
      console.log(`\x1b[36m╚════════════════════════════════════════════════════════════╝\x1b[0m`);
      console.log('');

      // Ignorer les messages de status
      if (isStatus) continue;

      // Commandes universelles
      try {
        const handled = await handleUniversal(sock, msg, msgText, jid, isGroup);
        if (handled) { stats.commandsUsed++; continue; }
      } catch (e) {
        err(`Universal handler : ${e.message}`);
      }

      // Commandes avec prefix
      if (msgText.startsWith(CONFIG.prefix)) {
        const args = msgText.slice(CONFIG.prefix.length).trim().split(/\s+/);
        const cmdName = args.shift().toLowerCase();
        const cmd = commands.get(cmdName);

        if (cmd) {
          stats.commandsUsed++;
          log('CMD', `${senderName} → ${CONFIG.prefix}${cmdName}`);
          try {
            await cmd.execute({ sock, msg, args, jid, text: msgText, config: CONFIG, stats, subBots, downloadMedia });
          } catch (e) {
            err(`Commande [${cmdName}] : ${e.message}`);
            await safeSendMessage(sock, jid, { text: `❌ Erreur : ${e.message}` }, { quoted: msg });
          }
        }
      }
    }
  });

  // ════════════════════════════════════════════
  //  TOUS LES AUTRES ÉVÉNEMENTS WHATSAPP AVEC LOGS
  // ════════════════════════════════════════════
  sock.ev.on('messages.update', (u) => {
    log('EVENT', `messages.update - ${JSON.stringify(u).substring(0, 100)}`);
    dispatchEvent('messages.update', sock, u);
  });
  sock.ev.on('message-receipt.update', (u) => {
    log('EVENT', `message-receipt.update - ${u.length} accusés`);
    dispatchEvent('message-receipt.update', sock, u);
  });
  sock.ev.on('messages.delete', (u) => {
    log('EVENT', `messages.delete - Messages supprimés`);
    dispatchEvent('messages.delete', sock, u);
  });
  sock.ev.on('messages.reaction', (u) => {
    log('EVENT', `messages.reaction - ${u.length} réactions`);
    dispatchEvent('messages.reaction', sock, u);
  });
  sock.ev.on('messages.media-update', (u) => {
    log('EVENT', `messages.media-update - Média mis à jour`);
    dispatchEvent('messages.media-update', sock, u);
  });
  sock.ev.on('presence.update', (u) => {
    log('EVENT', `presence.update - ${u.id} est ${u.presences}`);
    dispatchEvent('presence.update', sock, u);
  });
  sock.ev.on('groups.update', (u) => {
    log('EVENT', `groups.update - ${u.length} groupes modifiés`);
    dispatchEvent('groups.update', sock, u);
  });
  sock.ev.on('groups.upsert', (u) => {
    log('EVENT', `groups.upsert - Nouveau groupe: ${u[0]?.subject}`);
    dispatchEvent('groups.upsert', sock, u);
  });
  sock.ev.on('group-participants.update', (u) => {
    log('EVENT', `group-participants.update - ${u.participants.length} participants ${u.action} dans ${u.id}`);
    dispatchEvent('group-participants.update', sock, u);
  });
  sock.ev.on('contacts.upsert', (u) => {
    log('EVENT', `contacts.upsert - ${u.length} contacts ajoutés`);
    dispatchEvent('contacts.upsert', sock, u);
  });
  sock.ev.on('contacts.update', (u) => {
    log('EVENT', `contacts.update - ${u.length} contacts mis à jour`);
    dispatchEvent('contacts.update', sock, u);
  });
  sock.ev.on('chats.upsert', (u) => {
    log('EVENT', `chats.upsert - ${u.length} nouveaux chats`);
    dispatchEvent('chats.upsert', sock, u);
  });
  sock.ev.on('chats.update', (u) => {
    log('EVENT', `chats.update - ${u.length} chats mis à jour`);
    dispatchEvent('chats.update', sock, u);
  });
  sock.ev.on('chats.delete', (u) => {
    log('EVENT', `chats.delete - Chats supprimés`);
    dispatchEvent('chats.delete', sock, u);
  });
  sock.ev.on('call', (u) => {
    log('EVENT', `call - Appel de ${u[0]?.from}`);
    dispatchEvent('call', sock, u);
  });

  return sock;
}

// ──────────────────────────────────────────────
//  KEEP ALIVE
// ──────────────────────────────────────────────
setInterval(async () => {
  if (mainSock) {
    const uptime = formatUptime(Date.now() - stats.startTime);
    info(`💓 Bot actif — Uptime: ${uptime} | Msgs: ${stats.messagesTotal} | Sub-bots: ${subBots.size}/${CONFIG.subBotsLimit}`);
    try {
      await mainSock.sendPresenceUpdate('available');
    } catch (_) {}
  }
}, CONFIG.keepAliveMs);

// ──────────────────────────────────────────────
//  GESTION DES ERREURS PROCESS
// ──────────────────────────────────────────────
process.on('uncaughtException', (e) => err(`uncaughtException : ${e.message}\n${e.stack}`));
process.on('unhandledRejection', (e) => err(`unhandledRejection : ${e}`));
process.on('SIGINT', () => {
  info('Arrêt propre du bot...');
  process.exit(0);
});

// ──────────────────────────────────────────────
//  DÉMARRAGE
// ──────────────────────────────────────────────
(async () => {
  console.log('\n  \x1b[45m\x1b[37m  ⚡ ZENITSU ULTRA BOT — DÉMARRAGE  \x1b[0m\n');
  loadCommands();
  loadEvents();
  await connect();
})();

module.exports = { commands, eventHandlers, stats, CONFIG, subBots };
