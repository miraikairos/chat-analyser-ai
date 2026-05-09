const express = require("express");
const multer = require("multer");
const cors = require("cors");
const cheerio = require("cheerio");

const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

app.options("*", cors()); // important for preflight

const upload = multer({ storage: multer.memoryStorage() });

let chats = [];

app.get("/", (req, res) => {
  res.send("Chat Analyzer API running 🚀");
});

/* =========================
   NORMALIZE
========================= */
function normalizeTimeAndDate(date, time) {
  try {
    // Fix ISO-like date
    if (typeof date === "string" && date.includes("T")) {
      const d = new Date(date);
      date = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
    }

    // Clean spaces
    if (typeof time === "string") {
      time = time.replace(/\u202F/g, " ").trim().toLowerCase();
    }

    // Force am/pm if missing
    if (time && !time.includes(" ")) {
      let h = parseInt(time.split(":")[0], 10);
      let mod = h >= 12 ? "pm" : "am";
      time = `${time} ${mod}`;
    }

    if (
      !date ||
      !time ||
      !date.includes("/") ||
      !time.includes(":")
    ) {
      return null;
    }

    return { date, time };
  } catch {
    return null;
  }
}

/* =========================
   WHATSAPP (plain text)
========================= */
function parseWhatsApp(text) {
  const lines = String(text).split("\n");
  const regex =
    /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s(\d{1,2}):(\d{2})(?:\s?([APMapm]{2}))?\s-\s([^:]+):\s(.+)$/;

  return lines
    .map((line) => {
      const match = line.match(regex);
      if (!match) return null;

      let date = match[1].trim();
      let hour = parseInt(match[2], 10);
      let minute = match[3];
      let modifier = match[4];
      let user = match[5]?.trim();
      let message = match[6]?.trim();

      if (!date || !user || !message) return null;

      if (!modifier) {
        modifier = hour >= 12 ? "pm" : "am";
      }

      if (hour > 12) hour -= 12;
      if (hour === 0) hour = 12;

      const time = `${hour}:${minute} ${String(modifier).toLowerCase()}`;

      const normalized = normalizeTimeAndDate(date, time);
      if (!normalized) return null;

      return {
        date: normalized.date,
        time: normalized.time,
        user,
        message,
        senderType: "unknown",
      };
    })
    .filter(Boolean);
}

/* =========================
   INSTAGRAM (JSON export)
========================= */
function cleanInstagramText(text = "") {

  return text
    .replace(/ð[\s\S]{0,4}/g, "")
    .replace(/�/g, "")
    .replace(/You sent an attachment\./gi, "")
    .replace(/Reacted .*? to your message/gi, "")
    .replace(/sent an attachment\./gi, "")
    .replace(/https?:\/\/\S+/g, "")
    .trim();
}
function parseInstagram(jsonData) {
  try {
    if (!jsonData?.messages) return [];

    const messages = jsonData.messages
      .map((msg) => {
        if (!msg?.sender_name || !msg?.timestamp_ms) return null;
        if (!msg?.content) return null;

        const dateObj = new Date(msg.timestamp_ms);

        let hour = dateObj.getHours();
        let minute = String(dateObj.getMinutes()).padStart(2, "0");
        let modifier = hour >= 12 ? "pm" : "am";

        if (hour > 12) hour -= 12;
        if (hour === 0) hour = 12;

        const date = `${dateObj.getDate()}/${dateObj.getMonth() + 1}/${dateObj.getFullYear()}`;
        const time = `${hour}:${minute} ${modifier}`;

        return {
          date,
          time,
          user: cleanInstagramText(msg.sender_name),
message: cleanInstagramText(msg.content),
          senderType: "unknown",
        };
      })
      .filter(Boolean)
.filter(m => m.message && m.message.length > 0)
.reverse();

    return messages;
  } catch {
    return [];
  }
}

