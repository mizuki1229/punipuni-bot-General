import "dotenv/config";
import express from "express";
import fs from "fs";
import fetch from "node-fetch";
import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField,
  EmbedBuilder
} from "discord.js";

// ===========================
// ⚙️ 環境変数
// ===========================
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

if (!TOKEN || !CLIENT_ID) {
  console.error("❌ DISCORD_TOKEN または CLIENT_ID が読み込めません");
  process.exit(1);
}

// ===========================
// 権限・チャンネル設定
// ===========================
const MODERATOR_ROLE_ID = "1408582722200277034";
const SUB_OWNER_ROLE_ID = "1435274218009792574";
const FRIEND_CHANNEL_ID = "1406981949410508821";
const SPECIAL_USER_IDS = ["1243898371014525009"];

// ===========================
// 🌐 Express keep alive
// ===========================
const app = express();
app.get("/", (_, res) => res.send("Bot is running!"));
app.listen(3000, () => console.log("🌐 Webサーバー起動: 3000"));

// ===========================
// 🤖 Discord Client
// ===========================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

// ===========================
// 📁 設定ファイル
// ===========================
const GLOBAL_CONFIG_FILE = "./global_config.json";
const REPORT_CONFIG_FILE = "./report_config.json";
const SHIRITORI_FILE = "./shiritori_config.json";
const YOUTUBE_CONFIG_FILE = "./youtube_config.json";

function loadConfig(file, def) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(def, null, 2));
  return JSON.parse(fs.readFileSync(file));
}
function save(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let globalConfig = loadConfig(GLOBAL_CONFIG_FILE, { globalChannels: {} });
let reportConfig = loadConfig(REPORT_CONFIG_FILE, { reportChannels: {} });
let shiritoriConfig = loadConfig(SHIRITORI_FILE, { channels: {} });
let youtubeConfig = loadConfig(YOUTUBE_CONFIG_FILE, {}); // { guildId: { channelId, lastVideoId } }

// ===========================
// 🔧 Slash Commands
// ===========================
const commands = [
  {
    name: "dm",
    description: "指定したユーザーにDM送信（オーナー・モデレーター）",
    options: [
      { name: "user", type: 6, description: "相手", required: true },
      { name: "message", type: 3, description: "内容", required: true }
    ]
  },
  { name: "setglobal", description: "グローバルチャット設定（オーナー・副オーナー・管理者）" },
  { name: "unsetglobal", description: "グローバルチャット解除（オーナー・副オーナー・管理者）" },
  { name: "setreportchannel", description: "通報チャンネル設定（オーナー・管理者）" },
  { name: "listservers", description: "参加中サーバー一覧（特別ユーザー）" },
  { name: "setshiritori", description: "しりとりチャンネル設定（オーナー・副オーナー・管理者）" },
  {
    name: "youtube",
    description: "このチャンネルにYouTube通知を設定",
    options: [{ name: "url", type: 3, description: "チャンネルURL", required: true }]
  },
  { name: "youtubestop", description: "YouTube通知を解除" }
];

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log("✅ スラッシュコマンド登録完了");
}

// ===========================
// 🤖 Ready
// ===========================
client.once("ready", () => {
  console.log(`🤖 Bot logged in as ${client.user.tag}`);
  startYouTubePolling();
});

