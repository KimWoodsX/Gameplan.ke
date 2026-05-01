const path = require("path");
const fs = require("fs");
const express = require("express");
const fetch = require("node-fetch");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Separate security keys: one for admin auth, one for AI chatbot
const ADMIN_KEY = process.env.ADMIN_DASHBOARD_KEY || "2007";
const AI_API_KEY = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "";
const AI_MODEL = "gpt-4o-mini";

// --- In-memory rate limiter ---
// Stores { count, resetAt } per "namespace:ip" key.
const _rateLimitStore = new Map();
// Prune expired entries every 5 minutes so the Map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of _rateLimitStore) {
    if (now > entry.resetAt) _rateLimitStore.delete(key);
  }
}, 5 * 60 * 1000).unref();

/**
 * Returns true if the request is within the allowed rate, false if it should be blocked.
 * Uses X-Forwarded-For when available so it works correctly behind a reverse proxy.
 * @param {import('express').Request} req
 * @param {string}  id       - Limiter namespace (e.g. "chat", "admin-login")
 * @param {number}  limit    - Maximum requests allowed inside the window
 * @param {number}  windowMs - Window duration in milliseconds
 */
function checkRateLimit(req, id, limit, windowMs) {
  const forwarded = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = forwarded || (req.socket && req.socket.remoteAddress) || "unknown";
  const key = `${id}:${ip}`;
  const now = Date.now();
  const entry = _rateLimitStore.get(key);
  if (!entry || now > entry.resetAt) {
    _rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

// Detect Vercel environment — its filesystem is read-only except for /tmp
const IS_VERCEL = !!(process.env.VERCEL || process.env.VERCEL_ENV);

// On Vercel use /tmp/data (writable ephemeral storage).
// Locally use the project root data/ folder so data persists between restarts.
// NOTE: server.js lives inside api/, so __dirname === <project>/api — go up one level.
const dataDir = IS_VERCEL ? "/tmp/data" : path.join(__dirname, "..", "data");
// Always keep a reference to the bundled data directory so we can seed /tmp on cold start
const _bundledDataDir = path.join(__dirname, "..", "data");

// Simple JSON log storage and JSON-based admin data
const chatsPath = path.join(dataDir, "chats.json");
const productsPath = path.join(dataDir, "products.json");
const settingsPath = path.join(dataDir, "settings.json");
const repairsPath = path.join(dataDir, "repairs.json");
const bookingsPath = path.join(dataDir, "bookings.json");
const servicesPath = path.join(dataDir, "services.json");
const techniciansPath = path.join(dataDir, "technicians.json");
const ordersPath = path.join(dataDir, "orders.json");
const promotionsPath = path.join(dataDir, "promotions.json");
const notificationsPath = path.join(dataDir, "notifications.json");
const repairNotificationsPath = path.join(dataDir, "repairNotifications.json");
const bookingNotificationsPath = path.join(dataDir, "bookingNotifications.json");
const wishlistItemsPath = path.join(dataDir, "wishlistItems.json");
const logsPath = path.join(dataDir, "logs.json");
const blockedDatesPath = path.join(dataDir, "blockedDates.json");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  // On Vercel cold start, copy all bundled JSON data files to /tmp/data
  // so the product catalog, settings, and any seeded data are immediately available.
  if (IS_VERCEL && fs.existsSync(_bundledDataDir)) {
    try {
      fs.readdirSync(_bundledDataDir).forEach((file) => {
        if (!file.endsWith(".json")) return;
        const src = path.join(_bundledDataDir, file);
        const dest = path.join(dataDir, file);
        if (fs.existsSync(src) && !fs.existsSync(dest)) {
          fs.copyFileSync(src, dest);
        }
      });
      console.log("[INFO] Seeded /tmp/data from bundled data files.");
    } catch (e) {
      console.warn("[WARN] Could not seed /tmp/data:", e.message);
    }
  }
}
if (!fs.existsSync(chatsPath)) {
  fs.writeFileSync(chatsPath, "[]", "utf8");
}
if (!fs.existsSync(repairsPath)) {
  fs.writeFileSync(repairsPath, "[]", "utf8");
}
if (!fs.existsSync(bookingsPath)) {
  fs.writeFileSync(bookingsPath, "[]", "utf8");
}
if (!fs.existsSync(servicesPath)) {
  fs.writeFileSync(servicesPath, "[]", "utf8");
}
if (!fs.existsSync(techniciansPath)) {
  fs.writeFileSync(techniciansPath, "[]", "utf8");
}
if (!fs.existsSync(ordersPath)) {
  fs.writeFileSync(ordersPath, "[]", "utf8");
}
if (!fs.existsSync(promotionsPath)) {
  fs.writeFileSync(promotionsPath, "[]", "utf8");
}
if (!fs.existsSync(notificationsPath)) {
  fs.writeFileSync(notificationsPath, "[]", "utf8");
}
if (!fs.existsSync(repairNotificationsPath)) {
  fs.writeFileSync(repairNotificationsPath, "[]", "utf8");
}
if (!fs.existsSync(wishlistItemsPath)) {
  fs.writeFileSync(wishlistItemsPath, "[]", "utf8");
}
if (!fs.existsSync(logsPath)) {
  fs.writeFileSync(logsPath, "[]", "utf8");
}
if (!fs.existsSync(blockedDatesPath)) {
  fs.writeFileSync(blockedDatesPath, "[]", "utf8");
}
if (!fs.existsSync(bookingNotificationsPath)) {
  fs.writeFileSync(bookingNotificationsPath, "[]", "utf8");
}
if (!fs.existsSync(settingsPath)) {
  const defaultSettings = {
    delivery: {
      nairobi24h: true,
    },
    ai: {
      dynamicPricingSuggestions: false,
      chatbotTone: "professional-warm",
    },
  };
  fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2), "utf8");
}

function readChats() {
  try {
    const raw = fs.readFileSync(chatsPath, "utf8");
    return JSON.parse(raw || "[]");
  } catch (e) {
    return [];
  }
}

function appendChatLog(entry) {
  const chats = readChats();
  chats.push(entry);
  fs.writeFileSync(chatsPath, JSON.stringify(chats, null, 2), "utf8");
}

// --- Simple JSON product catalog for chatbot (no external DB) ---
function readProducts() {
  try {
    if (!fs.existsSync(productsPath)) return [];
    const raw = fs.readFileSync(productsPath, "utf8");
    const data = JSON.parse(raw || "[]");
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("Failed to read products.json", e);
    return [];
  }
}

function writeProducts(list) {
  fs.writeFileSync(productsPath, JSON.stringify(list || [], null, 2), "utf8");
}

let products = readProducts();