/* =========================
   TELEGRAM (JSON)
========================= */
function parseTelegram(jsonData) {
  try {
    if (!jsonData?.messages) return [];

    const parsed = jsonData.messages
      .map((msg) => {
        if (!msg?.from || !msg?.date) return null;

        let message = "";

        // text can be string or array
        if (typeof msg.text === "string") {
          message = msg.text;
        } else if (Array.isArray(msg.text)) {
          message = msg.text
            .map((t) => (typeof t === "string" ? t : t?.text || ""))
            .join("");
        }

        if (!message || !message.trim()) return null;

        const dateObj = new Date(msg.date * 1000);
        let hour = dateObj.getHours();
        let minute = String(dateObj.getMinutes()).padStart(2, "0");
        let modifier = hour >= 12 ? "pm" : "am";

        if (hour > 12) hour -= 12;
        if (hour === 0) hour = 12;

        const date = `${dateObj.getDate()}/${dateObj.getMonth() + 1}/${dateObj.getFullYear()}`;
        const time = `${hour}:${minute} ${modifier}`;

        return {
          date,
          time,
          user: msg.from,
          message: message.trim(),
          senderType: "unknown",
        };
      })
      .filter(Boolean);

    return parsed;
  } catch {
    return [];
  }
}

/* =========================
   TELEGRAM (HTML)
========================= */
function parseTelegramHTML(html) {
  try {
    const $ = cheerio.load(html);
    const parsed = [];

    // Telegram HTML export uses .message rows
    $(".message").each((_, el) => {
      const $el = $(el);
      if ($el.hasClass("service")) return;

      const user = $el.find(".from_name").first().text().trim();
      const text = $el.find(".text").text().trim();
      const dateText = $el.find(".date").attr("title");

      if (!user || !text || !dateText) return;

      const dateObj = new Date(dateText);
      let hour = dateObj.getHours();
      let minute = String(dateObj.getMinutes()).padStart(2, "0");
      let modifier = hour >= 12 ? "pm" : "am";

      if (hour > 12) hour -= 12;
      if (hour === 0) hour = 12;

      const date = `${dateObj.getDate()}/${dateObj.getMonth() + 1}/${dateObj.getFullYear()}`;
      const time = `${hour}:${minute} ${modifier}`;

      const normalized = normalizeTimeAndDate(date, time);
      if (!normalized) return;

      parsed.push({
        date: normalized.date,
        time: normalized.time,
        user,
        message: text,
        senderType: "unknown",
      });
    });

    return parsed;
  } catch {
    return [];
  }
}

/* =========================
   DETECT & PARSE
========================= */
function detectAndParse(content, filenameLower) {
  // JSON
  if (filenameLower.endsWith(".json")) {
    try {
      const json = JSON.parse(content);

      // Instagram heuristic
      if (json?.messages?.[0]?.sender_name) {
        const insta = parseInstagram(json);
        if (insta.length) return insta;
      }

      // Telegram heuristic
      if (json?.messages?.[0]?.from) {
        const telegram = parseTelegram(json);
        if (telegram.length) return telegram;
      }

      return [];
    } catch {
      return [];
    }
  }

  // HTML
  if (filenameLower.endsWith(".html")) {
    if (content.includes("from_name") && content.includes("message")) {
      const telegramHTML = parseTelegramHTML(content);
      if (telegramHTML.length) return telegramHTML;
    }
    return [];
  }

  // Plain text (WhatsApp)
  if (filenameLower.endsWith(".txt") || true) {
    const whatsapp = parseWhatsApp(content);
    if (whatsapp.length) return whatsapp;
    return [];
  }

  return [];
}

function classifySenders(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  const firstUser = messages[0].user;

  return messages.map((msg) => ({
    ...msg,
    senderType: msg.user === firstUser ? "me" : "other",
  }));
}

/* =========================
   API
========================= */
app.post("/analyse", upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const text = req.file.buffer.toString("utf-8");
    const filenameLower = String(req.file.originalname || "").toLowerCase();

    let parsed = detectAndParse(text, filenameLower);

    // Safety normalization
    parsed = parsed
      .map((m) => {
        const fixed = normalizeTimeAndDate(m.date, m.time);
        if (!fixed) return null;
        return { ...m, date: fixed.date, time: fixed.time };
      })
      .filter(Boolean);

    if (!parsed.length) {
      return res.status(400).json({ error: "Unsupported or empty chat file" });
    }

    parsed = classifySenders(parsed);
    chats = parsed;

    return res.json({
      totalMessages: parsed.length,
      users: [...new Set(parsed.map((m) => m.user))],
      data: parsed,
    });
  } catch (err) {
    console.error("/analyse error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.get("/stats", (req, res) => {
  const userCount = {};
  chats.forEach((msg) => {
    userCount[msg.user] = (userCount[msg.user] || 0) + 1;
  });

  res.json({ totalMessages: chats.length, userCount });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});