// ===========================
// 🏷️ Slash Command Handler
// ===========================
client.on("interactionCreate", async interaction => {
  if (!interaction.isCommand()) return;

  const member = interaction.member;
  const ownerId = interaction.guild.ownerId;
  const isOwner = interaction.user.id === ownerId;
  const isSubOwner = member.roles.cache.has(SUB_OWNER_ROLE_ID);
  const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
  const isMod = member.roles.cache.has(MODERATOR_ROLE_ID);
  const isSpecial = SPECIAL_USER_IDS.includes(interaction.user.id);

  // ---- /dm ----
  if (interaction.commandName === "dm") {
    if (!isOwner && !isMod && !isSpecial) return interaction.reply({ content: "❌ 権限なし", ephemeral: true });
    const user = interaction.options.getUser("user");
    const msg = interaction.options.getString("message");
    await user.send(msg).catch(() => {});
    return interaction.reply({ content: `📨 ${user.tag} に送信しました`, ephemeral: true });
  }

  // ---- /setglobal ----
  if (interaction.commandName === "setglobal") {
    if (!isOwner && !isSubOwner && !isAdmin && !isSpecial) return interaction.reply({ content: "❌ 権限なし", ephemeral: true });
    globalConfig.globalChannels[interaction.guild.id] = interaction.channel.id;
    save(GLOBAL_CONFIG_FILE, globalConfig);
    return interaction.reply("🌍 このチャンネルをぷにぷにに設定しました");
  }

  // ---- /unsetglobal ----
  if (interaction.commandName === "unsetglobal") {
    if (!isOwner && !isSubOwner && !isAdmin && !isSpecial) return interaction.reply({ content: "❌ 権限なし", ephemeral: true });
    delete globalConfig.globalChannels[interaction.guild.id];
    save(GLOBAL_CONFIG_FILE, globalConfig);
    return interaction.reply("🗑 解除しました");
  }

  // ---- /setreportchannel ----
  if (interaction.commandName === "setreportchannel") {
    if (!isOwner && !isSubOwner && !isAdmin && !isSpecial) return interaction.reply({ content: "❌ 権限なし", ephemeral: true });
    reportConfig.reportChannels[interaction.guild.id] = interaction.channel.id;
    save(REPORT_CONFIG_FILE, reportConfig);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("open_report_modal").setLabel("通報する").setStyle(ButtonStyle.Danger)
    );
    await interaction.channel.send({ content: "🔔 通報はこちら", components: [row] });
    return interaction.reply("📌 通報チャンネル設定しました");
  }

  // ---- /listservers ----
  if (interaction.commandName === "listservers") {
    if (!isSpecial) return interaction.reply({ content: "❌ 特別ユーザーのみ", ephemeral: true });
    return interaction.reply({
      content: client.guilds.cache.map(g => `• ${g.name} (${g.id})`).join("\n"),
      ephemeral: true
    });
  }

  // ---- /setshiritori ----
  if (interaction.commandName === "setshiritori") {
    if (!isOwner && !isSubOwner && !isAdmin && !isSpecial) return interaction.reply({ content: "❌ 権限なし", ephemeral: true });
    shiritoriConfig.channels[interaction.guild.id] = interaction.channel.id;
    save(SHIRITORI_FILE, shiritoriConfig);
    return interaction.reply("⭕ このチャンネルをしりとり対象に設定しました");
  }

  // ---- /youtube ----
  if (interaction.commandName === "youtube") {
    if (!isOwner && !isSubOwner && !isAdmin) return interaction.reply({ content: "❌ 権限なし", ephemeral: true });
    const url = interaction.options.getString("url");
    const match = url.match(/(?:channel\/|c\/|user\/)([\w-]+)/);
    if (!match) return interaction.reply({ content: "❌ URL形式が不正です", ephemeral: true });
    youtubeConfig[interaction.guild.id] = { channelId: match[1], lastVideoId: null };
    save(YOUTUBE_CONFIG_FILE, youtubeConfig);
    return interaction.reply({ content: "📺 YouTube通知チャンネルを設定しました", ephemeral: true });
  }

  // ---- /youtubestop ----
  if (interaction.commandName === "youtubestop") {
    if (!isOwner && !isSubOwner && !isAdmin) return interaction.reply({ content: "❌ 権限なし", ephemeral: true });
    delete youtubeConfig[interaction.guild.id];
    save(YOUTUBE_CONFIG_FILE, youtubeConfig);
    return interaction.reply({ content: "🛑 YouTube通知を解除しました", ephemeral: true });
  }
});