// Sync shop.html products to products.json on server start
function syncShopProducts() {
  const shopProducts = [
    {
      id: "controllers-original",
      name: "Original PS & Xbox Controllers",
      category: "Controller",
      priceKES: null,
      stockQty: null,
      description: "Genuine PlayStation & Xbox controllers with warranty.",
      aliases: ["controllers", "ps controller", "xbox controller"],
      imageUrl: "https://images.unsplash.com/photo-1606144042614-b2417e99c4e3?w=800&q=80",
    },
    {
      id: "console-covers",
      name: "Custom Console Covers",
      category: "Accessory",
      priceKES: null,
      stockQty: null,
      description: "Protective, stylish skins and shells for your consoles.",
      aliases: ["covers", "console skins", "console shells"],
      imageUrl: "https://images.unsplash.com/photo-1591488320449-011701bb6704?w=800&q=80",
    },
    {
      id: "gaming-wheels",
      name: "Universal Gaming Wheels",
      category: "Racing Wheel",
      priceKES: null,
      stockQty: null,
      description: "Racing wheels for immersive driving and sim racing setups.",
      aliases: ["racing wheel", "steering wheel", "gaming wheel"],
      imageUrl: "https://images.unsplash.com/photo-1606144042614-b2417e99c4e3?w=800&q=80",
    },
    {
      id: "vr-headsets",
      name: "VR Headsets",
      category: "VR Headset",
      priceKES: null,
      stockQty: null,
      description: "Immersive VR solutions for supported consoles and PC.",
      aliases: ["vr", "virtual reality", "vr headset"],
      imageUrl: "https://images.unsplash.com/photo-1611050991820-b528a547935a?w=800&q=80",
    },
    {
      id: "pxn-driving-wheel",
      name: "PXN Driving Wheel",
      category: "Racing Wheel",
      priceKES: null,
      stockQty: null,
      description: "PXN driving wheels compatible with PlayStation, Xbox and PC.",
      aliases: ["pxn wheel", "pxn"],
      imageUrl: "https://images.unsplash.com/photo-1606144042614-b2417e99c4e3?w=800&q=80",
    },
    {
      id: "logitech-driving-wheel",
      name: "Logitech Driving Wheel",
      category: "Racing Wheel",
      priceKES: null,
      stockQty: null,
      description: "Logitech driving wheels for PlayStation, Xbox and PC.",
      aliases: ["logitech wheel", "logitech"],
      imageUrl: "https://images.unsplash.com/photo-1606144042614-b2417e99c4e3?w=800&q=80",
    },
    {
      id: "ps-charging-docks",
      name: "Charging Docks for PS4 & PS5",
      category: "Accessory",
      priceKES: null,
      stockQty: null,
      description: "Charging docks for PlayStation 4 and PlayStation 5 controllers.",
      aliases: ["charging dock", "ps4 dock", "ps5 dock"],
      imageUrl: "https://images.unsplash.com/photo-1607853202273-797f1c22a38e?w=800&q=80",
    },
    {
      id: "xbox-series-x-console",
      name: "Xbox Series X Console",
      category: "Console",
      priceKES: null,
      stockQty: null,
      description: "Xbox Series X console with Xbox Game Pass support.",
      aliases: ["xbox series x", "xbox", "xbox x"],
      imageUrl: "https://images.unsplash.com/photo-1606813907291-d86efa9b94db?w=800&q=80",
    },
    {
      id: "xbox-series-x-controller",
      name: "Xbox Series X Controller",
      category: "Controller",
      priceKES: null,
      stockQty: null,
      description: "Xbox Series X controller compatible with Xbox Series X, Xbox One and PC.",
      aliases: ["xbox controller", "xbox series x controller"],
      imageUrl: "https://images.unsplash.com/photo-1606144042614-b2417e99c4e3?w=800&q=80",
    },
    {
      id: "ps5-console",
      name: "PlayStation 5 Console",
      category: "Console",
      priceKES: null,
      stockQty: null,
      description: "PlayStation 5 console with PlayStation Network support.",
      aliases: ["ps5", "playstation 5", "playstation5"],
      imageUrl: "https://images.unsplash.com/photo-1606813907291-d86efa9b94db?w=800&q=80",
    },
    {
      id: "ps5-controller-dualsense",
      name: "PlayStation 5 DualSense Controller",
      category: "Controller",
      priceKES: null,
      stockQty: null,
      description: "PlayStation 5 DualSense controller compatible with PS5 and PC.",
      aliases: ["ps5 controller", "dualsense", "ps5 dualsense"],
      imageUrl: "https://images.unsplash.com/photo-1606144042614-b2417e99c4e3?w=800&q=80",
    },
    {
      id: "ps5-portal",
      name: "PlayStation Portal Remote Player",
      category: "Handheld / Accessory",
      priceKES: null,
      stockQty: null,
      description: "PlayStation Portal remote player for PlayStation 5 Remote Play.",
      aliases: ["portal", "ps portal", "playstation portal"],
      imageUrl: "https://images.unsplash.com/photo-1591488320449-011701bb6704?w=800&q=80",
    },
    {
      id: "ps-portal-bag",
      name: "PlayStation Portal Carry Bag",
      category: "Accessory",
      priceKES: null,
      stockQty: null,
      description: "Protective carry bag for PlayStation Portal and accessories.",
      aliases: ["portal bag", "ps portal bag"],
      imageUrl: "https://images.unsplash.com/photo-1591488320449-011701bb6704?w=800&q=80",
    },
    {
      id: "ssd-upgrades",
      name: "SSD Upgrades",
      category: "Storage",
      priceKES: null,
      stockQty: null,
      description: "High-speed SSD upgrades for PlayStation 5, PlayStation 4 and PC (NVMe & SATA options).",
      aliases: ["ssd", "storage upgrade", "nvme", "sata"],
      imageUrl: "https://images.unsplash.com/photo-1587825140708-dfaf72ae4b04?w=800&q=80",
    },
    {
      id: "gaming-thumb-sleeves",
      name: "Gaming Thumb Sleeves",
      category: "Accessory",
      priceKES: null,
      stockQty: null,
      description: "Gaming thumb sleeves for mobile, tablet and controller gaming.",
      aliases: ["thumb sleeves", "gaming sleeves"],
      imageUrl: "https://images.unsplash.com/photo-1606144042614-b2417e99c4e3?w=800&q=80",
    },
    {
      id: "gift-cards-psn-xbox",
      name: "Gift Cards for PS5 & Xbox",
      category: "Gift Card",
      priceKES: null,
      stockQty: null,
      description: "PSN and Xbox digital gift cards in multiple denominations.",
      aliases: ["gift card", "psn card", "xbox card", "gift cards"],
      imageUrl: "https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=800&q=80",
    },
    {
      id: "full-catalog-consultation",
      name: "Custom Gaming Product Request",
      category: "Consultation",
      priceKES: null,
      stockQty: null,
      description: "Full gaming product catalog consultation - from gaming chairs and headsets to microphones, capture cards, monitors, keyboards, mice, streaming gear, and more.",
      aliases: ["catalog", "full catalog", "custom request"],
      imageUrl: "https://images.unsplash.com/photo-1598300042247-d088f8ab3a91?w=800&q=80",
    },
  ];

  let updated = false;
  const existingIds = new Set(products.map(p => p.id));
  
  shopProducts.forEach(shopProduct => {
    if (!existingIds.has(shopProduct.id)) {
      products.push(shopProduct);
      updated = true;
    }
  });

  if (updated) {
    writeProducts(products);
    console.log("Synced shop products to products.json");
  }
}

// Run sync on server start
syncShopProducts();

// --- Startup configuration checks ---
if (ADMIN_KEY === "2007") {
  console.warn(
    "[WARN] ADMIN_DASHBOARD_KEY is using the insecure default value \"2007\"." +
    " Set a strong key via the ADMIN_DASHBOARD_KEY environment variable before deploying."
  );
}
if (!AI_API_KEY) {
  console.warn(
    "[WARN] AI_API_KEY / OPENAI_API_KEY is not set." +
    " The chatbot will use rule-based fallback responses." +
    " Set AI_API_KEY in your .env file to enable the OpenAI-powered chatbot."
  );
} else {
  console.log(`[INFO] AI chatbot enabled — model: ${AI_MODEL}`);
}

function normalize(str) {
  return (str || "").toString().trim().toLowerCase();
}

function findProductByNameOrAlias(query) {
  const q = normalize(query);
  if (!q) return null;
  let best = null;
  let bestScore = 0;

  for (const p of products) {
    const name = normalize(p.name);
    if (!name && !Array.isArray(p.aliases)) continue;

    // Exact name match
    if (name === q) {
      return p;
    }

    // Alias or partial match
    const aliases = Array.isArray(p.aliases) ? p.aliases : [];
    const allKeys = [name, ...aliases.map(normalize)].filter(Boolean);

    for (const key of allKeys) {
      if (!key) continue;
      if (key === q) {
        return p;
      }
      if (q.includes(key) || key.includes(q)) {
        const score = key.length;
        if (score > bestScore) {
          bestScore = score;
          best = p;
        }
      }
    }
  }

  return best;
}

function findSimilarProducts(baseProduct, limit = 5) {
  if (!baseProduct) return [];
  const category = baseProduct.category;
  return products
    .filter((p) => p.id !== baseProduct.id && (!category || p.category === category))
    .slice(0, limit);
}

function guessProductNameFromMessage(message) {
  const text = normalize(message);
  if (!text) return null;
  let bestAlias = null;
  let bestLen = 0;

  for (const p of products) {
    const aliases = [p.name, ...(Array.isArray(p.aliases) ? p.aliases : [])];
    for (const alias of aliases) {
      const a = normalize(alias);
      if (!a) continue;
      if (text.includes(a) && a.length > bestLen) {
        bestLen = a.length;
        bestAlias = alias;
      }
    }
  }

  return bestAlias;
}

// --- Settings & repairs helpers ---
function readSettings() {
  try {
    const raw = fs.readFileSync(settingsPath, "utf8");
    return JSON.parse(raw || "{}");
  } catch (e) {
    console.error("Failed to read settings.json", e);
    return {};
  }
}

