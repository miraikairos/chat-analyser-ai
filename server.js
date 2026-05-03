console.log("File started...");

const express = require("express");
const multer = require("multer");
const cors = require("cors");

const app = express();
app.use(cors());

const upload = multer({ storage: multer.memoryStorage() });

let chats = [];
/* ========================= */
app.get("/", (req, res) => {
  res.send("Chat Analyzer API running 🚀");
});

/* =========================
   NORMALIZE FUNCTION (KEY FIX)
========================= */
function normalizeTimeAndDate(date, time) {
  try {
    // 🔥 FIX ISO DATE
    if (typeof date === "string" && date.includes("T")) {
      const d = new Date(date);
      date = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
    }

    // 🔥 FIX WEIRD SPACES
    if (typeof time === "string") {
      time = time.replace(/\u202F/g, " ").trim().toLowerCase();
    }

    // 🔥 FORCE am/pm
    if (time && !time.includes(" ")) {
      let h = parseInt(time.split(":")[0]);
      let mod = h >= 12 ? "pm" : "am";
      time = `${time} ${mod}`;
    }

    // ❌ reject invalid
    if (
      !date || !time ||
      !date.includes("/") ||
      !time.includes(":")
    ) return null;

    return { date, time };

  } catch (e) {
    return null;
  }
}

/* =========================
   WhatsApp Parser
========================= */
function parseWhatsApp(text) {
  const lines = text.split("\n");

  const regex =
    /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s(\d{1,2}):(\d{2})(?:\s?([APMapm]{2}))?\s-\s([^:]+):\s(.+)$/;

  return lines.map(line => {
    const match = line.match(regex);
    if (!match) return null;

    let date = match[1].trim();
    let hour = parseInt(match[2]);
    let minute = match[3];
    let modifier = match[4];
    let user = match[5]?.trim();
    let message = match[6]?.trim();

    if (!date || !user || !message) return null;

    // 🔥 FORCE am/pm
    if (!modifier) {
      modifier = hour >= 12 ? "pm" : "am";
    }

    // normalize hour
    if (hour > 12) hour -= 12;
    if (hour === 0) hour = 12;

    let time = `${hour}:${minute} ${modifier.toLowerCase()}`;

    // 🔥 FINAL NORMALIZE
    const normalized = normalizeTimeAndDate(date, time);
    if (!normalized) return null;

    return {
      date: normalized.date,
      time: normalized.time,
      user,
      message,
      senderType: "unknown"
    };

  }).filter(Boolean);
}

/* =========================
   Telegram Parser
========================= */
function parseTelegram(text) {
  const lines = text.split("\n");

  const regex =
    /^\[(\d{1,2}\/\d{1,2}\/\d{4})\s(\d{1,2}):(\d{2})\]\s([^:]+):\s(.+)$/;

  return lines.map(line => {
    const match = line.match(regex);
    if (!match) return null;

    let date = match[1].trim();
    let hour = parseInt(match[2]);
    let minute = match[3];
    let user = match[4]?.trim();
    let message = match[5]?.trim();

    if (!date || !user || !message) return null;

    let modifier = hour >= 12 ? "pm" : "am";

    if (hour > 12) hour -= 12;
    if (hour === 0) hour = 12;

    let time = `${hour}:${minute} ${modifier}`;

    const normalized = normalizeTimeAndDate(date, time);
    if (!normalized) return null;

    return {
      date: normalized.date,
      time: normalized.time,
      user,
      message,
      senderType: "unknown"
    };

  }).filter(Boolean);
}

/* ========================= */
function detectAndParse(text) {
  let parsed = parseWhatsApp(text);
  if (parsed.length > 0) return parsed;
  return parseTelegram(text);
}

/* ========================= */
function classifySenders(messages) {
  if (!messages.length) return messages;

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
  console.log("🔥 NEW BACKEND RUNNING");
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const text = req.file.buffer.toString("utf-8");

    let parsed = detectAndParse(text);

    // 🔥 FINAL SAFETY NORMALIZATION (CATCH ANY LEFTOVER BUG)
    parsed = parsed.map(m => {
      const fixed = normalizeTimeAndDate(m.date, m.time);
      if (!fixed) return null;

      return {
        ...m,
        date: fixed.date,
        time: fixed.time
      };
    }).filter(Boolean);

    // 🔥 DEBUG (IMPORTANT)
    console.log("SAMPLE CLEAN DATA:", parsed.slice(0,5));

    if (!parsed.length) {
      return res.status(400).json({
        error: "Unsupported or empty chat file",
      });
    }

    parsed = classifySenders(parsed);
    chats = parsed;
    console.log("FINAL DATA SENT:", parsed[0]);
    res.json({
      totalMessages: parsed.length,
      users: [...new Set(parsed.map((m) => m.user))],
      data: parsed,
    });

  } catch (err) {
    console.error("ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ========================= */
app.get("/stats", (req, res) => {
  const userCount = {};

  chats.forEach((msg) => {
    userCount[msg.user] = (userCount[msg.user] || 0) + 1;
  });

  res.json({
    totalMessages: chats.length,
    userCount,
  });
});

/* ========================= */
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});