// ===========================
// 🌍 グローバルチャット / お助け募集 / しりとり / フレコ
// ===========================
client.on("messageCreate", async message => {
  if (message.author.bot) return;

  // グローバルチャット
  const guildId = message.guild.id;
  const setId = globalConfig.globalChannels[guildId];
  if (setId && message.channel.id === setId) {
    const safe = message.content.replace(/@everyone/gi, "@\u200Beveryone")
                                .replace(/@here/gi, "@\u200Bhere")
                                .replace(/<@&\d+>/gi, "@ロール");
    const files = [...message.attachments.values()].map(att => att.url);

    for (const [otherGuild, chId] of Object.entries(globalConfig.globalChannels)) {
      if (otherGuild === guildId) continue;
      const guild = client.guilds.cache.get(otherGuild);
      const channel = guild?.channels.cache.get(chId);
      if (!channel?.isTextBased()) continue;

      let wh = (await channel.fetchWebhooks()).find(w => w.name === "ぷにぷにグローバル");
      if (!wh)
        wh = await channel.createWebhook({ name: "ぷにぷにグローバル", avatar: message.author.displayAvatarURL() });

      await wh.send({
        username: message.author.username,
        avatarURL: message.author.displayAvatarURL(),
        content: safe,
        files
      });
    }
  }

  // お助け募集レベル分け
  if (message.channel.name === "お助け募集") {
    const match = message.content.match(/^#(\d+)\s(.{8})(?:\s+([\s\S]*))?/);
    if (!match) { await message.delete().catch(() => {}); return; }
    const level = parseInt(match[1], 10);
    const fc = match[2]; const text = match[3] || "";
    let targetName = null;
    if (level === 0) targetName = "お助け通常";
    else if (level >= 1 && level <= 4) targetName = "レベル1～4";
    else if (level >= 5 && level <= 7) targetName = "レベル5～7";
    else if (level >= 8 && level <= 10) targetName = "レベル8～10";
    else if (level >= 11 && level <= 15) targetName = "レベル11～15";
    else { const warn = await message.channel.send("⚠️ このレベルは無効です"); setTimeout(() => warn.delete().catch(() => {}), 5000); await message.delete().catch(() => {}); return; }

    const targetChannel = message.guild.channels.cache.find(ch => ch.name === targetName && ch.isTextBased());
    if (targetChannel) {
      if (level === 0) await targetChannel.send(fc);
      else await targetChannel.send({ content: fc, embeds: [{ title: `レベル${level}`, description: text, color: 0x00aa00 }] });
    }
    await message.delete().catch(() => {});
  }

  // しりとり
  const st = shiritoriConfig.channels[message.guild.id];
  if (st && st === message.channel.id && /[んン]$/.test(message.content)) {
    message.delete().catch(() => {});
    message.author.send("❌ 最後に『ん』は禁止です").catch(() => {});
  }

  // フレンドコード
  if (message.channel.id === FRIEND_CHANNEL_ID && message.content.length !== 8) {
    message.delete().catch(() => {});
    message.channel.send(`${message.author} 8文字だけ送ってください`).then(m => setTimeout(() => m.delete(), 5000));
  }
});

// ===========================
// ✉️ 通報ボタン + モーダル + DM通知
// ===========================
client.on("interactionCreate", async interaction => {
  if (interaction.isButton() && interaction.customId === "open_report_modal") {
    const modal = new ModalBuilder().setCustomId("report_modal").setTitle("ユーザー通報");
    const userInput = new TextInputBuilder().setCustomId("reported_user").setLabel("通報対象").setStyle(TextInputStyle.Short).setRequired(true);
    const reasonInput = new TextInputBuilder().setCustomId("report_reason").setLabel("通報理由").setStyle(TextInputStyle.Paragraph).setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(userInput), new ActionRowBuilder().addComponents(reasonInput));
    await interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId === "report_modal") {
    const reportedText = interaction.fields.getTextInputValue("reported_user");
    const reason = interaction.fields.getTextInputValue("report_reason");
    const owner = await client.users.fetch(interaction.guild.ownerId);
    await owner.send(`🛑 通報がありました\n通報者: ${interaction.user.tag}\n対象者: ${reportedText}\n理由: ${reason}`);
    await interaction.reply({ content: "✅ 通報を送信しました", ephemeral: true });
  }
});

// ===========================
// 📺 YouTube通知
// ===========================
async function checkYouTubeChannel(guildId, channelId) {
  const url = `https://www.googleapis.com/youtube/v3/search?key=${YOUTUBE_API_KEY}&channelId=${channelId}&part=snippet,id&order=date&maxResults=1`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.items || !data.items.length) return;
  const video = data.items[0];
  const videoId = video.id.videoId;
  if (youtubeConfig[guildId]?.lastVideoId === videoId) return;

  youtubeConfig[guildId].lastVideoId = videoId;
  save(YOUTUBE_CONFIG_FILE, youtubeConfig);

  const ch = client.channels.cache.get(youtubeConfig[guildId].channelId);
  if (!ch?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setTitle(video.snippet.title)
    .setURL(`https://youtu.be/${videoId}`)
    .setAuthor({ name: video.snippet.channelTitle })
    .setDescription(video.snippet.description || "(説明なし)")
    .setThumbnail(video.snippet.thumbnails?.high?.url)
    .setTimestamp(new Date(video.snippet.publishedAt));

  await ch.send({ content: "📺 新着YouTube動画", embeds: [embed] });
}

function startYouTubePolling() {
  setInterval(() => {
    Object.entries(youtubeConfig).forEach(([guildId, cfg]) => checkYouTubeChannel(guildId, cfg.channelId).catch(console.error));
  }, 60_000);
}

// ===========================
// 🚀 Bot 起動
// ===========================
(async () => {
  await registerCommands();
  client.login(TOKEN);
})();