function writeSettings(settings) {
  fs.writeFileSync(settingsPath, JSON.stringify(settings || {}, null, 2), "utf8");
}

function readRepairs() {
  try {
    const raw = fs.readFileSync(repairsPath, "utf8");
    const data = JSON.parse(raw || "[]");
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("Failed to read repairs.json", e);
    return [];
  }
}

function writeRepairs(list) {
  fs.writeFileSync(repairsPath, JSON.stringify(list || [], null, 2), "utf8");
}

// --- Bookings helpers ---
function readBookings() {
  try {
    const raw = fs.readFileSync(bookingsPath, "utf8");
    const data = JSON.parse(raw || "[]");
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("Failed to read bookings.json", e);
    return [];
  }
}

function writeBookings(list) {
  fs.writeFileSync(bookingsPath, JSON.stringify(list || [], null, 2), "utf8");
}

// --- Services helpers ---
function readServices() {
  try {
    const raw = fs.readFileSync(servicesPath, "utf8");
    const data = JSON.parse(raw || "[]");
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("Failed to read services.json", e);
    return [];
  }
}

function writeServices(list) {
  fs.writeFileSync(servicesPath, JSON.stringify(list || [], null, 2), "utf8");
}

// --- Technicians helpers ---
function readTechnicians() {
  try {
    const raw = fs.readFileSync(techniciansPath, "utf8");
    const data = JSON.parse(raw || "[]");
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("Failed to read technicians.json", e);
    return [];
  }
}

function writeTechnicians(list) {
  fs.writeFileSync(techniciansPath, JSON.stringify(list || [], null, 2), "utf8");
}

// --- Orders helpers ---
function readOrders() {
  try {
    const raw = fs.readFileSync(ordersPath, "utf8");
    const data = JSON.parse(raw || "[]");
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("Failed to read orders.json", e);
    return [];
  }
}

function writeOrders(list) {
  fs.writeFileSync(ordersPath, JSON.stringify(list || [], null, 2), "utf8");
}

// --- Promotions helpers ---
function readPromotions() {
  try {
    const raw = fs.readFileSync(promotionsPath, "utf8");
    const data = JSON.parse(raw || "[]");
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("Failed to read promotions.json", e);
    return [];
  }
}

function writePromotions(list) {
  fs.writeFileSync(promotionsPath, JSON.stringify(list || [], null, 2), "utf8");
}

// --- Notifications helpers ---
function readNotifications() {
  try {
    const raw = fs.readFileSync(notificationsPath, "utf8");
    const data = JSON.parse(raw || "[]");
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("Failed to read notifications.json", e);
    return [];
  }
}

function writeNotifications(list) {
  fs.writeFileSync(notificationsPath, JSON.stringify(list || [], null, 2), "utf8");
}

// --- Repair notifications helpers ---
function readRepairNotifications() {
  try {
    const raw = fs.readFileSync(repairNotificationsPath, "utf8");
    const data = JSON.parse(raw || "[]");
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("Failed to read repairNotifications.json", e);
    return [];
  }
}

function writeRepairNotifications(list) {
  fs.writeFileSync(
    repairNotificationsPath,
    JSON.stringify(list || [], null, 2),
    "utf8"
  );
}

// --- Booking notification helpers ---
function readBookingNotifications() {
  try {
    const raw = fs.readFileSync(bookingNotificationsPath, "utf8");
    const data = JSON.parse(raw || "[]");
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

function writeBookingNotifications(list) {
  fs.writeFileSync(bookingNotificationsPath, JSON.stringify(list || [], null, 2), "utf8");
}

/**
 * Builds the WhatsApp message text sent to a customer when their booking is confirmed.
 */
function buildBookingConfirmationMessage(booking) {
  const name = booking.customerName || "Customer";
  const lines = [
    `Hello ${name}! 👋`,
    ``,
    `Your booking at *GAMEPLAN* has been *confirmed* ✅`,
    ``,
    `📋 *Booking ID:* ${booking.id}`,
    booking.service   ? `🔧 *Service:* ${booking.service}`     : null,
    booking.console   ? `🎮 *Console:* ${booking.console}`     : null,
    booking.date      ? `📅 *Date:* ${booking.date}`           : null,
    booking.timeSlot  ? `⏰ *Time:* ${booking.timeSlot}`             : null,
    booking.technician ? `👨‍🔧 *Technician:* ${booking.technician}` : null,
    booking.notes     ? `📝 *Notes:* ${booking.notes}`         : null,
    ``,
    `Please arrive *10 minutes early*. To reschedule or cancel, reply here or call *+254720968268*.`,
    ``,
    `Thank you for choosing GAMEPLAN — Nairobi's Gaming Hub! 🎮`,
  ].filter(Boolean);
  return lines.join("\n");
}

// --- Logs helpers ---
function readLogs() {
  try {
    const raw = fs.readFileSync(logsPath, "utf8");
    const data = JSON.parse(raw || "[]");
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("Failed to read logs.json", e);
    return [];
  }
}

function appendLog(entry) {
  const logs = readLogs();
  logs.push(entry);
  // Keep only last 1000 logs
  if (logs.length > 1000) {
    logs.shift();
  }
  fs.writeFileSync(logsPath, JSON.stringify(logs, null, 2), "utf8");
}

// --- Blocked dates helpers ---
function readBlockedDates() {
  try {
    const raw = fs.readFileSync(blockedDatesPath, "utf8");
    const data = JSON.parse(raw || "[]");
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("Failed to read blockedDates.json", e);
    return [];
  }
}

// --- Wishlist helpers ---
function readWishlistItems() {
  try {
    const raw = fs.readFileSync(wishlistItemsPath, "utf8");
    const data = JSON.parse(raw || "[]");
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("Failed to read wishlistItems.json", e);
    return [];
  }
}

function writeWishlistItems(list) {
  fs.writeFileSync(wishlistItemsPath, JSON.stringify(list || [], null, 2), "utf8");
}

function writeBlockedDates(list) {
  fs.writeFileSync(blockedDatesPath, JSON.stringify(list || [], null, 2), "utf8");
}

// Increase body size limits to allow base64 image data from admin uploads
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: false, limit: "5mb" }));

// --- Simple admin UI session helpers (cookie-based) ---
function isAdminUiAuthenticated(req) {
  const cookie = req.headers["cookie"] || "";
  return cookie
    .split(";")
    .map((part) => part.trim())
    .some((part) => part === "admin_ui_auth=1");
}

function requireAdminUi(req, res, next) {
  if (isAdminUiAuthenticated(req)) {
    return next();
  }
  return res.redirect("/admin/login");
}

// Simple admin session info for UI (no credentials requested here)
app.get("/api/admin/session", (req, res) => {
  if (!isAdminUiAuthenticated(req)) {
    return res.json({
      role: null,
      status: "expired",
      expiresAt: null,
    });
  }
  // For now we expose a single role and a rolling expiry window
  const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
  return res.json({
    role: "Super Admin",
    status: "active",
    expiresAt,
  });
});

