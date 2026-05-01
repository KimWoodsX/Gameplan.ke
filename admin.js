(function () {
  const ADMIN_KEY_STORAGE = "gameplan_admin_key";

  let currentSection = "overview";
  let revenueChart = null;
  let productSalesChart = null;
  let bookingsCache = [];
  let productsCache = [];
  let ordersCache = [];
  let premiumGearsCache = [];
  let shopCache = [];
  let peripheralsCache = [];

  function $(selector) {
    return document.querySelector(selector);
  }

  function $all(selector) {
    return Array.from(document.querySelectorAll(selector));
  }

  function setStatus(message, isError = false) {
    const el = $("#admin-global-status");
    if (!el) return;
    el.textContent = message || "";
    el.style.color = isError ? "#f97373" : "#22c55e";
  }

  // Admin key storage removed in favor of secure HttpOnly cookies.

  async function apiRequest(path, options = {}) {
    const opts = { ...options };
    opts.headers = { ...(opts.headers || {}) };

    // Auth is handled via secure session cookies automatically
    if (opts.body && !opts.headers["Content-Type"]) {
      opts.headers["Content-Type"] = "application/json";
    }

    const res = await fetch(path, opts);
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      // ignore JSON errors; data remains null
    }
    if (!res.ok) {
      const msg = (data && (data.error || data.message)) || `Request failed (${res.status})`;
      if (res.status === 401) {
        throw new Error("Unauthorized (check admin key)");
      }
      throw new Error(msg);
    }
    return data;
  }

  function formatKES(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return "KES 0";
    return "KES " + num.toLocaleString("en-KE", { maximumFractionDigits: 0 });
  }

  function formatDateTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  }

  function truncate(text, max = 80) {
    if (!text) return "";
    const s = String(text);
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + "…";
  }

  function switchSection(name) {
    currentSection = name;
    $all(".admin-nav-item").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.section === name);
    });
    $all(".admin-section").forEach((sec) => {
      sec.classList.toggle("is-active", sec.id === `section-${name}`);
    });
    setStatus("");
    const loader = sectionLoaders[name];
    if (typeof loader === "function") {
      loader().catch((err) => {
        console.error(err);
        setStatus(err.message || String(err), true);
      });
    }
  }

  async function loadOverview() {
    try {
      setStatus("Loading overview…");

      // Load high-level session info in a best-effort way so missing endpoint (404)
      // or older server versions do not break the overview.
      const sessionPromise = fetch("/api/admin/session").catch(() => null);

      const [sessionResRaw, chatsRes, statsRes, revenueRes] = await Promise.all([
        sessionPromise,
        apiRequest("/api/admin/chats?limit=20"),
        apiRequest("/api/admin/stats"),
        apiRequest("/api/admin/reports/revenue"),
      ]);

      let sessionRes = null;
      if (sessionResRaw && sessionResRaw.ok) {
        try {
          sessionRes = await sessionResRaw.json();
        } catch (e) {
          sessionRes = null;
        }
      }

      const roleEl = document.querySelector("#admin-session-role");
      const statusEl = document.querySelector("#admin-session-status");
      const expiryEl = document.querySelector("#admin-session-expiry");
      if (sessionRes && roleEl && statusEl && expiryEl) {
        const role = sessionRes.role || "Super Admin";
        const status = sessionRes.status || "active";
        const expiresAt = sessionRes.expiresAt;
        roleEl.textContent = `Role: ${role}`;
        statusEl.textContent = `Session: ${status}`;
        expiryEl.textContent = expiresAt ? `Expires: ${formatDateTime(expiresAt)}` : "Expires: -";
      }

      const chats = (chatsRes && chatsRes.items) || [];
      const chatsBody = $("#overview-chats-body");
      const chatCountEl = $("#overview-chat-count");
      if (chatsBody) {
        chatsBody.innerHTML = chats
          .map((c) => {
            const intent = c.intent || "-";
            const conversion = c.conversion || "";
            const result = conversion ? `DB Chat – ${conversion}` : "DB Chat";
            return `<tr>
              <td>${formatDateTime(c.timestamp || c.created_at)}</td>
              <td>${truncate(c.message || c.user_message || "")}</td>
              <td class="admin-mono">${intent}</td>
              <td class="admin-mono">${result}</td>
            </tr>`;
          })
          .join("");
      }
      if (chatCountEl) {
        chatCountEl.textContent = `${chats.length} chats`;
      }

      const byPath = (statsRes && statsRes.byPath) || {};
      const topProductsStat = (statsRes && statsRes.topProducts) || [];
      const pathsBody = $("#overview-paths-body");
      if (pathsBody) {
        const rows = Object.entries(byPath)
          .sort((a, b) => b[1] - a[1])
          .map(([path, count]) => `<tr><td class="admin-mono">${path}</td><td>${count}</td></tr>`);
        pathsBody.innerHTML = rows.join("");
      }
      const topProdBody = $("#overview-top-products-body");
      if (topProdBody) {
        topProdBody.innerHTML = topProductsStat
          .map((p) => `<tr><td class="admin-mono">${p.id}</td><td>${p.count}</td></tr>`)
          .join("");
      }

      const totalRevEl = $("#overview-total-revenue");
      const pendingRevEl = $("#overview-pending-revenue");
      const ordersCountEl = $("#overview-orders-count");
      const completedOrdersEl = $("#overview-completed-orders");
      if (revenueRes) {
        if (totalRevEl) totalRevEl.textContent = formatKES(revenueRes.totalRevenue);
        if (pendingRevEl) pendingRevEl.textContent = formatKES(revenueRes.pendingRevenue);
        if (ordersCountEl) ordersCountEl.textContent = `${revenueRes.totalOrders || 0} orders`;
        if (completedOrdersEl)
          completedOrdersEl.textContent = `${revenueRes.completedOrders || 0} completed`;
      }
      setStatus("");
    } catch (err) {
      console.error(err);
      setStatus(err.message || String(err), true);
      throw err;
    }
  }

  async function loadRepairs() {
    try {
      const res = await apiRequest("/api/admin/repairs");
      const repairs = (res && res.items) || [];
      const body = $("#repairs-table-body");
      if (!body) return;
      body.innerHTML = repairs
        .map((r) => {
          return `<tr data-id="${r.id}">
            <td class="admin-mono">${r.id}</td>
            <td>${truncate(r.customerName || "")}</td>
            <td>${r.console || ""}</td>
            <td>${r.status || ""}</td>
            <td>${formatDateTime(r.updatedAt || r.createdAt)}</td>
            <td><button type="button" class="btn btn-secondary btn-primary--small" data-repair-delete="${r.id}" style="background:rgba(239,68,68,0.1);border-color:rgba(239,68,68,0.5);color:#fca5a5;">Delete</button></td>
          </tr>`;
        })
        .join("");
    } catch (err) {
      console.error(err);
      setStatus(err.message || String(err), true);
      throw err;
    }
  }

  async function loadBookings() {
    try {
      const res = await apiRequest("/api/admin/bookings");
      const items = (res && res.items) || [];
      bookingsCache = items;
      const body = $("#bookings-table-body");
      if (!body) return;
      body.innerHTML = items
        .map((b) => {
          const isConfirmed = (b.status || "").toLowerCase() === "confirmed";
          const statusBadge = isConfirmed
            ? `<span style="color:#22c55e;font-weight:600;">${b.status}</span>`
            : b.status || "";
          const notifyBtn = b.whatsapp
            ? `<button type="button" class="btn btn-primary btn-primary--small" data-booking-notify="${b.id}" title="Send WhatsApp notification to ${b.customerName || 'customer'}" style="margin-left:4px;">Notify</button>`
            : `<span style="font-size:0.7rem;color:var(--text-soft);">No phone</span>`;
          return `<tr data-id="${b.id}">
            <td class="admin-mono">${b.id}</td>
            <td>${truncate(b.customerName || "")}</td>
            <td>${b.console || ""}</td>
            <td>${b.service || ""}</td>
            <td>${b.date || ""} ${b.timeSlot || ""}</td>
            <td>${statusBadge}</td>
            <td style="white-space:nowrap;">
              ${notifyBtn}
              <button type="button" class="btn btn-secondary btn-primary--small" data-booking-delete="${b.id}" style="background:rgba(239,68,68,0.1);border-color:rgba(239,68,68,0.5);color:#fca5a5;margin-left:4px;">Delete</button>
            </td>
          </tr>`;
        })
        .join("");
    } catch (err) {
      console.error(err);
      setStatus(err.message || String(err), true);
      throw err;
    }
  }

  async function loadProducts() {
    try {
      const res = await apiRequest("/api/admin/products");
      const items = (res && res.items) || [];
      productsCache = items;
      const body = $("#products-table-body");
      if (!body) return;
      body.innerHTML = items
        .map((p) => {
          const imgThumb = p.imageUrl
            ? `<img src="${p.imageUrl}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:4px;" />`
            : `<span style="color:var(--text-soft);font-size:0.75rem;">No image</span>`;
          return `<tr data-id="${p.id}">
            <td><input type="checkbox" class="product-checkbox" value="${p.id}" /></td>
            <td>${imgThumb}</td>
            <td class="admin-mono">${p.id}</td>
            <td>${truncate(p.name || "")}</td>
            <td>${p.category || ""}</td>
            <td>${p.priceKES != null ? p.priceKES : "-"}</td>
            <td>${p.stockQty != null ? p.stockQty : "-"}</td>
          </tr>`;
        })
        .join("");
    } catch (err) {
      console.error(err);
      setStatus(err.message || String(err), true);
      throw err;
    }
  }

  async function loadPremiumGears() {
    try {
      const res = await apiRequest("/api/admin/products");
      const items = (res && res.items) || [];
      productsCache = items;
      const body = $("#premium-gears-table-body");
      if (!body) return;
      // Filter for upgraded/premium products
      const premiumItems = items.filter((p) => p.upgraded === true);
      premiumGearsCache = premiumItems;
      body.innerHTML = premiumItems
        .map((p) => {
          const price = p.priceKES != null ? formatKES(p.priceKES) : "-";
          const imgThumb = p.imageUrl
            ? `<img src="${p.imageUrl}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:4px;" />`
            : `<span style="color:var(--text-soft);font-size:0.75rem;">No image</span>`;
          return `<tr data-id="${p.id}">
            <td>${imgThumb}</td>
            <td class="admin-mono">${p.id}</td>
            <td>${truncate(p.name || "")}</td>
            <td>${price}</td>
            <td><button type="button" class="btn btn-secondary btn-primary--small" data-premium-gear-delete="${p.id}">Delete</button></td>
          </tr>`;
        })
        .join("");
      if (!premiumItems.length) {
        body.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-soft);">No premium gears yet. Add one using the form.</td></tr>`;
      }
    } catch (err) {
      console.error(err);
      setStatus(err.message || String(err), true);
      throw err;
    }
  }

  async function loadRepairSupplies() {
    try {
      const res = await apiRequest("/api/admin/products");
      const items = (res && res.items) || [];
      productsCache = items;
      const body = $("#repair-supplies-table-body");
      if (!body) return;
      const supplies = items.filter((p) => {
        const cat = (p.category || "").toLowerCase();
        return cat === "repair" || p.repairProduct === true;
      });
      body.innerHTML = supplies
        .map((p) => {
          const price = p.priceKES != null ? p.priceKES : "-";
          const imgThumb = p.imageUrl
            ? `<img src="${p.imageUrl}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:4px;" />`
            : `<span style="color:var(--text-soft);font-size:0.75rem;">No image</span>`;
          return `<tr data-id="${p.id}">
            <td class="admin-mono">${p.id}</td>
            <td>${truncate(p.name || "")}</td>
            <td>${price}</td>
            <td>${imgThumb}</td>
            <td><button type="button" class="btn btn-secondary btn-primary--small" data-repair-supply-delete="${p.id}">Delete</button></td>
          </tr>`;
        })
        .join("");
    } catch (err) {
      console.error(err);
      setStatus(err.message || String(err), true);
      throw err;
    }
  }

  async function loadPeripherals() {
    try {
      const res = await apiRequest("/api/admin/products");
      const items = (res && res.items) || [];
      productsCache = items;
      const body = $("#peripherals-table-body");
      if (!body) return;
      const peripherals = items.filter((p) => {
        const cat = (p.category || "").toLowerCase();
        return cat === "peripheral" || p.peripheral === true;
      });
      peripheralsCache = peripherals;
      body.innerHTML = peripherals
        .map((p) => {
          const price = p.priceKES != null ? formatKES(p.priceKES) : "-";
          const imgThumb = p.imageUrl
            ? `<img src="${p.imageUrl}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:4px;" />`
            : `<span style="color:var(--text-soft);font-size:0.75rem;">No image</span>`;
          return `<tr data-id="${p.id}">
            <td>${imgThumb}</td>
            <td class="admin-mono">${p.id}</td>
            <td>${truncate(p.name || "")}</td>
            <td>${price}</td>
            <td><button type="button" class="btn btn-secondary btn-primary--small" data-peripheral-delete="${p.id}">Delete</button></td>
          </tr>`;
        })
        .join("");
      if (!peripherals.length) {
        body.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-soft);">No peripherals yet. Add one using the form.</td></tr>`;
      }
    } catch (err) {
      console.error(err);
      setStatus(err.message || String(err), true);
      throw err;
    }
  }

  async function loadShop() {
    try {
      const res = await apiRequest("/api/admin/products");
      const items = (res && res.items) || [];
      productsCache = items;
      const body = $("#shop-table-body");
      if (!body) return;
      // Show all products (featured products catalog)
      shopCache = items;
      body.innerHTML = items
        .map((p) => {
          const price = p.priceKES != null ? formatKES(p.priceKES) : "-";
          const imgThumb = p.imageUrl
            ? `<img src="${p.imageUrl}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:4px;" />`
            : `<span style="color:var(--text-soft);font-size:0.75rem;">No image</span>`;
          return `<tr data-id="${p.id}">
            <td><input type="checkbox" class="shop-product-checkbox" value="${p.id}" /></td>
            <td>${imgThumb}</td>
            <td class="admin-mono">${p.id}</td>
            <td>${truncate(p.name || "")}</td>
            <td>${price}</td>
            <td><button type="button" class="btn btn-outline btn-primary--small" data-shop-edit="${p.id}">Edit</button></td>
          </tr>`;
        })
        .join("");
      if (!items.length) {
        body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-soft);">No products yet. Products from shop.html will be automatically synced.</td></tr>`;
      }
    } catch (err) {
      console.error(err);
      setStatus(err.message || String(err), true);
      throw err;
    }
  }

  async function loadOrders() {
    try {
      const res = await apiRequest("/api/admin/orders");
      const items = (res && res.items) || [];
      ordersCache = items;
      const body = $("#orders-table-body");
      if (!body) return;
      body.innerHTML = items
        .map((o) => {
          return `<tr data-id="${o.id}">
            <td class="admin-mono">${o.id}</td>
            <td>${truncate(o.customerName || "")}</td>
            <td>${o.totalKES != null ? o.totalKES : "-"}</td>
            <td>${o.paymentMethod || ""} / ${o.paymentStatus || ""}</td>
            <td>${o.status || ""}</td>
            <td><button type="button" class="btn btn-secondary btn-primary--small" data-order-delete="${o.id}" style="background:rgba(239,68,68,0.1);border-color:rgba(239,68,68,0.5);color:#fca5a5;">Delete</button></td>
          </tr>`;
        })
        .join("");
    } catch (err) {
      console.error(err);
      setStatus(err.message || String(err), true);
      throw err;
    }
  }

  async function loadSettings() {
    try {
      const settings = await apiRequest("/api/admin/settings");
      const nairobi24h = $("#settings-nairobi24h");
      const dynPricing = $("#settings-dynamic-pricing");
      const tone = $("#settings-chatbot-tone");
      const businessHours = $("#settings-business-hours");
      const bookingRules = $("#settings-booking-rules");
      const taxRate = $("#settings-tax-rate");
      const serviceFee = $("#settings-service-fee");

      if (nairobi24h) {
        const val = settings?.delivery?.nairobi24h;
        nairobi24h.value = String(Boolean(val));
      }
      if (dynPricing) {
        dynPricing.value = String(Boolean(settings?.ai?.dynamicPricingSuggestions));
      }
      if (tone) {
        if (settings?.ai?.chatbotTone) tone.value = settings.ai.chatbotTone;
      }
      if (businessHours) {
        businessHours.value = settings?.businessHours
          ? JSON.stringify(settings.businessHours, null, 2)
          : "";
      }
      if (bookingRules) {
        bookingRules.value = settings?.bookingRules
          ? JSON.stringify(settings.bookingRules, null, 2)
          : "";
      }
      if (taxRate) {
        taxRate.value = settings?.taxRate != null ? String(settings.taxRate) : "";
      }
      if (serviceFee) {
        serviceFee.value = settings?.serviceFee != null ? String(settings.serviceFee) : "";
      }

      const statusEl = $("#settings-form-status");
      if (statusEl) statusEl.textContent = "Loaded current settings.";
    } catch (err) {
      console.error(err);
      const statusEl = $("#settings-form-status");
      if (statusEl) statusEl.textContent = err.message || String(err);
      setStatus(err.message || String(err), true);
      throw err;
    }
  }

  async function saveSettings(evt) {
    evt.preventDefault();
    const statusEl = $("#settings-form-status");
    if (statusEl) statusEl.textContent = "Saving…";
    try {
      const body = {};
      const nairobi24h = $("#settings-nairobi24h");
      const dynPricing = $("#settings-dynamic-pricing");
      const tone = $("#settings-chatbot-tone");
      const businessHours = $("#settings-business-hours");
      const bookingRules = $("#settings-booking-rules");
      const taxRate = $("#settings-tax-rate");
      const serviceFee = $("#settings-service-fee");

      body.delivery = {
      nairobi24h: nairobi24hValue(nairobi24h?.value),
      };
      body.ai = {
        dynamicPricingSuggestions: dynPricing?.value === "true",
        chatbotTone: tone?.value || "professional-warm",
      };

      if (businessHours && businessHours.value.trim()) {
        try {
          body.businessHours = JSON.parse(businessHours.value);
        } catch (e) {
          throw new Error("Business hours must be valid JSON.");
        }
      }
      if (bookingRules && bookingRules.value.trim()) {
        try {
          body.bookingRules = JSON.parse(bookingRules.value);
        } catch (e) {
          throw new Error("Booking rules must be valid JSON.");
        }
      }
      if (taxRate && taxRate.value.trim()) {
        body.taxRate = Number(taxRate.value);
      }
      if (serviceFee && serviceFee.value.trim()) {
        body.serviceFee = Number(serviceFee.value);
      }

      await apiRequest("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      if (statusEl) statusEl.textContent = "Settings saved.";
      setStatus("Settings updated.");
    } catch (err) {
      console.error(err);
      if (statusEl) statusEl.textContent = err.message || String(err);
      setStatus(err.message || String(err), true);
    }
  }

  function nairobi24hValue(val) {
    return val === "true";
  }

  async function loadLogs() {
    try {
      const res = await apiRequest("/api/admin/logs?limit=50");
      const items = (res && res.items) || [];
      const body = $("#logs-table-body");
      if (!body) return;
      body.innerHTML = items
        .map((l) => {
          return `<tr>
            <td>${formatDateTime(l.timestamp)}</td>
            <td>${l.type || ""}</td>
            <td class="admin-mono">${l.id || ""}</td>
          </tr>`;
        })
        .join("");
    } catch (err) {
      console.error(err);
      setStatus(err.message || String(err), true);
      throw err;
    }
  }

  async function loadReports() {
    try {
      const [revenueRes, productsRes] = await Promise.all([
        apiRequest("/api/admin/reports/revenue"),
        apiRequest("/api/admin/reports/products"),
      ]);

      const revenueCtx = $("#revenue-chart");
      const productCtx = $("#product-sales-chart");

      if (revenueCtx && window.Chart) {
        if (revenueChart) revenueChart.destroy();
        const completed = revenueRes?.totalRevenue || 0;
        const pending = revenueRes?.pendingRevenue || 0;
        revenueChart = new Chart(revenueCtx, {
          type: "bar",
          data: {
            labels: ["Completed", "Pending"],
            datasets: [
              {
                label: "Revenue (KES)",
                data: [completed, pending],
                backgroundColor: ["rgba(34, 197, 94, 0.7)", "rgba(234, 179, 8, 0.7)"],
              },
            ],
          },
          options: {
            responsive: true,
            plugins: {
              legend: { display: false },
            },
            scales: {
              y: {
                beginAtZero: true,
              },
            },
          },
        });
      }

      if (productCtx && window.Chart) {
        if (productSalesChart) productSalesChart.destroy();
        const items = (productsRes && productsRes.items) || [];
        const labels = items.map((p) => p.id);
        const counts = items.map((p) => p.count);
        productSalesChart = new Chart(productCtx, {
          type: "bar",
          data: {
            labels,
            datasets: [
              {
                label: "Units Sold",
                data: counts,
                backgroundColor: "rgba(56, 189, 248, 0.7)",
              },
            ],
          },
          options: {
            indexAxis: "y",
            responsive: true,
            plugins: {
              legend: { display: false },
            },
            scales: {
              x: {
                beginAtZero: true,
              },
            },
          },
        });
      }
    } catch (err) {
      console.error(err);
      setStatus(err.message || String(err), true);
      throw err;
    }
  }

  async function loadCommunications() {
    try {
      const res = await apiRequest("/api/admin/repairs/completed");
      const items = (res && res.items) || [];
      const body = $("#comms-repairs-body");
      if (!body) return;
      body.innerHTML = items
        .map((r) => {
          const contact = r.whatsapp || r.customer_contact || "";
          const summary = truncate(r.issue || r.notes || "");
          return `<tr data-id="${r.id}">
            <td class="admin-mono">${r.id}</td>
            <td>${truncate(r.customerName || "")}</td>
            <td>${r.console || ""}</td>
            <td>${r.status || ""}</td>
            <td>${contact}</td>
            <td><button type="button" class="btn btn-secondary btn-primary--small" data-comms-notify="${r.id}">Notify</button></td>
          </tr>`;
        })
        .join("");
    } catch (err) {
      console.error(err);
      setStatus(err.message || String(err), true);
      throw err;
    }
  }

  const sectionLoaders = {
    overview: loadOverview,
    repairs: loadRepairs,
    bookings: loadBookings,
    products: loadProducts,
    "premium-gears": loadPremiumGears,
    "repair-supplies": loadRepairSupplies,
    peripherals: loadPeripherals,
    shop: loadShop,
    orders: loadOrders,
    reports: loadReports,
    settings: loadSettings,
    communications: loadCommunications,
    security: loadLogs,
  };

  // Backend now enforces admin login via /admin/login and cookies.
  // This function is kept for compatibility but does nothing.
  async function ensureAdminAccess() {
    return;
  }

  function initNav() {
    $all(".admin-nav-item").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const name = btn.dataset.section;
        if (!name) return;
        switchSection(name);
      });
    });

    $all("[data-jump]").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const name = link.getAttribute("data-jump");
        if (name) switchSection(name);
      });
    });
  }

  function initAdminPasswordControls() {
    const form = $("#admin-password-form");
    const input = $("#admin-new-password");
    const logoutBtn = $("#admin-logout");
    const status = $("#admin-password-status");

    if (form && input) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const val = input.value.trim();
        if (!val) return;
        
        if (status) {
          status.textContent = "Updating password...";
          status.style.color = "var(--text-soft)";
        }
        
        try {
          await apiRequest("/api/admin/password", {
            method: "PUT",
            body: JSON.stringify({ newPassword: val })
          });
          if (status) {
            status.textContent = "Password updated successfully.";
            status.style.color = "#22c55e";
          }
          input.value = "";
        } catch (err) {
          if (status) {
            status.textContent = err.message || "Failed to update password";
            status.style.color = "#f97373";
          }
        }
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => {
        setStatus("Logging out...");
        window.location.href = "/admin/logout";
      });
    }
  }

  // Helper: disables a button and shows "Loading…" while loaderFn runs,
  // then restores it and shows a status message on success or error.
  function withLoading(btn, loaderFn, successMsg) {
    if (!btn) return;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Loading…";
    setStatus("Loading…");
    loaderFn()
      .then(() => {
        setStatus(successMsg || "Done.");
      })
      .catch((err) => {
        console.error(err);
        setStatus(err.message || String(err), true);
      })
      .finally(() => {
        btn.disabled = false;
        btn.textContent = original;
      });
  }

  function initRefreshControls() {
    // Global topbar refresh — reloads the current visible section
    const globalRefresh = $("#admin-refresh");
    if (globalRefresh) {
      globalRefresh.addEventListener("click", () => {
        const loader = sectionLoaders[currentSection];
        if (typeof loader === "function") {
          withLoading(globalRefresh, loader, "Refreshed.");
        }
      });
    }

    // Per-section reload buttons
    const reloadMap = [
      ["#repairs-refresh",        loadRepairs,        "Repair tickets reloaded."],
      ["#bookings-refresh",       loadBookings,       "Bookings reloaded."],
      ["#products-refresh",       loadProducts,       "Products reloaded."],
      ["#premium-gears-refresh",  loadPremiumGears,   "Premium gears reloaded."],
      ["#repair-supplies-refresh",loadRepairSupplies, "Repair supplies reloaded."],
      ["#peripherals-refresh",    loadPeripherals,    "Peripherals reloaded."],
      ["#shop-refresh",           loadShop,           "Shop reloaded."],
      ["#orders-refresh",         loadOrders,         "Orders reloaded."],
      ["#reports-refresh",        loadReports,        "Reports reloaded."],
      ["#communications-refresh", loadCommunications, "Communications reloaded."],
      ["#logs-refresh",           loadLogs,           "Logs reloaded."],
    ];

    reloadMap.forEach(([selector, loader, msg]) => {
      const btn = $(selector);
      if (btn) {
        btn.addEventListener("click", () => withLoading(btn, loader, msg));
      }
    });

    // Products: delete selected
    const productsDeleteSelected = $("#products-delete-selected");
    if (productsDeleteSelected) {
      productsDeleteSelected.addEventListener("click", async () => {
        const checkboxes = document.querySelectorAll(".product-checkbox:checked");
        if (checkboxes.length === 0) {
          setStatus("Please select at least one product to delete", true);
          return;
        }
        const productIds = Array.from(checkboxes).map(cb => cb.value);
        if (!confirm(`Delete ${productIds.length} product(s)? This cannot be undone.`)) return;
        try {
          setStatus("Deleting products…");
          productsDeleteSelected.disabled = true;
          let deleted = 0, failed = 0;
          for (const id of productIds) {
            try {
              await apiRequest(`/api/admin/products/${id}`, { method: "DELETE" });
              deleted++;
            } catch (err) {
              console.error(`Failed to delete product ${id}:`, err);
              failed++;
            }
          }
          if (deleted > 0) {
            setStatus(`Deleted ${deleted} product(s)${failed > 0 ? `, ${failed} failed.` : "."}`);
            await loadProducts();
          } else {
            setStatus("Failed to delete products.", true);
          }
        } catch (err) {
          console.error(err);
          setStatus(err.message || "Failed to delete products.", true);
        } finally {
          productsDeleteSelected.disabled = false;
        }
      });
    }

    // Products: select all
    const productsSelectAll = $("#products-select-all");
    if (productsSelectAll) {
      productsSelectAll.addEventListener("change", (e) => {
        document.querySelectorAll(".product-checkbox").forEach(cb => cb.checked = e.target.checked);
      });
    }

    // Shop: delete selected
    const shopDeleteSelected = $("#shop-delete-selected");
    if (shopDeleteSelected) {
      shopDeleteSelected.addEventListener("click", async () => {
        const checkboxes = document.querySelectorAll(".shop-product-checkbox:checked");
        if (checkboxes.length === 0) {
          setStatus("Please select at least one product to delete.", true);
          return;
        }
        const productIds = Array.from(checkboxes).map(cb => cb.value);
        if (!confirm(`Delete ${productIds.length} product(s)? This cannot be undone.`)) return;
        try {
          setStatus("Deleting products…");
          shopDeleteSelected.disabled = true;
          let deleted = 0, failed = 0;
          for (const id of productIds) {
            try {
              await apiRequest(`/api/admin/products/${id}`, { method: "DELETE" });
              deleted++;
            } catch (err) {
              console.error(`Failed to delete product ${id}:`, err);
              failed++;
            }
          }
          if (deleted > 0) {
            setStatus(`Deleted ${deleted} product(s)${failed > 0 ? `, ${failed} failed.` : "."}`);
            await loadShop();
          } else {
            setStatus("Failed to delete products.", true);
          }
        } catch (err) {
          console.error(err);
          setStatus(err.message || "Failed to delete products.", true);
        } finally {
          shopDeleteSelected.disabled = false;
        }
      });
    }

    // Shop: select all
    const shopSelectAll = $("#shop-select-all");
    if (shopSelectAll) {
      shopSelectAll.addEventListener("change", (e) => {
        document.querySelectorAll(".shop-product-checkbox").forEach(cb => cb.checked = e.target.checked);
      });
    }
  }

  function initRepairForm() {
    const form = $("#repair-form");
    const statusEl = $("#repair-form-status");
    const tableBody = $("#repairs-table-body");

    if (tableBody) {
      tableBody.addEventListener("click", (e) => {
        const deleteBtn = e.target.closest("[data-repair-delete]");
        if (!deleteBtn || !deleteBtn.dataset.repairDelete) return;
        const id = deleteBtn.dataset.repairDelete;
        if (!window.confirm("Delete this repair ticket? This cannot be undone.")) return;
        deleteBtn.disabled = true;
        apiRequest(`/api/admin/repairs/${encodeURIComponent(id)}`, { method: "DELETE" })
          .then(() => {
            setStatus("Repair ticket deleted.");
            loadRepairs().catch(() => {});
          })
          .catch((err) => {
            console.error(err);
            setStatus(err.message || String(err), true);
            deleteBtn.disabled = false;
          });
      });
    }

    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (statusEl) statusEl.textContent = "Saving ticket…";
      try {
        const id = $("#repair-id")?.value.trim();
        const body = {
          id: id || undefined,
          customerName: $("#repair-customer")?.value || "",
          whatsapp: $("#repair-whatsapp")?.value || "",
          console: $("#repair-console")?.value || "",
          status: $("#repair-status")?.value || "Received",
          issue: $("#repair-issue")?.value || "",
          notes: $("#repair-notes")?.value || "",
        };
        await apiRequest("/api/admin/repairs", {
          method: "POST",
          body: JSON.stringify(body),
        });
        if (statusEl) statusEl.textContent = "Ticket saved.";
        setStatus("Repair ticket saved.");
        form.reset();
        loadRepairs().catch(() => {});
      } catch (err) {
        console.error(err);
        if (statusEl) statusEl.textContent = err.message || String(err);
        setStatus(err.message || String(err), true);
      }
    });
  }

  function initBookingForm() {
    const form = $("#booking-form");
    const statusEl = $("#booking-form-status");
    const modeInput = $("#booking-mode");
    const newBtn = $("#booking-new");
    const tableBody = $("#bookings-table-body");

    if (newBtn && modeInput && form) {
      newBtn.addEventListener("click", () => {
        modeInput.value = "create";
        form.reset();
        statusEl && (statusEl.textContent = "");
      });
    }

    if (tableBody) {
      tableBody.addEventListener("click", (e) => {
        // --- Notify button ---
        const notifyBtn = e.target.closest("[data-booking-notify]");
        if (notifyBtn && notifyBtn.dataset.bookingNotify) {
          const id = notifyBtn.dataset.bookingNotify;
          notifyBtn.disabled = true;
          notifyBtn.textContent = "Sending…";
          apiRequest(`/api/admin/bookings/${encodeURIComponent(id)}/notify`, { method: "POST", body: JSON.stringify({}) })
            .then((data) => {
              if (data && data.whatsappUrl) {
                window.open(data.whatsappUrl, "_blank");
                setStatus(`Notification ready for ${id}. WhatsApp opened — tap Send to deliver it.`);
              } else {
                setStatus("Notification logged but no WhatsApp number found.", true);
              }
              notifyBtn.textContent = "Notified ✓";
              notifyBtn.style.opacity = "0.6";
            })
            .catch((err) => {
              console.error(err);
              setStatus(err.message || "Failed to send notification.", true);
              notifyBtn.disabled = false;
              notifyBtn.textContent = "Notify";
            });
          return;
        }

        // --- Delete button ---
        const deleteBtn = e.target.closest("[data-booking-delete]");
        if (deleteBtn && deleteBtn.dataset.bookingDelete) {
          const id = deleteBtn.dataset.bookingDelete;
          if (!window.confirm("Delete this booking? This cannot be undone.")) return;
          deleteBtn.disabled = true;
          apiRequest(`/api/admin/bookings/${encodeURIComponent(id)}`, { method: "DELETE" })
            .then(() => {
              setStatus("Booking deleted.");
              loadBookings().catch(() => {});
            })
            .catch((err) => {
              console.error(err);
              setStatus(err.message || String(err), true);
              deleteBtn.disabled = false;
            });
          return;
        }
      });
    }

    if (tableBody && modeInput && form) {
      tableBody.addEventListener("click", (e) => {
        if (e.target.closest("[data-booking-delete]")) return;
        const tr = e.target.closest("tr");
        if (!tr || !tr.dataset.id) return;
        const id = tr.dataset.id;
        const booking = bookingsCache.find((b) => b.id === id);
        if (!booking) return;
        modeInput.value = "update";
        $("#booking-id").value = booking.id || "";
        $("#booking-customer").value = booking.customerName || "";
        $("#booking-whatsapp").value = booking.whatsapp || "";
        $("#booking-console").value = booking.console || "";
        $("#booking-service").value = booking.service || "";
        $("#booking-date").value = booking.date || "";
        $("#booking-time").value = booking.timeSlot || "";
        $("#booking-technician").value = booking.technician || "";
        $("#booking-status").value = booking.status || "pending";
        $("#booking-notes").value = booking.notes || "";
        statusEl && (statusEl.textContent = "Editing existing booking.");
      });
    }

    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (statusEl) statusEl.textContent = "Saving booking…";
      try {
        const id = $("#booking-id")?.value.trim();
        const mode = modeInput ? modeInput.value : "create";
        const body = {
          id: id || undefined,
          customerName: $("#booking-customer")?.value || "",
          whatsapp: $("#booking-whatsapp")?.value || "",
          console: $("#booking-console")?.value || "",
          service: $("#booking-service")?.value || "",
          date: $("#booking-date")?.value || "",
          timeSlot: $("#booking-time")?.value || "",
          technician: $("#booking-technician")?.value || "",
          status: $("#booking-status")?.value || "pending",
          notes: $("#booking-notes")?.value || "",
        };

        let savedRes;
        if (mode === "update" && id) {
          savedRes = await apiRequest(`/api/admin/bookings/${encodeURIComponent(id)}`, {
            method: "PUT",
            body: JSON.stringify(body),
          });
        } else {
          savedRes = await apiRequest("/api/admin/bookings", {
            method: "POST",
            body: JSON.stringify(body),
          });
        }
        if (statusEl) statusEl.textContent = "Booking saved.";
        setStatus("Booking saved.");
        form.reset();
        if (modeInput) modeInput.value = "create";
        loadBookings().catch(() => {});

        // Auto-open WhatsApp when status is set to "confirmed" and
        // the backend has generated a pre-filled notification URL.
        if (savedRes && savedRes.notifyReady && savedRes.whatsappUrl) {
          window.open(savedRes.whatsappUrl, "_blank");
          setStatus("Booking confirmed ✅ — WhatsApp opened. Tap Send to notify the customer.");
          if (statusEl)
            statusEl.textContent =
              "✅ Booking confirmed. WhatsApp opened — tap Send to notify the customer.";
        }
      } catch (err) {
        console.error(err);
        if (statusEl) statusEl.textContent = err.message || String(err);
        setStatus(err.message || String(err), true);
      }
    });
  }

  function initProductForm() {
    const form = $("#product-form");
    const statusEl = $("#product-form-status");
    const modeInput = $("#product-mode");
    const newBtn = $("#product-new");
    const tableBody = $("#products-table-body");
    const fileInput = $("#product-image-file");
    const urlInput = $("#product-image-url");
    const previewImg = $("#product-image-preview");
    const previewPlaceholder = $("#product-image-preview-placeholder");

    if (fileInput && urlInput) {
      fileInput.addEventListener("change", () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result;
          urlInput.value = typeof dataUrl === "string" ? dataUrl : "";
          if (previewImg) {
            previewImg.src = urlInput.value;
            previewImg.style.display = urlInput.value ? "block" : "none";
          }
          if (previewPlaceholder) {
            previewPlaceholder.style.display = urlInput.value ? "none" : "block";
          }
        };
        reader.readAsDataURL(file);
      });
    }

    if (newBtn && modeInput && form) {
      newBtn.addEventListener("click", () => {
        modeInput.value = "create";
        form.reset();
        if (previewImg) {
          previewImg.src = "";
          previewImg.style.display = "none";
        }
        if (previewPlaceholder) {
          previewPlaceholder.style.display = "block";
        }
        statusEl && (statusEl.textContent = "");
      });
    }

    if (tableBody && modeInput && form) {
      tableBody.addEventListener("click", (e) => {
        const tr = e.target.closest("tr");
        if (!tr || !tr.dataset.id) return;
        const id = tr.dataset.id;
        const product = productsCache.find((p) => p.id === id);
        if (!product) return;
        modeInput.value = "update";
        $("#product-id").value = product.id || "";
        $("#product-name").value = product.name || "";
        $("#product-category").value = product.category || "";
        $("#product-price").value = product.priceKES != null ? product.priceKES : "";
        $("#product-stock").value = product.stockQty != null ? product.stockQty : "";
        $("#product-restock").value = product.restockEta || "";
        $("#product-description").value = product.description || "";
        $("#product-aliases").value = Array.isArray(product.aliases)
          ? product.aliases.join(", ")
          : "";
        $("#product-image-url").value = product.imageUrl || "";
        if (previewImg && previewPlaceholder) {
          if (product.imageUrl) {
            previewImg.src = product.imageUrl;
            previewImg.style.display = "block";
            previewPlaceholder.style.display = "none";
          } else {
            previewImg.src = "";
            previewImg.style.display = "none";
            previewPlaceholder.style.display = "block";
          }
        }
        const upgradedInput = $("#product-upgraded");
        if (upgradedInput) upgradedInput.checked = !!product.upgraded;
        statusEl && (statusEl.textContent = "Editing existing product.");
      });
    }

    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (statusEl) statusEl.textContent = "Saving product…";
      try {
        const id = $("#product-id")?.value.trim();
        const mode = modeInput ? modeInput.value : "create";
        const aliasesRaw = $("#product-aliases")?.value || "";
        const aliases = aliasesRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const upgradedInput = $("#product-upgraded");
        const body = {
          id: id || undefined,
          name: $("#product-name")?.value || "",
          category: $("#product-category")?.value || "",
          priceKES: $("#product-price")?.value ? Number($("#product-price").value) : undefined,
          stockQty: $("#product-stock")?.value ? Number($("#product-stock").value) : undefined,
          restockEta: $("#product-restock")?.value || undefined,
          description: $("#product-description")?.value || "",
          aliases: aliases.length ? aliases : undefined,
          imageUrl: $("#product-image-url")?.value || undefined,
          upgraded: upgradedInput ? !!upgradedInput.checked : undefined,
        };

        if (mode === "update" && id) {
          await apiRequest(`/api/admin/products/${encodeURIComponent(id)}`, {
            method: "PUT",
            body: JSON.stringify(body),
          });
        } else {
          await apiRequest("/api/admin/products", {
            method: "POST",
            body: JSON.stringify(body),
          });
        }
        if (statusEl) statusEl.textContent = "Product saved.";
        setStatus("Product saved.");
        form.reset();
        if (modeInput) modeInput.value = "create";
        loadProducts().catch(() => {});
      } catch (err) {
        console.error(err);
        if (statusEl) statusEl.textContent = err.message || String(err);
        setStatus(err.message || String(err), true);
      }
    });
  }

  function initPremiumGearForm() {
    const form = $("#premium-gear-form");
    const statusEl = $("#premium-gear-form-status");
    const modeInput = $("#premium-gear-mode");
    const newBtn = $("#premium-gear-new");
    const clearBtn = $("#premium-gear-clear");
    const tableBody = $("#premium-gears-table-body");
    const fileInput = $("#premium-gear-image-file");
    const urlInput = $("#premium-gear-image-url");
    const previewImg = $("#premium-gear-image-preview");
    const previewPlaceholder = $("#premium-gear-image-preview-placeholder");

    // Helper to update preview
    function updatePreview(src) {
      if (previewImg && previewPlaceholder) {
        if (src) {
          previewImg.src = src;
          previewImg.style.display = "block";
          previewPlaceholder.style.display = "none";
        } else {
          previewImg.src = "";
          previewImg.style.display = "none";
          previewPlaceholder.style.display = "block";
        }
      }
    }

    // File upload handler - converts to base64 data URL
    if (fileInput) {
      fileInput.addEventListener("change", () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result;
          if (urlInput) urlInput.value = typeof dataUrl === "string" ? dataUrl : "";
          updatePreview(urlInput ? urlInput.value : "");
        };
        reader.readAsDataURL(file);
      });
    }

    // URL input handler - updates preview when URL is pasted
    if (urlInput) {
      urlInput.addEventListener("input", () => {
        const url = urlInput.value.trim();
        updatePreview(url);
      });
      // Also handle paste event
      urlInput.addEventListener("paste", () => {
        setTimeout(() => {
          const url = urlInput.value.trim();
          updatePreview(url);
        }, 50);
      });
    }

    // New button - reset form
    if (newBtn && modeInput && form) {
      newBtn.addEventListener("click", () => {
        modeInput.value = "create";
        form.reset();
        updatePreview("");
        if (statusEl) statusEl.textContent = "";
      });
    }

    // Clear button
    if (clearBtn && form) {
      clearBtn.addEventListener("click", () => {
        if (modeInput) modeInput.value = "create";
        form.reset();
        updatePreview("");
        if (statusEl) statusEl.textContent = "Form cleared.";
      });
    }

    // Table row click - load for editing
    if (tableBody && modeInput && form) {
      tableBody.addEventListener("click", (e) => {
        // Handle delete button
        const deleteBtn = e.target.closest("[data-premium-gear-delete]");
        if (deleteBtn && deleteBtn.dataset.premiumGearDelete) {
          const id = deleteBtn.dataset.premiumGearDelete;
          if (!id) return;
          if (!window.confirm("Delete this premium gear?")) return;
          apiRequest(`/api/admin/products/${encodeURIComponent(id)}`, {
            method: "DELETE",
          })
            .then(() => {
              setStatus("Premium gear deleted.");
              loadPremiumGears().catch(() => {});
            })
            .catch((err) => {
              console.error(err);
              setStatus(err.message || String(err), true);
            });
          return;
        }

        // Handle row click for editing
        const tr = e.target.closest("tr");
        if (!tr || !tr.dataset.id) return;
        const id = tr.dataset.id;
        const product = premiumGearsCache.find((p) => p.id === id) || productsCache.find((p) => p.id === id);
        if (!product) return;
        
        modeInput.value = "update";
        $("#premium-gear-id").value = product.id || "";
        $("#premium-gear-name").value = product.name || "";
        $("#premium-gear-category").value = product.category || "";
        $("#premium-gear-price").value = product.priceKES != null ? product.priceKES : "";
        $("#premium-gear-description").value = product.description || "";
        const compat = (product.specs && (product.specs.compatibility || product.specs.platform)) || "";
        $("#premium-gear-compatibility").value = compat;
        $("#premium-gear-image-url").value = product.imageUrl || "";
        updatePreview(product.imageUrl || "");
        if (statusEl) statusEl.textContent = "Editing: " + (product.name || product.id);
      });
    }

    // Form submit
    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (statusEl) statusEl.textContent = "Saving premium gear…";
      try {
        const id = $("#premium-gear-id")?.value.trim();
        const mode = modeInput ? modeInput.value : "create";
        const compatibility = $("#premium-gear-compatibility")?.value.trim() || "";
        
        const body = {
          id: id || undefined,
          name: $("#premium-gear-name")?.value || "",
          category: $("#premium-gear-category")?.value || "Premium Gear",
          priceKES: $("#premium-gear-price")?.value
            ? Number($("#premium-gear-price").value)
            : undefined,
          description: $("#premium-gear-description")?.value || "",
          imageUrl: $("#premium-gear-image-url")?.value || undefined,
          upgraded: true, // Mark as premium/upgraded
          specs: compatibility ? { compatibility } : undefined,
        };

        if (mode === "update" && id) {
          await apiRequest(`/api/admin/products/${encodeURIComponent(id)}`, {
            method: "PUT",
            body: JSON.stringify(body),
          });
        } else {
          await apiRequest("/api/admin/products", {
            method: "POST",
            body: JSON.stringify(body),
          });
        }
        if (statusEl) statusEl.textContent = "Premium gear saved successfully!";
        setStatus("Premium gear saved.");
        form.reset();
        updatePreview("");
        if (modeInput) modeInput.value = "create";
        loadPremiumGears().catch(() => {});
      } catch (err) {
        console.error(err);
        if (statusEl) statusEl.textContent = err.message || String(err);
        setStatus(err.message || String(err), true);
      }
    });
  }

  function initShopForm() {
    const form = $("#shop-form");
    const statusEl = $("#shop-form-status");
    const modeInput = $("#shop-mode");
    const newBtn = $("#shop-new");
    const clearBtn = $("#shop-clear");
    const tableBody = $("#shop-table-body");
    const fileInput = $("#shop-image-file");
    const urlInput = $("#shop-image-url");
    const previewImg = $("#shop-image-preview");
    const previewPlaceholder = $("#shop-image-preview-placeholder");

    // Helper to update preview
    function updatePreview(src) {
      if (previewImg && previewPlaceholder) {
        if (src) {
          previewImg.src = src;
          previewImg.style.display = "block";
          previewPlaceholder.style.display = "none";
        } else {
          previewImg.src = "";
          previewImg.style.display = "none";
          previewPlaceholder.style.display = "block";
        }
      }
    }

    // File upload handler - converts to base64 data URL
    if (fileInput) {
      fileInput.addEventListener("change", () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result;
          if (urlInput) urlInput.value = typeof dataUrl === "string" ? dataUrl : "";
          updatePreview(urlInput ? urlInput.value : "");
        };
        reader.readAsDataURL(file);
      });
    }

    // URL input handler - updates preview when URL is pasted
    if (urlInput) {
      urlInput.addEventListener("input", () => {
        const url = urlInput.value.trim();
        updatePreview(url);
      });
      // Also handle paste event
      urlInput.addEventListener("paste", () => {
        setTimeout(() => {
          const url = urlInput.value.trim();
          updatePreview(url);
        }, 50);
      });
    }

    // New button - reset form
    if (newBtn && modeInput && form) {
      newBtn.addEventListener("click", () => {
        modeInput.value = "create";
        form.reset();
        updatePreview("");
        if (statusEl) statusEl.textContent = "";
      });
    }

    // Clear button
    if (clearBtn && form) {
      clearBtn.addEventListener("click", () => {
        if (modeInput) modeInput.value = "create";
        form.reset();
        updatePreview("");
        if (statusEl) statusEl.textContent = "Form cleared.";
      });
    }

    // Table row click - load for editing
    if (tableBody && modeInput && form) {
      tableBody.addEventListener("click", (e) => {
        // Handle edit button or row click for editing
        const editBtn = e.target.closest("[data-shop-edit]");
        const tr = e.target.closest("tr");
        
        let id = null;
        if (editBtn && editBtn.dataset.shopEdit) {
          id = editBtn.dataset.shopEdit;
        } else if (tr && tr.dataset.id) {
          id = tr.dataset.id;
        }
        
        if (!id) return;
        const product = shopCache.find((p) => p.id === id) || productsCache.find((p) => p.id === id);
        if (!product) return;
        
        modeInput.value = "update";
        $("#shop-id").value = product.id || "";
        $("#shop-name").value = product.name || "";
        $("#shop-category").value = product.category || "";
        $("#shop-price").value = product.priceKES != null ? product.priceKES : "";
        $("#shop-description").value = product.description || "";
        $("#shop-image-url").value = product.imageUrl || "";
        updatePreview(product.imageUrl || "");
        if (statusEl) statusEl.textContent = "Editing: " + (product.name || product.id);
      });
    }

    // Form submit
    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (statusEl) statusEl.textContent = "Saving product…";
      try {
        const id = $("#shop-id")?.value.trim();
        const mode = modeInput ? modeInput.value : "create";
        
        // Build body - only include fields that have values to avoid overwriting
        const body = {
          id: id || undefined,
          name: $("#shop-name")?.value || undefined,
          category: $("#shop-category")?.value || undefined,
          priceKES: $("#shop-price")?.value
            ? Number($("#shop-price").value)
            : undefined,
          description: $("#shop-description")?.value || undefined,
          imageUrl: $("#shop-image-url")?.value || undefined,
        };

        if (mode === "update" && id) {
          await apiRequest(`/api/admin/products/${encodeURIComponent(id)}`, {
            method: "PUT",
            body: JSON.stringify(body),
          });
          if (statusEl) statusEl.textContent = "Product updated successfully!";
          setStatus("Product updated.");
        } else {
          await apiRequest("/api/admin/products", {
            method: "POST",
            body: JSON.stringify(body),
          });
          if (statusEl) statusEl.textContent = "Product created successfully!";
          setStatus("Product created.");
        }
        form.reset();
        updatePreview("");
        if (modeInput) modeInput.value = "create";
        loadShop().catch(() => {});
      } catch (err) {
        console.error(err);
        if (statusEl) statusEl.textContent = err.message || String(err);
        setStatus(err.message || String(err), true);
      }
    });
  }

  function initRepairSupplyForm() {
    const form = $("#repair-supply-form");
    const statusEl = $("#repair-supply-form-status");
    const modeInput = $("#repair-supply-mode");
    const newBtn = $("#repair-supply-new");
    const tableBody = $("#repair-supplies-table-body");
    const imageInput = $("#repair-supply-image");
    const fileInput = $("#repair-supply-image-file");

    if (fileInput && imageInput) {
      fileInput.addEventListener("change", () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result;
          imageInput.value = typeof dataUrl === "string" ? dataUrl : "";
        };
        reader.readAsDataURL(file);
      });
    }

    if (newBtn && modeInput && form) {
      newBtn.addEventListener("click", () => {
        modeInput.value = "create";
        form.reset();
        statusEl && (statusEl.textContent = "");
      });
    }

    if (tableBody && modeInput && form) {
      tableBody.addEventListener("click", (e) => {
        const deleteBtn = e.target.closest("[data-repair-supply-delete]");
        if (deleteBtn && deleteBtn.dataset.repairSupplyDelete) {
          const id = deleteBtn.dataset.repairSupplyDelete;
          if (!id) return;
          if (!window.confirm("Delete this repair supply?")) return;
          apiRequest(`/api/admin/products/${encodeURIComponent(id)}`, {
            method: "DELETE",
          })
            .then(() => {
              setStatus("Repair supply deleted.");
              loadRepairSupplies().catch(() => {});
            })
            .catch((err) => {
              console.error(err);
              setStatus(err.message || String(err), true);
            });
          return;
        }

        const tr = e.target.closest("tr");
        if (!tr || !tr.dataset.id) return;
        const id = tr.dataset.id;
        const product = productsCache.find((p) => p.id === id);
        if (!product) return;
        modeInput.value = "update";
        $("#repair-supply-id").value = product.id || "";
        $("#repair-supply-name").value = product.name || "";
        $("#repair-supply-price").value = product.priceKES != null ? product.priceKES : "";
        $("#repair-supply-image").value = product.imageUrl || "";
        statusEl && (statusEl.textContent = "Editing existing repair supply.");
      });
    }

    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (statusEl) statusEl.textContent = "Saving repair supply…";
      try {
        const id = $("#repair-supply-id")?.value.trim();
        const mode = modeInput ? modeInput.value : "create";
        const body = {
          id: id || undefined,
          name: $("#repair-supply-name")?.value || "",
          category: "repair",
          priceKES: $("#repair-supply-price")?.value
            ? Number($("#repair-supply-price").value)
            : undefined,
          imageUrl: $("#repair-supply-image")?.value || undefined,
          repairProduct: true,
        };

        if (mode === "update" && id) {
          await apiRequest(`/api/admin/products/${encodeURIComponent(id)}`, {
            method: "PUT",
            body: JSON.stringify(body),
          });
        } else {
          await apiRequest("/api/admin/products", {
            method: "POST",
            body: JSON.stringify(body),
          });
        }
        if (statusEl) statusEl.textContent = "Repair supply saved.";
        setStatus("Repair supply saved.");
        form.reset();
        if (modeInput) modeInput.value = "create";
        loadRepairSupplies().catch(() => {});
      } catch (err) {
        console.error(err);
        if (statusEl) statusEl.textContent = err.message || String(err);
        setStatus(err.message || String(err), true);
      }
    });
  }

  function initPeripheralsForm() {
    const form = $("#peripherals-form");
    const statusEl = $("#peripherals-form-status");
    const modeInput = $("#peripherals-mode");
    const newBtn = $("#peripherals-new");
    const clearBtn = $("#peripherals-clear");
    const tableBody = $("#peripherals-table-body");
    const fileInput = $("#peripherals-image-file");
    const urlInput = $("#peripherals-image-url");
    const previewImg = $("#peripherals-image-preview");
    const previewPlaceholder = $("#peripherals-image-preview-placeholder");

    function updatePreview(src) {
      if (previewImg && previewPlaceholder) {
        if (src) {
          previewImg.src = src;
          previewImg.style.display = "block";
          previewPlaceholder.style.display = "none";
        } else {
          previewImg.src = "";
          previewImg.style.display = "none";
          previewPlaceholder.style.display = "block";
        }
      }
    }

    if (fileInput) {
      fileInput.addEventListener("change", () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result;
          if (urlInput) urlInput.value = typeof dataUrl === "string" ? dataUrl : "";
          updatePreview(urlInput ? urlInput.value : "");
        };
        reader.readAsDataURL(file);
      });
    }

    if (urlInput) {
      urlInput.addEventListener("input", () => updatePreview(urlInput.value.trim()));
      urlInput.addEventListener("paste", () => setTimeout(() => updatePreview(urlInput.value.trim()), 50));
    }

    if (newBtn && modeInput && form) {
      newBtn.addEventListener("click", () => {
        modeInput.value = "create";
        form.reset();
        updatePreview("");
        if (statusEl) statusEl.textContent = "";
      });
    }

    if (clearBtn && form) {
      clearBtn.addEventListener("click", () => {
        if (modeInput) modeInput.value = "create";
        form.reset();
        updatePreview("");
        if (statusEl) statusEl.textContent = "Form cleared.";
      });
    }

    if (tableBody && modeInput && form) {
      tableBody.addEventListener("click", (e) => {
        const deleteBtn = e.target.closest("[data-peripheral-delete]");
        if (deleteBtn && deleteBtn.dataset.peripheralDelete) {
          const id = deleteBtn.dataset.peripheralDelete;
          if (!id) return;
          if (!window.confirm("Delete this peripheral?")) return;
          apiRequest(`/api/admin/products/${encodeURIComponent(id)}`, { method: "DELETE" })
            .then(() => {
              setStatus("Peripheral deleted.");
              loadPeripherals().catch(() => {});
            })
            .catch((err) => {
              console.error(err);
              setStatus(err.message || String(err), true);
            });
          return;
        }

        const tr = e.target.closest("tr");
        if (!tr || !tr.dataset.id) return;
        const id = tr.dataset.id;
        const product = peripheralsCache.find((p) => p.id === id) || productsCache.find((p) => p.id === id);
        if (!product) return;
        modeInput.value = "update";
        $("#peripherals-id").value = product.id || "";
        $("#peripherals-name").value = product.name || "";
        $("#peripherals-category").value = product.category || "";
        $("#peripherals-price").value = product.priceKES != null ? product.priceKES : "";
        $("#peripherals-description").value = product.description || "";
        const compat = (product.specs && (product.specs.compatibility || product.specs.platform)) || product.compatibility || "";
        $("#peripherals-compatibility").value = compat;
        $("#peripherals-image-url").value = product.imageUrl || "";
        updatePreview(product.imageUrl || "");
        if (statusEl) statusEl.textContent = "Editing: " + (product.name || product.id);
      });
    }

    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (statusEl) statusEl.textContent = "Saving peripheral…";
      try {
        const id = $("#peripherals-id")?.value.trim();
        const mode = modeInput ? modeInput.value : "create";
        const compatibility = $("#peripherals-compatibility")?.value.trim() || "";
        const body = {
          id: id || undefined,
          name: $("#peripherals-name")?.value || "",
          category: "peripheral",
          priceKES: $("#peripherals-price")?.value ? Number($("#peripherals-price").value) : undefined,
          description: $("#peripherals-description")?.value || "",
          imageUrl: $("#peripherals-image-url")?.value || undefined,
          peripheral: true,
          specs: compatibility ? { compatibility } : undefined,
        };

        if (mode === "update" && id) {
          await apiRequest(`/api/admin/products/${encodeURIComponent(id)}`, {
            method: "PUT",
            body: JSON.stringify(body),
          });
        } else {
          await apiRequest("/api/admin/products", {
            method: "POST",
            body: JSON.stringify(body),
          });
        }
        if (statusEl) statusEl.textContent = "Peripheral saved successfully!";
        setStatus("Peripheral saved.");
        form.reset();
        updatePreview("");
        if (modeInput) modeInput.value = "create";
        loadPeripherals().catch(() => {});
      } catch (err) {
        console.error(err);
        if (statusEl) statusEl.textContent = err.message || String(err);
        setStatus(err.message || String(err), true);
      }
    });
  }

  function initOrderForm() {
    const form = $("#order-form");
    const statusEl = $("#order-form-status");
    const tableBody = $("#orders-table-body");

    if (tableBody) {
      tableBody.addEventListener("click", (e) => {
        const deleteBtn = e.target.closest("[data-order-delete]");
        if (deleteBtn && deleteBtn.dataset.orderDelete) {
          const id = deleteBtn.dataset.orderDelete;
          if (!window.confirm("Delete this order? This cannot be undone.")) return;
          deleteBtn.disabled = true;
          apiRequest(`/api/admin/orders/${encodeURIComponent(id)}`, { method: "DELETE" })
            .then(() => {
              setStatus("Order deleted.");
              loadOrders().catch(() => {});
            })
            .catch((err) => {
              console.error(err);
              setStatus(err.message || String(err), true);
              deleteBtn.disabled = false;
            });
          return;
        }

        const tr = e.target.closest("tr");
        if (!tr || !tr.dataset.id) return;
        const id = tr.dataset.id;
        const order = ordersCache.find((o) => o.id === id);
        if (!order) return;
        $("#order-id").value = order.id || "";
        $("#order-payment-status").value = order.paymentStatus || "pending";
        $("#order-status").value = order.status || "pending";
        statusEl && (statusEl.textContent = "Loaded order. You can now update status/payment.");
      });
    }

    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (statusEl) statusEl.textContent = "Updating order…";
      try {
        const id = $("#order-id")?.value.trim();
        if (!id) {
          throw new Error("Order ID is required.");
        }
        const body = {
          paymentStatus: $("#order-payment-status")?.value || "pending",
          status: $("#order-status")?.value || "pending",
        };
        await apiRequest(`/api/admin/orders/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
        if (statusEl) statusEl.textContent = "Order updated.";
        setStatus("Order updated.");
        loadOrders().catch(() => {});
      } catch (err) {
        console.error(err);
        if (statusEl) statusEl.textContent = err.message || String(err);
        setStatus(err.message || String(err), true);
      }
    });
  }

  function initSettingsForm() {
    const form = $("#settings-form");
    const reloadBtn = $("#settings-reload");
    if (form) {
      form.addEventListener("submit", saveSettings);
    }
    if (reloadBtn) {
      reloadBtn.addEventListener("click", () => {
        loadSettings().catch((err) => {
          console.error(err);
          setStatus(err.message || String(err), true);
        });
      });
    }
  }

  function initCommunications() {
    const tableBody = $("#comms-repairs-body");
    const form = $("#comms-form");
    const statusEl = $("#comms-form-status");
    const idInput = $("#comms-repair-id");
    const contactInput = $("#comms-contact");
    const bookingInput = $("#comms-booking-id");
    const orderInput = $("#comms-order-id");
    const productInput = $("#comms-product-id");
    const summaryInput = $("#comms-summary");
    const messageInput = $("#comms-message");
    const historyEl = $("#comms-history");

    async function loadHistory(repairId) {
      if (!historyEl) return;
      historyEl.textContent = "Loading history...";
      try {
        const res = await apiRequest(`/api/admin/repairs/${encodeURIComponent(repairId)}/notifications`);
        const items = (res && res.items) || [];
        if (!items.length) {
          historyEl.textContent = "No messages sent yet for this repair.";
          return;
        }
        historyEl.innerHTML = items
          .map((n) => {
            const when = formatDateTime(n.sent_at);
            const status = n.status || "sent";
            const refs = [];
            if (n.repair_id) refs.push(`Repair: ${n.repair_id}`);
            if (n.booking_id) refs.push(`Booking: ${n.booking_id}`);
            if (n.order_id) refs.push(`Order: ${n.order_id}`);
            if (n.product_id) refs.push(`Product: ${n.product_id}`);
            const refsLine = refs.length
              ? `<div class="admin-mono" style="margin-top:0.15rem;">${refs.join(", ")}</div>`
              : "";
            return `<div style="margin-bottom:0.3rem;">
              <span class="admin-mono">${when}</span>
              <span class="admin-badge" style="margin-left:0.35rem;">${status}</span>
              <div>${truncate(n.message || "", 180)}</div>
              ${refsLine}
            </div>`;
          })
          .join("");
      } catch (err) {
        console.error(err);
        historyEl.textContent = err.message || String(err);
      }
    }

    if (tableBody) {
      tableBody.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-comms-notify]");
        if (!btn) return;
        const tr = btn.closest("tr");
        if (!tr || !tr.dataset.id) return;
        const repairId = tr.dataset.id;
        const tds = tr.querySelectorAll("td");
        const customerName = tds[1]?.textContent || "";
        const consoleName = tds[2]?.textContent || "";
        const status = tds[3]?.textContent || "";
        const contact = tds[4]?.textContent || "";

        if (idInput) idInput.value = repairId;
        if (contactInput) contactInput.value = contact;
        if (bookingInput) bookingInput.value = "";
        if (orderInput) orderInput.value = "";
        if (productInput) productInput.value = "";
        if (summaryInput)
          summaryInput.value = `${customerName} • ${consoleName} • ${status}`.trim();
        if (messageInput) {
          const namePart = customerName ? customerName : "customer";
          messageInput.value = `Hi ${namePart}, your ${consoleName || "console"} repair (ticket ${repairId}) is now completed and ready for collection. Please contact us if you need any assistance.`;
        }
        if (statusEl) statusEl.textContent = "";
        loadHistory(repairId).catch(() => {});
      });
    }

    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!idInput || !messageInput) return;
        const repairId = idInput.value.trim();
        const message = messageInput.value.trim();
        const bookingId = bookingInput ? bookingInput.value.trim() : "";
        const orderId = orderInput ? orderInput.value.trim() : "";
        const productId = productInput ? productInput.value.trim() : "";
        if (!repairId || !message) {
          if (statusEl) statusEl.textContent = "Select a repair and enter a message first.";
          return;
        }
        if (statusEl) statusEl.textContent = "Sending...";
        try {
          await apiRequest(`/api/admin/repairs/${encodeURIComponent(repairId)}/notifications`, {
            method: "POST",
            body: JSON.stringify({
              message,
              bookingId,
              orderId,
              productId,
            }),
          });
          if (statusEl) statusEl.textContent = "Notification saved (in-app).";
          setStatus("Notification recorded.");
          loadHistory(repairId).catch(() => {});
        } catch (err) {
          console.error(err);
          if (statusEl) statusEl.textContent = err.message || String(err);
          setStatus(err.message || String(err), true);
        }
      });
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    try {
      // Enforce password gate before any admin data or UI is usable.
      await ensureAdminAccess();

      initNav();
      initAdminPasswordControls();
      initRefreshControls();
      initRepairForm();
      initBookingForm();
      initProductForm();
      initPremiumGearForm();
      initRepairSupplyForm();
      initPeripheralsForm();
      initShopForm();
      initOrderForm();
      initSettingsForm();
      initCommunications();
      // Initial load of overview
      const loader = sectionLoaders[currentSection];
      if (typeof loader === "function") {
        loader().catch((err) => {
          console.error(err);
          setStatus(err.message || String(err), true);
        });
      }
    } catch (err) {
      console.error(err);
      setStatus("Failed to initialize admin dashboard.", true);
    }
  });
})();
