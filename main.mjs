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
  EmbedBuilder,
  StringSelectMenuBuilder
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
const HELP_GLOBAL_FILE = "./help_global_config.json"; // <-- 新規ファイル

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
let helpGlobalConfig = loadConfig(HELP_GLOBAL_FILE, { channels: {} }); // { guildId: { normal, raid } }

// ===========================
// 🔧 クールダウン設定（ユーザーごと）
// ===========================
// メモリ上で管理。Bot 再起動でリセットされます。
const userCooldowns = {}; // { userId: lastTimestamp }
const COOLDOWN_MS = 5 * 60 * 1000; // 5分

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
  { name: "youtubestop", description: "YouTube通知を解除" },
  { name: "shu", description: "妖怪ぷにの種族相性表を表示" },
  {
    name: "call",
    description: "通話募集ボタンを設置",
    options: [{ name: "role", type: 8, description: "通話募集するロール", required: true }]
  },

  // お助けグローバルの設定コマンド
  {
    name: "sethelpg",
    description: "お助けグローバルチャンネルを設定（通常 / 乱入）",
    options: [
      { name: "normal", description: "通常募集チャンネル", type: 7, required: true },
      { name: "raid", description: "乱入募集チャンネル", type: 7, required: true }
    ]
  },
  // 追加: お助けグローバル解除コマンド
  {
    name: "unsethelpg",
    description: "お助けグローバル設定を解除（オーナー・副オーナー・管理者）"
  }
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

  // ---- /shu ----
  if (interaction.commandName === "shu") {
    const filePath = "./images/shuzoku.png";
    if (!fs.existsSync(filePath)) {
      return interaction.reply({
        content: "❌ 種族相性表が見つかりません\n`/images/shuzoku.png` を配置してください",
        ephemeral: true
      });
    }
    return interaction.reply({ content: "📊 **妖怪ぷに 種族相性表**はこちら！", files: [filePath] });
  }

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
    return interaction.reply({ content: client.guilds.cache.map(g => `• ${g.name} (${g.id})`).join("\n"), ephemeral: true });
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
    let channelId = null;

    const matchId = url.match(/(?:channel\/|c\/|user\/)([\w-]+)/);
    if (matchId) {
      channelId = matchId[1];
    } else if (url.includes("@")) {
      try {
        const handle = url.split("@")[1].split(/[/?]/)[0];
        const res = await fetch(
          `https://www.googleapis.com/youtube/v3/search?key=${YOUTUBE_API_KEY}&q=${handle}&type=channel&part=snippet`
        );
        const data = await res.json();
        if (!data.items || !data.items.length) {
          return interaction.reply({ content: "❌ YouTubeチャンネルが見つかりません", ephemeral: true });
        }
        channelId = data.items[0].snippet.channelId;
      } catch (err) {
        console.error(err);
        return interaction.reply({ content: "❌ YouTube APIエラー", ephemeral: true });
      }
    } else {
      return interaction.reply({ content: "❌ URL形式が不正です", ephemeral: true });
    }

    youtubeConfig[interaction.guild.id] = { channelId, lastVideoId: null };
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

  // ---- /call ----
  if (interaction.commandName === "call") {
    const role = interaction.options.getRole("role");
    if (!role) return interaction.reply({ content: "❌ ロールが見つかりません", ephemeral: true });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`call_button_${role.id}`).setLabel("通話募集").setStyle(ButtonStyle.Primary)
    );

    await interaction.channel.send({ content: `📞 通話募集ボタン設置: ${role}`, components: [row] });
    return interaction.reply({ content: "✅ 通話募集ボタンを設置しました", ephemeral: true });
  }

  // ---- /sethelpg ---- (新規: お助けグローバル設定)
  if (interaction.commandName === "sethelpg") {
    if (!isOwner && !isAdmin && !isSubOwner && !isSpecial) {
      return interaction.reply({ content: "❌ 権限なし", ephemeral: true });
    }

    const normalCh = interaction.options.getChannel("normal");
    const raidCh = interaction.options.getChannel("raid");

    if (!normalCh || !raidCh) {
      return interaction.reply({ content: "❌ チャンネルを指定してください", ephemeral: true });
    }

    helpGlobalConfig.channels[interaction.guild.id] = {
      normal: normalCh.id,
      raid: raidCh.id
    };
    save(HELP_GLOBAL_FILE, helpGlobalConfig);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("help_global_button")
        .setLabel("🌟 お助け募集する")
        .setStyle(ButtonStyle.Success)
    );

    // === 変更点 ===
    // ボタンは「コマンドを実行したチャンネル」に設置する（設定で指定したチャンネルではない）
    // ただし、元からあった「各チャンネルに何か送る」機能は消さず、設定されたチャンネルには
    // 「設定された通知」的な短いメッセージを送っておきます（ボタンは実行チャンネルのみ）。
    try {
      // 実行したチャンネルにボタンを設置
      if (interaction.channel?.isTextBased())
        await interaction.channel.send({ content: "🌟 お助けメニューが設置されました！ ボタンを押して募集を作成できます。", components: [row] });

      // 設定先チャンネルには「設定された」ことを伝える（ボタンは送らない）
      if (normalCh.isTextBased()) await normalCh.send({ content: "🟢 **通常募集チャンネル** として設定されました（ボタンはコマンド実行チャンネルに設置されます）" });
      if (raidCh.isTextBased()) await raidCh.send({ content: "🔴 **乱入募集チャンネル** として設定されました（ボタンはコマンド実行チャンネルに設置されます）" });
    } catch (err) {
      console.error("sethelpg send error:", err);
    }

    return interaction.reply({ content: "✅ お助けグローバルを設定しました（ボタンはこのチャンネルに設置済み）", ephemeral: true });
  }

  // ---- /unsethelpg ---- (追加: お助けグローバル設定解除)
  if (interaction.commandName === "unsethelpg") {
    if (!isOwner && !isAdmin && !isSubOwner && !isSpecial) {
      return interaction.reply({ content: "❌ 権限なし", ephemeral: true });
    }

    // 設定が存在するか
    if (!helpGlobalConfig.channels || !helpGlobalConfig.channels[interaction.guild.id]) {
      return interaction.reply({ content: "⚠️ このサーバーにはお助けグローバルの設定がありません", ephemeral: true });
    }

    // 削除して保存
    delete helpGlobalConfig.channels[interaction.guild.id];
    save(HELP_GLOBAL_FILE, helpGlobalConfig);

    return interaction.reply({ content: "🗑 お助けグローバルの設定を解除しました", ephemeral: true });
  }
});