// Admin login page (password form)
app.get("/admin/login", (req, res) => {
  if (isAdminUiAuthenticated(req)) {
    return res.redirect("/admin");
  }
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>GAMEPLAN Admin Login</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body class="index-page admin-page">
  <header class="site-header">
    <nav class="nav">
      <a href="/index.html" class="logo">GAMEPLAN</a>
      <div class="nav-actions" style="margin-left:auto;">
        <span style="font-size:0.8rem;color:var(--text-soft);">Admin Login</span>
      </div>
    </nav>
  </header>
  <main class="section" style="padding-top:1.5rem;">
    <div class="container" style="max-width:420px;margin:0 auto;">
      <div class="card" style="padding:1.25rem 1.5rem;">
        <h1 style="font-size:1.1rem;margin-bottom:0.75rem;">Admin Dashboard Login</h1>
        <p style="font-size:0.85rem;color:var(--text-soft);margin-bottom:1rem;">
          Staff only. Enter the admin password to access the GAMEPLAN operations hub.
        </p>
        <form method="POST" action="/admin/login" class="generic-form">
          <div class="form-group">
            <label for="password">Admin Password</label>
            <input id="password" name="password" type="password" required />
          </div>
          <button type="submit" class="btn btn-primary" style="margin-top:0.75rem;">Login</button>
          <p style="font-size:0.8rem;color:#f97373;margin-top:0.75rem;">${
            req.query.error === "1" ? "Invalid password. Access denied." : ""
          }</p>
        </form>
      </div>
    </div>
  </main>
</body>
</html>`);
});

// Handle admin login submissions
app.post("/admin/login", (req, res) => {
  // Rate limit: 10 attempts per 15 minutes per IP to block brute-force attacks
  if (!checkRateLimit(req, "admin-login", 10, 15 * 60 * 1000)) {
    return res.status(429).send("Too many login attempts. Please wait 15 minutes and try again.");
  }
  const password = (req.body && req.body.password) || "";
  if (password && password === ADMIN_KEY) {
    // Add Secure flag when the connection is HTTPS (direct or via proxy)
    const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
    const secureFlag = isHttps ? "; Secure" : "";
    res.setHeader(
      "Set-Cookie",
      `admin_ui_auth=1; HttpOnly; SameSite=Lax; Path=/${secureFlag}`
    );
    return res.redirect("/admin");
  }
  return res.redirect("/admin/login?error=1");
});

// Admin logout clears UI auth and redirects to login
app.get("/admin/logout", (req, res) => {
  const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
  const secureFlag = isHttps ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `admin_ui_auth=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureFlag}`
  );
  return res.redirect("/admin/login");
});

// Guard the admin dashboard HTML itself
app.get("/admin", requireAdminUi, (req, res) => {
  res.sendFile(path.join(__dirname, "..", "admin.html"));
});

// Also guard direct access to admin.html
app.get("/admin.html", requireAdminUi, (req, res) => {
  res.sendFile(path.join(__dirname, "..", "admin.html"));
});

// Serve static frontend files from the parent directory
app.use(express.static(path.join(__dirname, "..")));

// =============================================================================
// AI Chatbot — OpenAI integration + rule-based fallback
// =============================================================================

/**
 * Builds a context-rich system prompt for the GAMEPLAN AI assistant.
 * Pulls live product, service, and settings data to keep it up to date.
 */
function buildSystemPrompt() {
  const settings = readSettings();
  const tone = (settings.ai && settings.ai.chatbotTone) || "professional-warm";
  const dynamicPricing = !!(settings.ai && settings.ai.dynamicPricingSuggestions);

  const allProducts = readProducts();

  // Sort: products with a known price first (most useful for the AI), then the rest.
  // Strip base64 imageUrl fields — they add thousands of tokens with zero value for the AI.
  const sorted = [...allProducts].sort((a, b) => {
    const aHasPrice = a.priceKES != null ? 0 : 1;
    const bHasPrice = b.priceKES != null ? 0 : 1;
    if (aHasPrice !== bHasPrice) return aHasPrice - bHasPrice;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  const productLines = sorted
    .filter((p) => p.name) // skip nameless entries
    .map((p) => {
      const price = p.priceKES != null ? `KES ${p.priceKES}` : "price on request";
      const stock =
        p.stockQty != null
          ? p.stockQty > 0
            ? `in stock (qty: ${p.stockQty})`
            : "out of stock"
          : "check availability";
      // Include aliases so the AI recognises informal names (e.g. "dualsense", "pxn")
      const aliasStr =
        Array.isArray(p.aliases) && p.aliases.length
          ? ` (also: ${p.aliases.slice(0, 4).join(", ")})`
          : "";
      const desc = p.description ? ` — ${p.description}` : "";
      return `• ${p.name}${aliasStr} [${p.category || "product"}] | ${price} | ${stock}${desc}`;
    })
    .join("\n");

  const allServices = readServices();
  const serviceLines = allServices
    .slice(0, 10)
    .map((s) => {
      const price =
        s.price_range || (s.priceKES ? `From KES ${s.priceKES}` : "price on inspection");
      const time = s.turnaround_time || s.estimatedTime || "";
      return `• ${s.name}: ${price}${time ? ` — turnaround: ${time}` : ""}`;
    })
    .join("\n");

  const toneMap = {
    "professional-warm": "professional yet warm and approachable",
    formal: "formal and precise",
    casual: "casual and relaxed",
    friendly: "friendly and enthusiastic",
  };
  const toneDesc = toneMap[tone] || "professional yet warm and approachable";

  const lines = [
    "You are an expert AI sales and support assistant for GAMEPLAN, a gaming accessories and console repair shop in Nairobi, Kenya.",
    "Contact: WhatsApp +254720968268 | MPESA Send Money: 0720968268 | Lipa na MPESA Till: 8314252.",
    "",
    `Tone: ${toneDesc}. Keep replies concise (≤ 120 words). Always respond in English.`,
    "",
    "CAPABILITIES:",
    "- State prices confidently and exactly as listed below when a customer asks.",
    "- Answer stock, delivery (Nairobi 24h), and compatibility queries.",
    "- Describe repair/upgrade services and their cost and turnaround time.",
    "- Help customers book appointments or log repair requests — collect name and phone number.",
    "- Explain MPESA payment: Send Money (0720968268) or Lipa na MPESA Till (8314252).",
  ];
  if (dynamicPricing) {
    lines.push("- Proactively suggest related products (e.g. controller + charging dock).");
  }
  lines.push(
    "",
    "RULES:",
    "- When a price IS listed below, state it confidently — do NOT say 'contact us' for that item.",
    "- When price is 'price on request', direct the customer to WhatsApp +254720968268.",
    "- Match products by name OR by common aliases shown in parentheses.",
    "- Never fabricate prices, stock levels, or product details.",
    "- For anything unrelated to gaming or the shop, politely redirect.",
    "",
    `FULL PRODUCT CATALOG (${sorted.filter((p) => p.name).length} items — prices in KES):`,
    productLines || "No products loaded yet."
  );
  if (serviceLines) {
    lines.push("", "REPAIR & UPGRADE SERVICES:", serviceLines);
  }
  return lines.join("\n");
}

/**
 * Calls OpenAI Chat Completions and returns the assistant reply string.
 * Throws on HTTP error or unexpected response shape.
 */
async function callOpenAI(messages) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages,
      max_tokens: 350,
      temperature: 0.65,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenAI API error ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = await response.json();
  const content =
    data.choices &&
    data.choices[0] &&
    data.choices[0].message &&
    data.choices[0].message.content;
  if (!content) throw new Error("OpenAI returned an empty response");
  return content.trim();
}

// Chatbot capability status — lets the front-end know if AI is active
app.get("/api/chat/status", (req, res) => {
  res.json({
    aiEnabled: !!AI_API_KEY,
    model: AI_API_KEY ? AI_MODEL : null,
    fallback: "rule-based",
  });
});

// Main chatbot endpoint — AI-powered when AI_API_KEY is set, rule-based fallback otherwise
app.post("/api/chat", async (req, res) => {
  // Rate limit: 30 messages per minute per IP
  if (!checkRateLimit(req, "chat", 30, 60 * 1000)) {
    return res.status(429).json({
      error: "Too many requests. Please slow down.",
      reply: "You've sent too many messages in a short period. Please wait a moment and try again.",
    });
  }

  const { message, history } = req.body || {};

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Missing 'message' string in body" });
  }

  const timestamp = new Date().toISOString();
  const lower = message.toLowerCase();

  // ── Intent detection (used by the rule-based fallback and for logging AI responses) ──
  let intent = "general";
  let conversion = null;
  const hasAny = (words) => words.some((w) => lower.includes(w));

  if (hasAny(["hi", "hello", "hey", "howdy", "hiya", "sup"])) {
    intent = "greeting";
  } else if (hasAny(["book", "appointment", "schedule", "reserve", "slot"])) {
    intent = "booking_request";
  } else if (
    hasAny([
      "not charging", "not turning on", "wont turn on", "won't turn on",
      "broken", "faulty", "damaged", "cracked", "overheating", "no signal",
    ])
  ) {
    intent = "repair_issue";
  } else if (hasAny(["repair", "service", "fix", "clean", "cleaning", "upgrade"])) {
    intent = "service_inquiry";
  } else if (hasAny(["price", "cost", "how much", "ksh", "kes", "charge"])) {
    intent = "product_inquiry";
  }

  // ── Try OpenAI when an API key is configured ──
  if (AI_API_KEY) {
    try {
      const systemPrompt = buildSystemPrompt();

      // Cap history to 10 turns and validate shape to limit token usage
      const historyMessages = Array.isArray(history)
        ? history
            .slice(-10)
            .filter(
              (h) =>
                h &&
                (h.role === "user" || h.role === "assistant") &&
                typeof h.content === "string"
            )
            .map((h) => ({ role: h.role, content: String(h.content).slice(0, 500) }))
        : [];

      const messages = [
        { role: "system", content: systemPrompt },
        ...historyMessages,
        { role: "user", content: message },
      ];

      const reply = await callOpenAI(messages);
      conversion = "AI response";

      const logEntry = {
        id: `chat-${Date.now()}`,
        timestamp,
        message,
        reply,
        intent,
        conversion,
        source: "openai",
        model: AI_MODEL,
        user_message: message,
        bot_response: reply,
        created_at: timestamp,
      };
      appendChatLog(logEntry);

      return res.json({ reply, intent, source: "openai", model: AI_MODEL });
    } catch (err) {
      // Log the failure and fall through to the rule-based handler
      console.error("[WARN] OpenAI call failed, falling back to rule-based:", err.message);
    }
  }

  // ── Rule-based fallback ──
  let reply = "";

  try {
    if (intent === "product_inquiry") {
      // Use the smarter alias/partial-match lookup instead of a plain name check
      const match =
        findProductByNameOrAlias(message) ||
        findProductByNameOrAlias(guessProductNameFromMessage(message) || "");
      if (match) {
        const price = match.priceKES ?? match.price ?? null;
        const stockQty = match.stockQty;
        const inStock =
          stockQty == null ? match.stock_status !== "out_of_stock" : stockQty > 0;
        const availability = inStock ? "in stock" : "currently out of stock";
        const priceText = price != null ? `KES ${price.toLocaleString()}` : "price available on request (contact us on WhatsApp at +254720968268)";
        const desc = match.description ? ` — ${match.description}` : "";
        reply = `${match.name}: ${priceText}. Currently ${availability}${desc}.`;
        conversion = "Product viewed";
      } else {
        reply =
          "I couldn't find that product in our catalog. Try searching by name " +
          "(e.g. PS5, Xbox Series X, DualSense controller, PXN wheel). " +
          "You can also browse our full catalog on WhatsApp at +254720968268.";
      }
    } else if (intent === "service_inquiry") {
      const services = readServices();
      if (!services.length) {
        reply =
          "We offer console repairs and upgrade services. Contact us on WhatsApp at " +
          "+254720968268 for details and pricing.";
      } else {
        const lines = services.slice(0, 5).map((s) => {
          const priceRange =
            s.price_range ||
            (s.priceKES ? `From KES ${s.priceKES}` : "Price on inspection");
          const turnaround =
            s.turnaround_time || s.estimatedTime || "Same-day or next-day";
          return `- ${s.name}: ${priceRange}. Turnaround: ${turnaround}.`;
        });
        reply = "Here are some of our services:\n" + lines.join("\n");
      }
      conversion = "Service info";
    } else if (intent === "repair_issue") {
      const now = new Date().toISOString();
      const repairs = readRepairs();
      const id = `R-${repairs.length + 1}-${Date.now()}`;
      const ticket = {
        id,
        createdAt: now,
        updatedAt: now,
        customerName: "",
        whatsapp: "",
        console: "",
        issue: message,
        status: "pending",
        notes: "Created via chatbot",
      };
      repairs.push(ticket);
      writeRepairs(repairs);
      reply =
        `I've logged a repair request for you (ID: ${id}). ` +
        "Please reply with your name and phone number so our technicians can follow up promptly.";
      conversion = "Created repair";
    } else if (intent === "booking_request") {
      const now = new Date().toISOString();
      const bookings = readBookings();
      const id = `B-${bookings.length + 1}-${Date.now()}`;
      const booking = {
        id,
        createdAt: now,
        updatedAt: now,
        customerName: "",
        whatsapp: "",
        service: "",
        console: "",
        date: "",
        timeSlot: "",
        technician: "",
        status: "pending",
        notes: "Created via chatbot (awaiting date/contact)",
      };
      bookings.push(booking);
      writeBookings(bookings);
      reply =
        `I've started a booking for you (ID: ${id}). ` +
        "Please share your preferred date, time slot, and phone number to confirm.";
      conversion = "Created booking";
    } else if (intent === "greeting") {
      reply =
        "Hello! Welcome to GAMEPLAN. I can help with product prices, console repairs, " +
        "service bookings, and more. Try asking about a product, describing a repair issue, " +
        "or say you'd like to book an appointment.";
      conversion = "Greeting";
    } else {
      reply =
        "I can help with product prices, repair services, and booking appointments. " +
        "Try asking about a specific product, describing your console issue, or saying you'd " +
        "like to book a service. You can also reach us on WhatsApp at +254720968268.";
    }

    const logEntry = {
      id: `chat-${Date.now()}`,
      timestamp,
      message,
      reply,
      intent,
      conversion,
      source: "db_processed",
      user_message: message,
      bot_response: reply,
      created_at: timestamp,
    };
    appendChatLog(logEntry);

    return res.json({ reply, intent, source: "db_processed" });
  } catch (err) {
    console.error("/api/chat rule-based handler error", err);
    const fallbackReply =
      "Something went wrong processing your request. " +
      "Please try again or contact us on WhatsApp at +254720968268.";
    const logEntry = {
      id: `chat-${Date.now()}`,
      timestamp,
      message,
      reply: fallbackReply,
      intent,
      conversion: null,
      source: "db_processed",
      user_message: message,
      bot_response: fallbackReply,
      created_at: timestamp,
    };
    appendChatLog(logEntry);
    return res.json({ reply: fallbackReply, intent, source: "db_processed" });
  }
});
// API-level admin auth: accept either a valid UI session cookie or
// an Authorization: Bearer <ADMIN_KEY> header for programmatic access.
function requireAdmin(req, res, next) {
  // If the admin UI session is authenticated, allow access.
  if (isAdminUiAuthenticated(req)) {
    return next();
  }

  // Also support direct Bearer token for tools / scripts.
  const auth = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (token && token === ADMIN_KEY) return next();

  return res.status(401).json({ error: "Unauthorized" });
}

