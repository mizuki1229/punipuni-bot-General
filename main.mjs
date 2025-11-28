import "dotenv/config";
import express from "express";
import fs from "fs";
import { google } from "googleapis";
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
  PermissionsBitField
} from "discord.js";

// ===========================
// ⚙️ 環境変数
// ===========================
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

const MODERATOR_ROLE_ID = "1408582722200277034";
const FRIEND_CHANNEL_ID = "1406981949410508821";
const SUB_OWNER_ROLE_ID = "1435274218009792574";

// 特別権限ユーザー
const SPECIAL_USER_IDS = ["1243898371014525009"];

if (!TOKEN || !CLIENT_ID || !YOUTUBE_API_KEY) {
  console.error("❌ 必要な環境変数が読み込めません");
  process.exit(1);
}

// ===========================
// 🌐 Express
// ===========================
const app = express();
const port = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("Bot is running!"));
app.listen(port, () => console.log(`🌐 Webサーバー起動: ${port}`));

// ===========================
// 🤖 Discord Client
// ===========================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// ===========================
// 📁 設定ファイル
// ===========================
const GLOBAL_CONFIG_FILE = "./global_config.json";
const REPORT_CONFIG_FILE = "./report_config.json";
const SHIRITORI_FILE = "./shiritori_config.json";
const YOUTUBE_CONFIG_FILE = "./youtube_config.json";

function loadConfig(file, defaultData) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(defaultData, null, 2));
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function saveConfig(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let globalConfig = loadConfig(GLOBAL_CONFIG_FILE, { globalChannels: {} });
let reportConfig = loadConfig(REPORT_CONFIG_FILE, { reportChannels: {} });
let shiritoriConfig = loadConfig(SHIRITORI_FILE, { channels: {} });
let youtubeConfig = loadConfig(YOUTUBE_CONFIG_FILE, { servers: {} });

// ===========================
// 🔧 スラッシュコマンド
// ===========================
const commands = [
  {
    name: "dm",
    description: "指定したユーザーにDMを送信（オーナー＋モデレーター限定）",
    options: [
      { name: "user", description: "DM を送る相手", type: 6, required: true },
      { name: "message", description: "送信内容", type: 3, required: true }
    ]
  },
  { name: "setglobal", description: "グローバルチャットのチャンネルを設定（オーナー＋副オーナー＋管理者権限）" },
  { name: "unsetglobal", description: "グローバルチャット設定を解除（オーナー＋副オーナー＋管理者権限）" },
  { name: "setreportchannel", description: "通報チャンネルを設定（オーナー限定）" },
  { name: "listservers", description: "このBotが入っているサーバーを確認（特別ユーザーのみ）" },
  { name: "setshiritori", description: "このチャンネルをしりとり対象に設定（オーナー＋副オーナー＋管理者権限）" },
  { name: "youtube", description: "このサーバーでYouTube通知を設定", options: [{ name: "url", description: "YouTubeチャンネルURL", type: 3, required: true }] },
  { name: "youtube-unset", description: "このサーバーのYouTube通知を解除" }
];

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ スラッシュコマンド登録完了");
  } catch (err) {
    console.error("❌ コマンド登録失敗:", err);
  }
}

// ===========================
// 📌 Bot ready
// ===========================
client.once("ready", () => console.log(`🤖 Bot logged in as ${client.user.tag}`));

// ===========================
// ✉️ スラッシュコマンド処理
// ===========================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) return;
  const member = interaction.member;
  const guildOwnerId = interaction.guild.ownerId;
  const isOwner = interaction.user.id === guildOwnerId;
  const isSubOwner = member.roles.cache.has(SUB_OWNER_ROLE_ID);
  const isSpecialUser = SPECIAL_USER_IDS.includes(interaction.user.id);
  const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);

  // --- 各コマンド処理 /dm, /setglobal, /unsetglobal, /setreportchannel, /listservers, /setshiritori, /youtube, /youtube-unset ---
});

// ===========================
// 🌐 メッセージ処理
// ===========================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // --- グローバルチャットリレー ---
  // --- フレンドコードチェック ---
  
  // --- お助け募集振り分け（レベル分別） ---
  if (message.channel.name === "お助け募集") {
    const match = message.content.match(/^#(\d+)\s(.{8})(?:\s+([\s\S]*))?/);
    if (!match) { await message.delete().catch(() => {}); return; }

    const level = parseInt(match[1], 10);
    const userIdLike = match[2];
    const restText = match[3] || "";
    let targetChannelName = null;
    if (level === 0) targetChannelName = "お助け通常";
    else if (level >= 1 && level <= 4) targetChannelName = "レベル1～4";
    else if (level >= 5 && level <= 7) targetChannelName = "レベル5～7";
    else if (level >= 8 && level <= 10) targetChannelName = "レベル8～10";
    else if (level >= 11 && level <= 15) targetChannelName = "レベル11～15";
    else if (level >= 16) {
      const warn = await message.channel.send("⚠️ このレベルは無効です");
      setTimeout(() => warn.delete().catch(() => {}), 5000);
      await message.delete().catch(() => {});
      return;
    }

    const targetChannel = message.guild.channels.cache.find(ch => ch.name === targetChannelName && ch.isTextBased());
    if (targetChannel) {
      if (level === 0) await targetChannel.send(userIdLike);
      else await targetChannel.send({ content: userIdLike, embeds: [{ title: `レベル${level}`, description: restText || "（本文なし）", color: 0x00aa00 }] });
    }

    await message.delete().catch(() => {});
  }

  // --- 強化しりとり機能 ---
  const shiritoriChannelId = shiritoriConfig.channels[message.guild.id];
  if (shiritoriChannelId && message.channel.id === shiritoriChannelId) {
    const content = message.content.trim();
    if (/[んン][\s.,]*$/u.test(content)) {
      try {
        await message.delete();
        await message.author.send("文末に「ん」または「ン」が付いたためメッセージを削除しました");
      } catch (err) {
        console.error("しりとりDM送信エラー:", err);
      }
    }
  }
});

// ===========================
// ✉️ 通報ボタン & モーダル
// ===========================
client.on("interactionCreate", async (interaction) => {
  if (interaction.isButton() && interaction.customId === "open_report_modal") {
    const modal = new ModalBuilder().setCustomId("report_modal").setTitle("ユーザー通報");
    const userInput = new TextInputBuilder()
      .setCustomId("reported_user")
      .setLabel("通報対象のユーザー名またはメンション")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("例: username#1234 または @username")
      .setRequired(true);
    const reasonInput = new TextInputBuilder()
      .setCustomId("report_reason")
      .setLabel("通報理由")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("違反内容を詳しく書いてください")
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(userInput), new ActionRowBuilder().addComponents(reasonInput));
    await interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId === "report_modal") {
    const reportedText = interaction.fields.getTextInputValue("reported_user");
    const reason = interaction.fields.getTextInputValue("report_reason");
    const owner = await client.users.fetch(interaction.guild.ownerId);

    await owner.send(`🛑 通報がありました
通報者: ${interaction.user.tag}
対象者: ${reportedText}
理由: ${reason}`);
    await interaction.reply({ content: "✅ 通報を送信しました。ありがとうございます", ephemeral: true });
  }
});

// ===========================
// 🚀 Bot 起動
// ===========================
(async () => {
  await registerCommands();
  client.login(TOKEN);
})();