// ===========================
// 🌍 メッセージ系機能
// ===========================
client.on("messageCreate", async message => {
  if (message.author.bot) return;

  // -------------------------
  // 新規追加: お助けグローバルチャット（普通メッセージを転送）
  // -------------------------
  try {
    if (message.guild) {
      const guildId = message.guild.id;
      const cfg = helpGlobalConfig.channels?.[guildId];
      if (cfg) {
        const isNormal = message.channel.id === cfg.normal;
        const isRaid = message.channel.id === cfg.raid;

        if (isNormal || isRaid) {
          // 無害化（everyone/here/role）
          const safe = message.content
            .replace(/@everyone/gi, "@\u200Beveryone")
            .replace(/@here/gi, "@\u200Bhere")
            .replace(/<@&\d+>/gi, "@ロール");

          // 添付ファイルの URL 配列
          const files = [...message.attachments.values()].map(att => att.url);

          const embed = new EmbedBuilder()
            .setTitle(isNormal ? "📡 お助けGlobal — 通常" : "📡 お助けGlobal — 乱入")
            .setDescription(`**【${message.guild.name}】${message.author.tag}**\n${safe || "（画像 / 添付のみ）"}`)
            .setColor(isNormal ? 0x00a8ff : 0xff4444)
            .setTimestamp();

          // 送信先：helpGlobalConfig に登録された各サーバーの対応チャンネル
          for (const [otherGid, data] of Object.entries(helpGlobalConfig.channels || {})) {
            if (otherGid === guildId) continue; // 自分のサーバーへは送らない（ループ防止）

            const targetChId = isNormal ? data.normal : data.raid;
            if (!targetChId) continue;

            const g = client.guilds.cache.get(otherGid);
            const ch = g?.channels.cache.get(targetChId);
            if (!ch?.isTextBased()) continue;

            // 送信（添付がある場合は files も送る）
            try {
              if (files.length) {
                // embed + files
                await ch.send({ embeds: [embed], content: files.join("\n") }).catch(() => {});
              } else {
                await ch.send({ embeds: [embed] }).catch(() => {});
              }
            } catch (err) {
              // 送信失敗はログのみ
              console.error(`Failed to send help-global message to guild ${otherGid} ch ${targetChId}:`, err);
            }
          }
        }
      }
    }
  } catch (e) {
    console.error("help-global message handler error:", e);
  }

  // -------------------------
  // 既存のぷにぷにグローバルチャット（元の globalConfig を使った Webhook 転送）
  // -------------------------
  try {
    const guildId = message.guild?.id;
    const setId = guildId ? globalConfig.globalChannels[guildId] : null;
    if (guildId && setId && message.channel.id === setId) {
      const safe = message.content.replace(/@everyone/gi, "@\u200Beveryone").replace(/@here/gi, "@\u200Bhere").replace(/<@&\d+>/gi, "@ロール");
      const files = [...message.attachments.values()].map(att => att.url);

      for (const [otherGuild, chId] of Object.entries(globalConfig.globalChannels)) {
        if (otherGuild === guildId) continue;
        const guild = client.guilds.cache.get(otherGuild);
        const channel = guild?.channels.cache.get(chId);
        if (!channel?.isTextBased()) continue;

        let wh = (await channel.fetchWebhooks()).find(w => w.name === "ぷにぷにグローバル");
        if (!wh) {
          try {
            wh = await channel.createWebhook({ name: "ぷにぷにグローバル", avatar: message.author.displayAvatarURL() });
          } catch (err) {
            console.error("webhook create error:", err);
            continue;
          }
        }

        await wh.send({ username: message.author.username, avatarURL: message.author.displayAvatarURL(), content: safe, files }).catch(() => {});
      }
    }
  } catch (e) {
    console.error("ぷにぷにグローバル handler error:", e);
  }

  // -------------------------
  // お助け募集（既存ローカル仕様）
  // -------------------------
  try {
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
  } catch (e) {
    console.error("お助け募集 handler error:", e);
  }

  // -------------------------
  // しりとり
  // -------------------------
  try {
    const st = shiritoriConfig.channels[message.guild?.id];
    if (st && message.guild && st === message.channel.id && /[んン]$/.test(message.content)) {
      message.delete().catch(() => {});
      message.author.send("❌ 最後に『ん』は禁止です").catch(() => {});
    }
  } catch (e) {
    console.error("しりとり handler error:", e);
  }

  // -------------------------
  // フレンドコード
  // -------------------------
  try {
    if (message.channel.id === FRIEND_CHANNEL_ID && message.content.length !== 8) {
      message.delete().catch(() => {});
      message.channel.send(`${message.author} 8文字だけ送ってください`).then(m => setTimeout(() => m.delete(), 5000));
    }
  } catch (e) {
    console.error("フレンドコード handler error:", e);
  }
});