// Admin: list recent chats
app.get("/api/admin/chats", requireAdmin, (req, res) => {
  const chats = readChats();
  const limit = Number(req.query.limit) || 100;
  const sorted = chats
    .slice()
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
    .slice(0, limit);
  res.json({ items: sorted });
});

// Admin: basic stats (chat + cart insight)
app.get("/api/admin/stats", requireAdmin, (req, res) => {
  const chats = readChats();
  const totalChats = chats.length;

  const byPath = {};
  const productCounts = {};

  for (const c of chats) {
    const path = c?.context?.path || "unknown";
    byPath[path] = (byPath[path] || 0) + 1;

    const cart = Array.isArray(c?.context?.cart) ? c.context.cart : [];
    for (const item of cart) {
      const key = item?.id || item?.name || "unknown";
      productCounts[key] = (productCounts[key] || 0) + (item?.quantity || 1);
    }
  }

  const topProducts = Object.entries(productCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, count]) => ({ id, count }));

  res.json({
    totalChats,
    byPath,
    topProducts,
  });
});

// Admin: site & AI settings (JSON)
app.get("/api/admin/settings", requireAdmin, (req, res) => {
  const settings = readSettings();
  res.json(settings);
});

app.put("/api/admin/settings", requireAdmin, (req, res) => {
  const incoming = req.body || {};
  // Very light validation: ensure objects exist
  const current = readSettings();
  const merged = {
    ...current,
    ...incoming,
    delivery: {
      ...(current.delivery || {}),
      ...(incoming.delivery || {}),
    },
    ai: {
      ...(current.ai || {}),
      ...(incoming.ai || {}),
    },
  };
  writeSettings(merged);
  res.json({ ok: true, settings: merged });
});

// Public: product catalog for shop page (no admin auth)
app.get("/api/products", (req, res) => {
  const list = readProducts();
  res.json({ items: list });
});

// Public: upgraded products (flagged in admin as upgraded)
app.get("/api/products/upgraded", (req, res) => {
  const list = readProducts().filter((p) => p.upgraded);
  res.json({ items: list });
});

// Admin: products CRUD (backed by products.json)
app.get("/api/admin/products", requireAdmin, (req, res) => {
  const list = readProducts();
  res.json({ items: list });
});

app.post("/api/admin/products", requireAdmin, (req, res) => {
  const body = req.body || {};
  let list = readProducts();
  const id = body.id && String(body.id).trim() ? String(body.id).trim() : `prod-${Date.now()}`;
  const product = { ...body, id };
  list.push(product);
  writeProducts(list);
  products = list; // refresh in-memory catalog for chatbot
  res.status(201).json({ item: product });
});

app.put("/api/admin/products/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  let list = readProducts();
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: "Product not found" });
  }
  const updated = { ...list[idx], ...req.body, id };
  list[idx] = updated;
  writeProducts(list);
  products = list;
  res.json({ item: updated });
});

app.delete("/api/admin/products/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  let list = readProducts();
  const next = list.filter((p) => p.id !== id);
  writeProducts(next);
  products = next;
  res.json({ ok: true });
});

// Admin: repair tickets (basic operations hub)
app.get("/api/admin/repairs", requireAdmin, (req, res) => {
  const repairs = readRepairs()
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json({ items: repairs });
});

app.post("/api/admin/repairs", requireAdmin, (req, res) => {
  const body = req.body || {};
  const now = new Date().toISOString();
  const repairs = readRepairs();
  const id = body.id && String(body.id).trim() ? String(body.id).trim() : `R-${repairs.length + 1}-${Date.now()}`;
  const ticket = {
    id,
    createdAt: now,
    updatedAt: now,
    customerName: body.customerName || "",
    whatsapp: body.whatsapp || "",
    console: body.console || "",
    issue: body.issue || "",
    status: body.status || "Received",
    notes: body.notes || "",
  };
  repairs.push(ticket);
  writeRepairs(repairs);
  res.status(201).json({ item: ticket });
});

app.put("/api/admin/repairs/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  const repairs = readRepairs();
  const idx = repairs.findIndex((r) => r.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: "Repair ticket not found" });
  }
  const now = new Date().toISOString();
  const updated = {
    ...repairs[idx],
    ...req.body,
    id,
    updatedAt: now,
  };
  repairs[idx] = updated;
  writeRepairs(repairs);
  res.json({ item: updated });
});

app.delete("/api/admin/repairs/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  const repairs = readRepairs();
  const filtered = repairs.filter((r) => r.id !== id);
  if (filtered.length === repairs.length) {
    return res.status(404).json({ error: "Repair ticket not found" });
  }
  writeRepairs(filtered);
  appendLog({ type: "repair_delete", id, timestamp: new Date().toISOString(), admin: "system" });
  res.json({ ok: true });
});

// Admin: bookings & appointments
app.get("/api/admin/bookings", requireAdmin, (req, res) => {
  const bookings = readBookings()
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json({ items: bookings });
});

// Admin: communications view - completed repairs with basic info
app.get("/api/admin/repairs/completed", requireAdmin, (req, res) => {
  const repairs = readRepairs();
  const completed = repairs.filter((r) => {
    const status = (r.status || "").toLowerCase();
    return status === "completed" || status === "ready" || status === "delivered";
  });
  const sorted = completed
    .slice()
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  res.json({ items: sorted });
});

// Admin: repair notifications for a given repair
app.get("/api/admin/repairs/:id/notifications", requireAdmin, (req, res) => {
  const id = req.params.id;
  const all = readRepairNotifications();
  const items = all
    .filter((n) => n.repair_id === id)
    .slice()
    .sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1));
  res.json({ items });
});

app.post("/api/admin/repairs/:id/notifications", requireAdmin, (req, res) => {
  const id = req.params.id;
  const { message, bookingId, orderId, productId } = req.body || {};
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Message is required" });
  }
  const repairs = readRepairs();
  const repair = repairs.find((r) => r.id === id);
  if (!repair) {
    return res.status(404).json({ error: "Repair not found" });
  }
  const notifications = readRepairNotifications();
  const now = new Date().toISOString();
  const notif = {
    id: `rn-${Date.now()}`,
    repair_id: id,
    booking_id: bookingId || null,
    order_id: orderId || null,
    product_id: productId || null,
    customer_contact: repair.whatsapp || repair.customer_contact || "",
    message,
    status: "sent",
    sent_at: now,
  };
  notifications.push(notif);
  writeRepairNotifications(notifications);
  appendLog({ type: "repair_notify", id, timestamp: now, admin: "system" });
  res.status(201).json({ item: notif });
});

// --- Booking notification routes ---
// List all notifications sent for a specific booking
app.get("/api/admin/bookings/:id/notifications", requireAdmin, (req, res) => {
  const id = req.params.id;
  const all = readBookingNotifications();
  const items = all
    .filter((n) => n.booking_id === id)
    .sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1));
  res.json({ items });
});

// Send a WhatsApp notification to the customer for a booking
// Returns the pre-filled WhatsApp URL so the admin can open it in one click
app.post("/api/admin/bookings/:id/notify", requireAdmin, (req, res) => {
  const id = req.params.id;
  const bookings = readBookings();
  const booking = bookings.find((b) => b.id === id);
  if (!booking) {
    return res.status(404).json({ error: "Booking not found" });
  }

  const phone = (booking.whatsapp || "").replace(/\D/g, "");
  if (!phone) {
    return res.status(400).json({ error: "This booking has no customer WhatsApp number on record." });
  }

  // Build the confirmation message
  const customMessage = (req.body && req.body.message) || null;
  const message = customMessage || buildBookingConfirmationMessage(booking);

  // Log the notification
  const now = new Date().toISOString();
  const notif = {
    id: `bn-${Date.now()}`,
    booking_id: id,
    customer_contact: booking.whatsapp,
    customerName: booking.customerName || "",
    message,
    status: "sent",
    sent_at: now,
  };
  const notifications = readBookingNotifications();
  notifications.push(notif);
  writeBookingNotifications(notifications);
  appendLog({ type: "booking_notify", id, timestamp: now, admin: "system" });

  // Build WhatsApp deep-link (international format: strip leading 0, prepend 254)
  const intlPhone = phone.startsWith("254") ? phone : `254${phone.replace(/^0/, "")}`;
  const whatsappUrl = `https://wa.me/${intlPhone}?text=${encodeURIComponent(message)}`;

  res.status(201).json({ item: notif, whatsappUrl, message });
});

// Public: create booking from website (no admin auth)
app.post("/api/bookings", (req, res) => {
  const body = req.body || {};
  const now = new Date().toISOString();
  const bookings = readBookings();
  const id = body.id && String(body.id).trim() ? String(body.id).trim() : `B-${bookings.length + 1}-${Date.now()}`;
  const booking = {
    id,
    createdAt: now,
    updatedAt: now,
    customerName: body.customerName || "",
    whatsapp: body.whatsapp || "",
    service: body.service || "",
    console: body.console || "",
    date: body.date || "",
    timeSlot: body.timeSlot || "",
    technician: body.technician || "",
    status: "pending", // website bookings always start as pending
    notes: body.notes || "",
  };
  bookings.push(booking);
  writeBookings(bookings);
  res.status(201).json({ item: booking });
});

app.post("/api/admin/bookings", requireAdmin, (req, res) => {
  const body = req.body || {};
  const now = new Date().toISOString();
  const bookings = readBookings();
  const id = body.id && String(body.id).trim() ? String(body.id).trim() : `B-${bookings.length + 1}-${Date.now()}`;
  const booking = {
    id,
    createdAt: now,
    updatedAt: now,
    customerName: body.customerName || "",
    whatsapp: body.whatsapp || "",
    service: body.service || "",
    console: body.console || "",
    date: body.date || "",
    timeSlot: body.timeSlot || "",
    technician: body.technician || "",
    status: body.status || "pending", // pending, confirmed, completed, cancelled
    notes: body.notes || "",
  };
  bookings.push(booking);
  writeBookings(bookings);
  res.status(201).json({ item: booking });
});