// ===========================
// ✉️ 通報ボタン + モーダル + DM通知 + 通話ボタン等
// ===========================
client.on("interactionCreate", async interaction => {
  // --- お助けグローバル: ボタン押下（レベル選択メニューを出す） ---
  if (interaction.isButton() && interaction.customId === "help_global_button") {
    const select = new StringSelectMenuBuilder()
      .setCustomId("help_level_select")
      .setPlaceholder("レベルを選択してください")
      .addOptions([
        { label: "通常", value: "通常" },
        ...Array.from({ length: 15 }, (_, i) => ({ label: `${i + 1}`, value: `${i + 1}` }))
      ]);

    const row = new ActionRowBuilder().addComponents(select);
    return interaction.reply({ content: "🎯 レベルを選択してください", components: [row], ephemeral: true });
  }

  // --- お助けグローバル: セレクト選択後 (モーダル表示) ---
  if (interaction.isStringSelectMenu() && interaction.customId === "help_level_select") {
    const level = interaction.values[0];

    const modal = new ModalBuilder().setCustomId(`help_modal_${level}`).setTitle("お助け募集");

    const fcInput = new TextInputBuilder()
      .setCustomId("help_fc")
      .setLabel("フレンドコード（8文字）")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const commentInput = new TextInputBuilder()
      .setCustomId("help_comment")
      .setLabel("ひとこと")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false);

    modal.addComponents(new ActionRowBuilder().addComponents(fcInput), new ActionRowBuilder().addComponents(commentInput));
    return interaction.showModal(modal);
  }

  // --- お助けグローバル: モーダル送信処理 ---
  if (interaction.isModalSubmit() && interaction.customId.startsWith("help_modal_")) {
    // *** 修正ポイント ***
    // モーダル返信は 3 秒以内に reply しないと Unknown interaction になります。
    // そのため最初に deferReply() を呼び、その後重い処理を行い、最後に editReply() する方式に変更しました。
    await interaction.deferReply({ flags: 64 });

    const level = interaction.customId.replace("help_modal_", "");
    const fc = interaction.fields.getTextInputValue("help_fc");
    const comment = interaction.fields.getTextInputValue("help_comment") || "";

    // バリデーション（フレコは8文字）
    if (fc.length !== 8) {
      // すでに deferReply しているので editReply を使う
      await interaction.editReply({ content: "❌ フレコは8文字です" });
      return;
    }

    // ------------------------
    // ここでユーザーごとのクールダウンをチェック
    // ------------------------
    const uid = interaction.user.id;
    const last = userCooldowns[uid] || 0;
    if (Date.now() - last < COOLDOWN_MS) {
      const remaining = COOLDOWN_MS - (Date.now() - last);
      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      await interaction.editReply({
        content: `⏳ まだ募集できません。次に送れるまで **${minutes}分${seconds}秒**`
      });
      return;
    }

    // クールダウン更新（送信が成功する前に更新することで短時間の多重送信を防ぐ）
    userCooldowns[uid] = Date.now();

    const embed = new EmbedBuilder()
      .setTitle(level === "通常" ? "通常" : `レベル${level}`)
      .setDescription(comment || "（コメントなし）")
      .setColor(0x00ffaa)
      .setFooter({ text: `募集者: ${interaction.user.tag}` });

    const isNormal = level === "通常";

    try {
      for (const [gid, data] of Object.entries(helpGlobalConfig.channels)) {
        const targetChId = isNormal ? data.normal : data.raid;
        if (!targetChId) continue;

        const g = client.guilds.cache.get(gid);
        const ch = g?.channels.cache.get(targetChId);
        if (!ch?.isTextBased()) continue;

        await ch.send({ content: fc, embeds: [embed] }).catch(err => {
          console.error(`Failed to send help message to guild ${gid} ch ${targetChId}:`, err);
        });
      }

      // 最後に editReply で確認メッセージを返す
      await interaction.editReply({ content: "✅ 送信しました！" });
    } catch (err) {
      console.error("help_modal send error:", err);
      await interaction.editReply({ content: "❌ 送信中にエラーが発生しました。再度お試しください。" });
    }

    return;
  }

  // ---------------- existing report/modal/call handling ----------------
  if (interaction.isButton() && interaction.customId === "open_report_modal") {
    const modal = new ModalBuilder().setCustomId("report_modal").setTitle("ユーザー通報");
    const userInput = new TextInputBuilder().setCustomId("reported_user").setLabel("通報対象").setStyle(TextInputStyle.Short).setRequired(true);
    const reasonInput = new TextInputBuilder().setCustomId("report_reason").setLabel("通報理由").setStyle(TextInputStyle.Paragraph).setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(userInput), new ActionRowBuilder().addComponents(reasonInput));
    await interaction.showModal(modal);
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId === "report_modal") {
    const reportedText = interaction.fields.getTextInputValue("reported_user");
    const reason = interaction.fields.getTextInputValue("report_reason");
    const owner = await client.users.fetch(interaction.guild.ownerId);
    await owner.send(`🛑 通報がありました\n通報者: ${interaction.user.tag}\n対象者: ${reportedText}\n理由: ${reason}`);
    await interaction.reply({ content: "✅ 通報を送信しました", ephemeral: true });
    return;
  }

  // ---- 通話募集ボタン ----
  if (interaction.isButton() && interaction.customId.startsWith("call_button_")) {
    const roleId = interaction.customId.replace("call_button_", "");
    const role = interaction.guild.roles.cache.get(roleId);
    if (!role) return interaction.reply({ content: "❌ ロールが見つかりません", ephemeral: true });

    await interaction.channel.send({ content: `📢 ${role} の皆さん、通話募集です！` });
    await interaction.reply({ content: "✅ 通話募集メッセージを送信しました", ephemeral: true });
    return;
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