app.put("/api/admin/bookings/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  const bookings = readBookings();
  const idx = bookings.findIndex((b) => b.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: "Booking not found" });
  }

  const previousStatus = (bookings[idx].status || "").toLowerCase();
  const now = new Date().toISOString();
  const updated = {
    ...bookings[idx],
    ...req.body,
    id,
    updatedAt: now,
  };
  bookings[idx] = updated;
  writeBookings(bookings);
  appendLog({ type: "booking_update", id, timestamp: now, admin: "system" });

  // When status changes to "confirmed" and the booking has a phone number,
  // auto-generate the WhatsApp notification URL for the admin UI to open.
  const newStatus = (updated.status || "").toLowerCase();
  const justConfirmed = newStatus === "confirmed" && previousStatus !== "confirmed";
  let whatsappUrl = null;

  if (justConfirmed && updated.whatsapp) {
    const message = buildBookingConfirmationMessage(updated);
    const phone = (updated.whatsapp || "").replace(/\D/g, "");
    const intlPhone = phone.startsWith("254") ? phone : `254${phone.replace(/^0/, "")}`;
    whatsappUrl = `https://wa.me/${intlPhone}?text=${encodeURIComponent(message)}`;

    // Also log it so the notification history is complete
    const notif = {
      id: `bn-${Date.now()}`,
      booking_id: id,
      customer_contact: updated.whatsapp,
      customerName: updated.customerName || "",
      message,
      status: "pending_send", // admin still needs to actually send it via WhatsApp
      sent_at: now,
    };
    const notifications = readBookingNotifications();
    notifications.push(notif);
    writeBookingNotifications(notifications);
    appendLog({ type: "booking_notify_ready", id, timestamp: now, admin: "system" });
  }

  res.json({ item: updated, notifyReady: justConfirmed, whatsappUrl });
});

app.delete("/api/admin/bookings/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  const bookings = readBookings();
  const filtered = bookings.filter((b) => b.id !== id);
  if (filtered.length === bookings.length) {
    return res.status(404).json({ error: "Booking not found" });
  }
  writeBookings(filtered);
  appendLog({ type: "booking_delete", id, timestamp: new Date().toISOString(), admin: "system" });
  res.json({ ok: true });
});

// --- Services Management ---
app.get("/api/admin/services", requireAdmin, (req, res) => {
  const services = readServices();
  res.json({ items: services });
});

app.post("/api/admin/services", requireAdmin, (req, res) => {
  const body = req.body || {};
  const services = readServices();
  const id = body.id && String(body.id).trim() ? String(body.id).trim() : `svc-${Date.now()}`;
  const service = {
    id,
    name: body.name || "",
    description: body.description || "",
    priceKES: body.priceKES || 0,
    estimatedTime: body.estimatedTime || "",
    available: body.available !== false,
    category: body.category || "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  services.push(service);
  writeServices(services);
  appendLog({ type: "service_create", id, timestamp: service.createdAt, admin: "system" });
  res.status(201).json({ item: service });
});

app.put("/api/admin/services/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  const services = readServices();
  const idx = services.findIndex((s) => s.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: "Service not found" });
  }
  const now = new Date().toISOString();
  const updated = {
    ...services[idx],
    ...req.body,
    id,
    updatedAt: now,
  };
  services[idx] = updated;
  writeServices(services);
  appendLog({ type: "service_update", id, timestamp: now, admin: "system" });
  res.json({ item: updated });
});

app.delete("/api/admin/services/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  const services = readServices();
  const filtered = services.filter((s) => s.id !== id);
  if (filtered.length === services.length) {
    return res.status(404).json({ error: "Service not found" });
  }
  writeServices(filtered);
  appendLog({ type: "service_delete", id, timestamp: new Date().toISOString(), admin: "system" });
  res.json({ ok: true });
});

// --- Technicians Management ---
app.get("/api/admin/technicians", requireAdmin, (req, res) => {
  const technicians = readTechnicians();
  res.json({ items: technicians });
});

app.post("/api/admin/technicians", requireAdmin, (req, res) => {
  const body = req.body || {};
  const technicians = readTechnicians();
  const id = body.id && String(body.id).trim() ? String(body.id).trim() : `tech-${Date.now()}`;
  const technician = {
    id,
    name: body.name || "",
    email: body.email || "",
    phone: body.phone || "",
    skills: Array.isArray(body.skills) ? body.skills : [],
    specialties: Array.isArray(body.specialties) ? body.specialties : [],
    schedule: body.schedule || {},
    active: body.active !== false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  technicians.push(technician);
  writeTechnicians(technicians);
  appendLog({ type: "technician_create", id, timestamp: technician.createdAt, admin: "system" });
  res.status(201).json({ item: technician });
});

app.put("/api/admin/technicians/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  const technicians = readTechnicians();
  const idx = technicians.findIndex((t) => t.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: "Technician not found" });
  }
  const now = new Date().toISOString();
  const updated = {
    ...technicians[idx],
    ...req.body,
    id,
    updatedAt: now,
  };
  technicians[idx] = updated;
  writeTechnicians(technicians);
  appendLog({ type: "technician_update", id, timestamp: now, admin: "system" });
  res.json({ item: updated });
});

app.delete("/api/admin/technicians/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  const technicians = readTechnicians();
  const filtered = technicians.filter((t) => t.id !== id);
  if (filtered.length === technicians.length) {
    return res.status(404).json({ error: "Technician not found" });
  }
  writeTechnicians(filtered);
  appendLog({ type: "technician_delete", id, timestamp: new Date().toISOString(), admin: "system" });
  res.json({ ok: true });
});

// --- Orders Management ---
app.get("/api/admin/orders", requireAdmin, (req, res) => {
  const orders = readOrders();
  const status = req.query.status;
  const filtered = status ? orders.filter((o) => o.status === status) : orders;
  res.json({ items: filtered });
});

app.post("/api/admin/orders", requireAdmin, (req, res) => {
  const body = req.body || {};
  const orders = readOrders();
  const id = body.id && String(body.id).trim() ? String(body.id).trim() : `ORD-${Date.now()}`;
  const order = {
    id,
    customerName: body.customerName || "",
    whatsapp: body.whatsapp || "",
    email: body.email || "",
    items: Array.isArray(body.items) ? body.items : [],
    totalKES: body.totalKES || 0,
    paymentMethod: body.paymentMethod || "",
    paymentStatus: body.paymentStatus || "pending",
    status: body.status || "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  orders.push(order);
  writeOrders(orders);
  appendLog({ type: "order_create", id, timestamp: order.createdAt, admin: "system" });
  res.status(201).json({ item: order });
});

app.put("/api/admin/orders/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  const orders = readOrders();
  const idx = orders.findIndex((o) => o.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: "Order not found" });
  }
  const now = new Date().toISOString();
  const updated = {
    ...orders[idx],
    ...req.body,
    id,
    updatedAt: now,
  };
  orders[idx] = updated;
  writeOrders(orders);
  appendLog({ type: "order_update", id, timestamp: now, admin: "system" });
  res.json({ item: updated });
});

app.delete("/api/admin/orders/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  const orders = readOrders();
  const filtered = orders.filter((o) => o.id !== id);
  if (filtered.length === orders.length) {
    return res.status(404).json({ error: "Order not found" });
  }
  writeOrders(filtered);
  appendLog({ type: "order_delete", id, timestamp: new Date().toISOString(), admin: "system" });
  res.json({ ok: true });
});

// --- Promotions Management ---
app.get("/api/admin/promotions", requireAdmin, (req, res) => {
  const promotions = readPromotions();
  res.json({ items: promotions });
});

app.post("/api/admin/promotions", requireAdmin, (req, res) => {
  const body = req.body || {};
  const promotions = readPromotions();
  const id = body.id && String(body.id).trim() ? String(body.id).trim() : `promo-${Date.now()}`;
  const promotion = {
    id,
    code: body.code || "",
    name: body.name || "",
    description: body.description || "",
    discountType: body.discountType || "percentage", // percentage or fixed
    discountValue: body.discountValue || 0,
    minPurchase: body.minPurchase || 0,
    validFrom: body.validFrom || "",
    validUntil: body.validUntil || "",
    active: body.active !== false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  promotions.push(promotion);
  writePromotions(promotions);
  appendLog({ type: "promotion_create", id, timestamp: promotion.createdAt, admin: "system" });
  res.status(201).json({ item: promotion });
});

app.put("/api/admin/promotions/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  const promotions = readPromotions();
  const idx = promotions.findIndex((p) => p.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: "Promotion not found" });
  }
  const now = new Date().toISOString();
  const updated = {
    ...promotions[idx],
    ...req.body,
    id,
    updatedAt: now,
  };
  promotions[idx] = updated;
  writePromotions(promotions);
  appendLog({ type: "promotion_update", id, timestamp: now, admin: "system" });
  res.json({ item: updated });
});

app.delete("/api/admin/promotions/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  const promotions = readPromotions();
  const filtered = promotions.filter((p) => p.id !== id);
  if (filtered.length === promotions.length) {
    return res.status(404).json({ error: "Promotion not found" });
  }
  writePromotions(filtered);
  appendLog({ type: "promotion_delete", id, timestamp: new Date().toISOString(), admin: "system" });
  res.json({ ok: true });
});

// --- Blocked Dates Management ---
app.get("/api/admin/blocked-dates", requireAdmin, (req, res) => {
  const blocked = readBlockedDates();
  res.json({ items: blocked });
});

app.post("/api/admin/blocked-dates", requireAdmin, (req, res) => {
  const body = req.body || {};
  const blocked = readBlockedDates();
  const id = body.id && String(body.id).trim() ? String(body.id).trim() : `block-${Date.now()}`;
  const block = {
    id,
    date: body.date || "",
    reason: body.reason || "",
    createdAt: new Date().toISOString(),
  };
  blocked.push(block);
  writeBlockedDates(blocked);
  res.status(201).json({ item: block });
});

app.delete("/api/admin/blocked-dates/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  const blocked = readBlockedDates();
  const filtered = blocked.filter((b) => b.id !== id);
  if (filtered.length === blocked.length) {
    return res.status(404).json({ error: "Blocked date not found" });
  }
  writeBlockedDates(filtered);
  res.json({ ok: true });
});

// --- Reports & Analytics ---
app.get("/api/admin/reports/revenue", requireAdmin, (req, res) => {
  const orders = readOrders();
  const startDate = req.query.startDate;
  const endDate = req.query.endDate;
  
  let filtered = orders;
  if (startDate || endDate) {
    filtered = orders.filter((o) => {
      const orderDate = new Date(o.createdAt);
      if (startDate && orderDate < new Date(startDate)) return false;
      if (endDate && orderDate > new Date(endDate)) return false;
      return true;
    });
  }
  
  const completed = filtered.filter((o) => o.paymentStatus === "completed");
  const totalRevenue = completed.reduce((sum, o) => sum + (o.totalKES || 0), 0);
  const pendingRevenue = filtered
    .filter((o) => o.paymentStatus === "pending")
    .reduce((sum, o) => sum + (o.totalKES || 0), 0);
  
  res.json({
    totalRevenue,
    pendingRevenue,
    totalOrders: filtered.length,
    completedOrders: completed.length,
  });
});

app.get("/api/admin/reports/products", requireAdmin, (req, res) => {
  const orders = readOrders();
  const productSales = {};
  
  orders.forEach((order) => {
    if (order.paymentStatus === "completed" && Array.isArray(order.items)) {
      order.items.forEach((item) => {
        const productId = item.id || item.name || "unknown";
        productSales[productId] = (productSales[productId] || 0) + (item.quantity || 1);
      });
    }
  });
  
  const sorted = Object.entries(productSales)
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count);
  
  res.json({ items: sorted });
});

app.get("/api/admin/reports/services", requireAdmin, (req, res) => {
  const bookings = readBookings();
  const serviceCounts = {};
  
  bookings.forEach((booking) => {
    const service = booking.service || "unknown";
    serviceCounts[service] = (serviceCounts[service] || 0) + 1;
  });
  
  const sorted = Object.entries(serviceCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  
  res.json({ items: sorted });
});

app.get("/api/admin/reports/technicians", requireAdmin, (req, res) => {
  const repairs = readRepairs();
  const bookings = readBookings();
  const techStats = {};
  
  [...repairs, ...bookings].forEach((item) => {
    const tech = item.technician || "unassigned";
    if (!techStats[tech]) {
      techStats[tech] = { assigned: 0, completed: 0 };
    }
    techStats[tech].assigned++;
    if (item.status === "completed" || item.status === "Completed") {
      techStats[tech].completed++;
    }
  });
  
  const sorted = Object.entries(techStats).map(([name, stats]) => ({
    name,
    assigned: stats.assigned,
    completed: stats.completed,
    completionRate: stats.assigned > 0 ? ((stats.completed / stats.assigned) * 100).toFixed(1) : 0,
  }));
  
  res.json({ items: sorted });
});

app.get("/api/admin/reports/peak-times", requireAdmin, (req, res) => {
  const bookings = readBookings();
  const hourCounts = {};
  
  bookings.forEach((booking) => {
    if (booking.timeSlot) {
      const hour = booking.timeSlot.split(":")[0] || "unknown";
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    }
  });
  
  res.json({ items: Object.entries(hourCounts).map(([hour, count]) => ({ hour, count })) });
});

// --- Logs & Audit ---
app.get("/api/admin/logs", requireAdmin, (req, res) => {
  const logs = readLogs();
  const limit = Number(req.query.limit) || 100;
  const type = req.query.type;
  
  let filtered = logs;
  if (type) {
    filtered = logs.filter((l) => l.type === type);
  }
  
  const sorted = filtered
    .slice()
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
    .slice(0, limit);
  
  res.json({ items: sorted });
});

// --- Notifications ---
app.get("/api/admin/notifications", requireAdmin, (req, res) => {
  const notifications = readNotifications();
  res.json({ items: notifications });
});

// --- Wishlist API (public, user_id provided by client) ---
app.get("/api/wishlist", (req, res) => {
  const userId = (req.query.userId || "").trim();
  if (!userId) return res.json({ items: [] });
  const all = readWishlistItems();
  const items = all.filter((w) => w.user_id === userId);
  res.json({ items });
});

app.post("/api/wishlist", (req, res) => {
  const { userId, productId } = req.body || {};
  if (!userId || !productId) {
    return res.status(400).json({ error: "userId and productId are required" });
  }
  const all = readWishlistItems();
  const existing = all.find((w) => w.user_id === userId && w.product_id === productId);
  if (existing) {
    return res.json({ item: existing });
  }
  const now = new Date().toISOString();
  const item = {
    id: `wl-${Date.now()}`,
    user_id: userId,
    product_id: productId,
    created_at: now,
  };
  all.push(item);
  writeWishlistItems(all);
  res.status(201).json({ item });
});

app.delete("/api/wishlist", (req, res) => {
  const { userId, productId } = req.body || {};
  if (!userId || !productId) {
    return res.status(400).json({ error: "userId and productId are required" });
  }
  const all = readWishlistItems();
  const next = all.filter((w) => !(w.user_id === userId && w.product_id === productId));
  writeWishlistItems(next);
  res.json({ ok: true });
});

app.post("/api/admin/notifications", requireAdmin, (req, res) => {
  const body = req.body || {};
  const notifications = readNotifications();
  const id = body.id && String(body.id).trim() ? String(body.id).trim() : `notif-${Date.now()}`;
  const notification = {
    id,
    type: body.type || "general", // sms, email, general
    recipient: body.recipient || "",
    subject: body.subject || "",
    message: body.message || "",
    sent: false,
    createdAt: new Date().toISOString(),
  };
  notifications.push(notification);
  writeNotifications(notifications);
  res.status(201).json({ item: notification });
});

app.put("/api/admin/repairs/:id/status", requireAdmin, (req, res) => {
  const id = req.params.id;
  const { status, notes, parts } = req.body || {};
  const repairs = readRepairs();
  const idx = repairs.findIndex((r) => r.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: "Repair not found" });
  }
  const now = new Date().toISOString();
  const updated = {
    ...repairs[idx],
    status: status || repairs[idx].status,
    notes: notes !== undefined ? notes : repairs[idx].notes,
    partsUsed: parts !== undefined ? parts : repairs[idx].partsUsed,
    updatedAt: now,
  };
  repairs[idx] = updated;
  writeRepairs(repairs);
  appendLog({ type: "repair_status_update", id, status, timestamp: now, admin: "system" });
  res.json({ item: updated });
});

// 404 catch-all for /api/* routes not matched above
// Must be registered after all other routes
app.use("/api", (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
});

// Global error handler — catches unhandled exceptions in route handlers
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error("[ERROR] Unhandled route error:", err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error. Please try again." });
});

// Run the HTTP server when executed directly (local development).
// When Vercel imports this file as a serverless function it does not call listen().
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`▶ GAMEPLAN server running → http://localhost:${PORT}`);
    console.log(`  Admin dashboard → http://localhost:${PORT}/admin`);
    console.log(`  Chatbot status  → http://localhost:${PORT}/api/chat/status`);
  });
}

// Export the Express app for Vercel's serverless handler
module.exports = app;
