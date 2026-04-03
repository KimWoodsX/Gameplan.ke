// Basic front-end interactions for GAMEPLAN static site

// Utility: escape HTML to prevent XSS when inserting user/product data into innerHTML
function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Horizontal auto slider for product/service cards
function initAutoSliders() {
  const sliders = document.querySelectorAll('[data-auto-slider]');
  sliders.forEach((slider) => {
    const track = slider.querySelector('.auto-slider-track');
    if (!track) return;
    if (track.dataset.cloned === 'true') return;

    const items = Array.from(track.children);
    if (items.length === 0) return;

    // Duplicate children once to allow seamless looping (total width ~ 2x)
    items.forEach((item) => {
      const clone = item.cloneNode(true);
      track.appendChild(clone);
    });

    track.dataset.cloned = 'true';

    // Pause on hover / pointer interaction
    const pause = () => track.classList.add('is-paused');
    const resume = () => track.classList.remove('is-paused');

    slider.addEventListener('pointerenter', pause);
    slider.addEventListener('pointerleave', resume);
    slider.addEventListener('pointerdown', pause);
    slider.addEventListener('pointerup', resume);
    slider.addEventListener('touchstart', pause, { passive: true });
    slider.addEventListener('touchend', resume, { passive: true });
    slider.addEventListener('touchcancel', resume, { passive: true });
  });
}

// Set current year in footer
const yearSpan = document.getElementById("year");
if (yearSpan) {
  yearSpan.textContent = new Date().getFullYear();
}

// Smooth scroll for internal hash links (same page only)
const internalLinks = document.querySelectorAll('a[href^="#"]');
internalLinks.forEach((link) => {
  link.addEventListener("click", (event) => {
    const href = link.getAttribute("href");
    if (!href || href === "#") return;

    const target = document.querySelector(href);
    if (!target) return;

    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth" });
  });
});

// --- Simple cart using localStorage (no login required) ---
const CART_KEY = "gameplan_cart_v1";

function loadCart() {
  try {
    const raw = window.localStorage.getItem(CART_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveCart(cart) {
  try {
    window.localStorage.setItem(CART_KEY, JSON.stringify(cart));
  } catch (e) {
    // ignore storage errors in static mode
  }
}

function updateCartCount() {
  const cart = loadCart();
  const countEl = document.getElementById("cart-count");
  if (countEl) {
    const totalQty = cart.reduce((sum, item) => sum + (item.quantity || 1), 0);
    countEl.textContent = String(totalQty);
  }
}

function isInCart(productId) {
  const cart = loadCart();
  return cart.some((item) => item.id === productId);
}

function addToCartFromElement(button) {
  const product = {
    id: button.getAttribute("data-product-id"),
    name: button.getAttribute("data-product-name"),
    category: button.getAttribute("data-product-category"),
    compatibility: button.getAttribute("data-product-compat"),
  };

  let cart = loadCart();
  const existing = cart.find((item) => item.id === product.id);
  if (existing) {
    existing.quantity = (existing.quantity || 1) + 1;
  } else {
    cart.push({ ...product, quantity: 1 });
  }
  saveCart(cart);
  updateCartCount();

  // Update button state to reflect in-cart status
  if (button) {
    button.textContent = "In Cart";
    button.classList.add("btn-disabled");
    button.setAttribute("aria-disabled", "true");
    button.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        window.location.href = "cart.html";
      },
      { once: true }
    );
  }
}

function syncCartButtons() {
  const buttons = document.querySelectorAll("[data-add-to-cart]");
  const cart = loadCart();
  buttons.forEach((btn) => {
    const id = btn.getAttribute("data-product-id");
    if (!id) return;
    const inCart = cart.some((item) => item.id === id);
    if (inCart) {
      btn.textContent = "In Cart";
      btn.classList.add("btn-disabled");
      btn.setAttribute("aria-disabled", "true");
      btn.onclick = (e) => {
        e.preventDefault();
        window.location.href = "cart.html";
      };
    }
  });
}

// Attach add-to-cart handlers on any page
const cartButtons = document.querySelectorAll("[data-add-to-cart]");
cartButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.classList.contains("btn-disabled")) {
      window.location.href = "cart.html";
      return;
    }
    addToCartFromElement(btn);
  });
});

updateCartCount();
syncCartButtons();
initAutoSliders();

// If on wishlist page, render wishlist items
if (document.getElementById("wishlist-grid")) {
  renderWishlistPage().catch((e) => console.error(e));
}

// Initialize wishlist + share buttons on initial load
initWishlistButtons().catch((e) => console.error("Wishlist init failed", e));
attachShareHandlers();

// Initialize payment page (if present)
if (document.getElementById("payment-section")) {
  initPaymentPage();
}

// Cart page rendering & checkout
const cartList = document.getElementById("cart-items");
const emptyCartMsg = document.getElementById("cart-empty");

function renderCartList() {
  if (!cartList) return;
  const cart = loadCart();
  cartList.innerHTML = "";

  if (!cart.length) {
    if (emptyCartMsg) emptyCartMsg.style.display = "block";
    return;
  }
  if (emptyCartMsg) emptyCartMsg.style.display = "none";

  cart.forEach((item) => {
    const li = document.createElement("li");
    li.className = "cart-item-row";
    li.dataset.id = item.id;

    const textSpan = document.createElement("span");
    textSpan.textContent = `${item.name} (${item.compatibility || ""}) x ${
      item.quantity || 1
    }`;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "Remove";
    removeBtn.className = "btn btn-secondary btn-primary--small";
    removeBtn.addEventListener("click", () => {
      let cart = loadCart();
      cart = cart.filter((c) => c.id !== item.id);
      saveCart(cart);
      updateCartCount();
      renderCartList();
    });

    li.appendChild(textSpan);
    li.appendChild(removeBtn);
    cartList.appendChild(li);
  });
}

if (cartList) {
  renderCartList();
}

const cartForm = document.getElementById("cart-checkout-form");
const cartStatus = document.getElementById("cart-status");
const cartProceedBtn = document.getElementById("cart-proceed-btn");

function buildCartMessageFromForm() {
  if (!cartForm) return "";
  const data = new FormData(cartForm);
  const name = (data.get("name") || "").toString().trim();
  const whatsapp = (data.get("whatsapp") || "").trim();
  const location = (data.get("location") || "").trim();
  const notes = (data.get("notes") || "").trim();

  const cart = loadCart();
  const lines = cart.map(
    (item, index) => `${index + 1}. ${item.name} x ${item.quantity || 1} (${item.compatibility || ""})`
  );

  const message = [
    "New GAMEPLAN product inquiry",
    "",
    `Name: ${name}`,
    `WhatsApp: ${whatsapp}`,
    location ? `Location: ${location}` : "",
    "",
    "Requested items:",
    ...lines,
    "",
    notes ? `Notes: ${notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return message;
}

function buildCartPayload() {
  if (!cartForm) return null;
  const data = new FormData(cartForm);
  const name = (data.get("name") || "").toString().trim();
  const whatsapp = (data.get("whatsapp") || "").trim();
  const location = (data.get("location") || "").trim();
  const notes = (data.get("notes") || "").trim();
  const cart = loadCart();
  return { name, whatsapp, location, notes, cart };
}

function updateCartActionsState() {
  if (!cartForm || !cartProceedBtn) return;
  const cart = loadCart();
  const name = (cartForm.querySelector("#cart-name")?.value || "").trim();
  const whatsapp = (cartForm.querySelector("#cart-whatsapp")?.value || "").trim();
  const hasItems = cart.length > 0;
  const hasRequired = !!name && !!whatsapp;
  cartProceedBtn.disabled = !(hasItems && hasRequired);
}

if (cartForm) {
  // Keep Proceed button enabled/disabled based on cart + required fields
  ["cart-name", "cart-whatsapp"].forEach((id) => {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener("input", updateCartActionsState);
    }
  });

  // Also re-check when cart contents change
  if (cartList) {
    const originalRender = renderCartList;
    renderCartList = function () {
      originalRender();
      updateCartActionsState();
    };
  }

  // Existing Send Inquiry behavior (still works)
  cartForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const message = buildCartMessageFromForm();
    if (!message) return;
    const encoded = encodeURIComponent(message);
    const url = `https://wa.me/254720968268?text=${encoded}`;
    window.open(url, "_blank");

    if (cartStatus) {
      cartStatus.textContent = "Your inquiry has been opened in WhatsApp. Send the message to complete your order and our team will follow up shortly.";
    }
  });

  // New Proceed to Checkout button behavior
  if (cartProceedBtn) {
    updateCartActionsState();
    cartProceedBtn.addEventListener("click", () => {
      if (cartProceedBtn.disabled) return;
      const payload = buildCartPayload();
      if (!payload) return;
      try {
        sessionStorage.setItem("gp_checkout_info", JSON.stringify(payload));
      } catch (e) {
        console.error("Failed to store checkout info", e);
      }
      cartProceedBtn.disabled = true;
      openCartPaymentModal();
    });
  }
}
function openCartPaymentModal() {
  const modal = document.getElementById("payment-modal");
  if (!modal) return;

  // Initialize modal logic the first time it's opened
  if (!window.__gpCartPaymentModalInit) {
    initCartPaymentModal();
    window.__gpCartPaymentModalInit = true;
  }

  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
}

function initCartPaymentModal() {
  const modal = document.getElementById("payment-modal");
  const summaryEl = document.getElementById("modal-payment-summary");
  const refInput = document.getElementById("modal-payment-ref");
  const confirmBtn = document.getElementById("modal-payment-confirm-btn");
  const statusEl = document.getElementById("modal-payment-status");
  const closeBtn = document.getElementById("payment-modal-close");

  if (!modal || !summaryEl || !confirmBtn) return;

  let payload = null;
  try {
    const raw = sessionStorage.getItem("gp_checkout_info");
    payload = raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error("Failed to read checkout info", e);
    payload = null;
  }

  const cart = payload && Array.isArray(payload.cart) ? payload.cart : [];
  const name = (payload && payload.name) || "";
  const whatsapp = (payload && payload.whatsapp) || "";
  const location = (payload && payload.location) || "";
  const notes = (payload && payload.notes) || "";

  if (summaryEl) {
    if (!cart.length) {
      summaryEl.textContent =
        "No items found in your cart. Please close this window and add items from the shop page.";
    } else {
      const list = cart
        .map(
          (item, idx) =>
            `<li>${idx + 1}. ${escapeHtml(item.name)} x ${item.quantity || 1} (${escapeHtml(item.compatibility || "")})</li>`
        )
        .join("");

      summaryEl.innerHTML = `
        <p><strong>Name:</strong> ${escapeHtml(name || "-")}</p>
        <p><strong>WhatsApp:</strong> ${escapeHtml(whatsapp || "-")}</p>
        ${location ? `<p><strong>Location:</strong> ${escapeHtml(location)}</p>` : ""}
        ${notes ? `<p><strong>Notes:</strong> ${escapeHtml(notes)}</p>` : ""}
        <p style="margin-top:0.5rem;"><strong>Items:</strong></p>
        <ul>${list}</ul>
      `;
    }
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      modal.classList.remove("is-open");
      modal.setAttribute("aria-hidden", "true");
    });
  }

  if (confirmBtn) {
    const updateConfirmState = () => {
      const ref = (refInput && refInput.value) ? refInput.value.trim() : "";
      confirmBtn.disabled = ref.length < 4 || !cart.length;
    };

    updateConfirmState();
    if (refInput) {
      refInput.addEventListener("input", updateConfirmState);
    }

    confirmBtn.addEventListener("click", () => {
      if (confirmBtn.disabled) return;

      if (!cart.length) {
        if (statusEl) {
          statusEl.textContent =
            "Your cart is empty. Please close this window and add products before confirming payment.";
        }
        return;
      }

      const ref = (refInput && refInput.value) ? refInput.value.trim() : "";
      const lines = cart.map(
        (item, idx) =>
          `${idx + 1}. ${item.name} x ${item.quantity || 1} (${item.compatibility || ""})`
      );
      const parts = [
        "Payment confirmation for GAMEPLAN order",
        "",
        `Name: ${name || "-"}`,
        `WhatsApp: ${whatsapp || "-"}`,
        location ? `Location: ${location}` : "",
        ref ? `Payment reference: ${ref}` : "Payment reference: (to be provided)",
        "",
        "Items:",
        ...lines,
        "",
        notes ? `Notes: ${notes}` : "",
      ].filter(Boolean);

      const message = parts.join("\n");
      const encoded = encodeURIComponent(message);
      const url = `https://wa.me/254720968268?text=${encoded}`;
      confirmBtn.disabled = true;
      window.open(url, "_blank");
      if (statusEl) {
        statusEl.textContent =
          "Thank you! Your payment confirmation has been prepared in WhatsApp. We will contact you shortly.";
      }
    });
  }
}

// Booking form - sends to backend
const bookingForm = document.getElementById("booking-form");
const bookingStatus = document.getElementById("booking-status");

if (bookingForm && bookingStatus) {
  bookingForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    
    const formData = new FormData(bookingForm);
    const bookingData = {
      customerName: formData.get("name") || "",
      whatsapp: formData.get("whatsapp") || "",
      console: formData.get("console") || "",
      service: formData.get("service") || "",
      date: formData.get("date") || "",
      timeSlot: formData.get("timeSlot") || "",
      issue: formData.get("issue") || "",
      status: "pending",
    };

    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(bookingData),
      });

      if (response.ok) {
        bookingStatus.textContent = "Thank you! Your booking request has been submitted. We will follow up via WhatsApp or phone.";
        bookingForm.reset(); // only reset on success so user keeps their data if there's an error
      } else {
        bookingStatus.textContent = "We could not submit your booking online. Please contact us on WhatsApp at +254720968268.";
      }
    } catch (error) {
      console.error("Booking submission error:", error);
      bookingStatus.textContent = "Something went wrong. Please try again or contact us on WhatsApp at +254720968268.";
    }
  });
}

function initPaymentPage() {
  const summaryEl = document.getElementById("payment-summary");
  const refInput = document.getElementById("payment-ref");
  const confirmBtn = document.getElementById("payment-confirm-btn");
  const statusEl = document.getElementById("payment-status");

  let payload = null;
  try {
    const raw = sessionStorage.getItem("gp_checkout_info");
    payload = raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error("Failed to read checkout info", e);
    payload = null;
  }

  const cart = payload && Array.isArray(payload.cart) ? payload.cart : [];
  const name = (payload && payload.name) || "";
  const whatsapp = (payload && payload.whatsapp) || "";
  const location = (payload && payload.location) || "";
  const notes = (payload && payload.notes) || "";

  if (summaryEl) {
    if (!cart.length) {
      summaryEl.textContent =
        "No items found in your cart. Please go back to the shop and add items.";
    } else {
      const list = cart
        .map(
          (item, idx) =>
            `${idx + 1}. ${item.name} x ${item.quantity || 1} (${item.compatibility || ""})`
        )
        .join("");
      summaryEl.innerHTML = `
        <p><strong>Name:</strong> ${name || "-"}</p>
        <p><strong>WhatsApp:</strong> ${whatsapp || "-"}</p>
        ${location ? `<p><strong>Location:</strong> ${location}</p>` : ""}
        ${notes ? `<p><strong>Notes:</strong> ${notes}</p>` : ""}
        <p style="margin-top:0.5rem;"><strong>Items:</strong></p>
        <ul>${list}</ul>
      `;
    }
  }

  if (confirmBtn) {
    // Keep the button disabled until a confirmation code is entered
    const updateConfirmState = () => {
      const ref = (refInput && refInput.value) ? refInput.value.trim() : "";
      confirmBtn.disabled = ref.length < 4 || !cart.length;
    };

    updateConfirmState();
    if (refInput) {
      refInput.addEventListener("input", updateConfirmState);
    }

    confirmBtn.addEventListener("click", () => {
      if (confirmBtn.disabled) return;

      if (!cart.length) {
        if (statusEl) {
          statusEl.textContent =
            "Your cart is empty. Please go back and add products before confirming payment.";
        }
        return;
      }

      const ref = (refInput && refInput.value) ? refInput.value.trim() : "";
      const lines = cart.map(
        (item, idx) =>
          `${idx + 1}. ${item.name} x ${item.quantity || 1} (${item.compatibility || ""})`
      );
      const parts = [
        "Payment confirmation for GAMEPLAN order",
        "",
        `Name: ${name || "-"}`,
        `WhatsApp: ${whatsapp || "-"}`,
        location ? `Location: ${location}` : "",
        ref ? `Payment reference: ${ref}` : "Payment reference: (to be provided)",
        "",
        "Items:",
        ...lines,
        "",
        notes ? `Notes: ${notes}` : "",
      ].filter(Boolean);

      const message = parts.join("\n");
      const encoded = encodeURIComponent(message);
      const url = `https://wa.me/254720968268?text=${encoded}`;
      confirmBtn.disabled = true;
      window.open(url, "_blank");
      if (statusEl) {
        statusEl.textContent =
          "Thank you! Your payment confirmation has been prepared in WhatsApp. We will contact you shortly.";
      }
    });
  }
}

// Simple user id for wishlist (per browser)
const WISHLIST_USER_KEY = "gameplan_user_id";

function getCurrentUserId() {
  let id = "";
  try {
    id = window.localStorage.getItem(WISHLIST_USER_KEY) || "";
    if (!id) {
      id = `user-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      window.localStorage.setItem(WISHLIST_USER_KEY, id);
    }
  } catch (e) {
    id = "anonymous";
  }
  return id;
}

async function loadWishlist() {
  const userId = getCurrentUserId();
  try {
    const res = await fetch(`/api/wishlist?userId=${encodeURIComponent(userId)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data && data.items) || [];
  } catch {
    return [];
  }
}

async function toggleWishlist(productId, saved) {
  const userId = getCurrentUserId();
  const method = saved ? "DELETE" : "POST";
  await fetch("/api/wishlist", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, productId }),
  });
}

function updateWishlistButton(btn, saved) {
  if (!btn) return;
  if (saved) {
    btn.textContent = "♥ Saved";
    btn.classList.add("wishlist-saved");
  } else {
    btn.textContent = "♡ Wishlist";
    btn.classList.remove("wishlist-saved");
  }
}

function attachShareHandlers(root) {
  const container = root || document;
  const buttons = container.querySelectorAll("[data-share-product]");
  if (!buttons.length) return;
  buttons.forEach((btn) => {
    // Skip if already initialized
    if (btn.dataset.shareInit === "true") return;
    btn.dataset.shareInit = "true";

    const pid = btn.getAttribute("data-product-id");
    const name = btn.getAttribute("data-product-name") || "GAMEPLAN product";
    btn.addEventListener("click", async () => {
      const url = window.location.origin + window.location.pathname + `?product=${encodeURIComponent(pid || "")}`;
      const shareText = `Check out ${name} on GAMEPLAN: ${url}`;

      // Helper to show feedback on button
      const showFeedback = (text, duration = 1500) => {
        const original = btn.textContent;
        btn.textContent = text;
        setTimeout(() => {
          btn.textContent = original;
        }, duration);
      };

      // Helper to copy text with fallback
      const copyToClipboard = async (text) => {
        // Try modern clipboard API first
        if (navigator.clipboard && navigator.clipboard.writeText) {
          try {
            await navigator.clipboard.writeText(text);
            return true;
          } catch (e) {
            // Clipboard API failed, try fallback
          }
        }
        // Fallback: create temporary textarea
        try {
          const textarea = document.createElement("textarea");
          textarea.value = text;
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.select();
          const success = document.execCommand("copy");
          document.body.removeChild(textarea);
          return success;
        } catch (e) {
          return false;
        }
      };

      try {
        // Try Web Share API first (mobile devices)
        if (navigator.share) {
          await navigator.share({
            title: name,
            text: `Check this out on GAMEPLAN: ${name}`,
            url,
          });
          showFeedback("Shared!");
        } else {
          // Desktop: copy link to clipboard
          const copied = await copyToClipboard(url);
          if (copied) {
            showFeedback("Link Copied!");
          } else {
            // Last resort: show prompt with URL
            prompt("Copy this link to share:", url);
          }
        }
      } catch (e) {
        // User cancelled share or other error
        if (e.name !== "AbortError") {
          // Try clipboard as fallback if share failed
          const copied = await copyToClipboard(url);
          if (copied) {
            showFeedback("Link Copied!");
          } else {
            prompt("Copy this link to share:", url);
          }
        }
      }
    });
  });
}

async function initWishlistButtons(root) {
  const container = root || document;
  const buttons = container.querySelectorAll("[data-wishlist-toggle]");
  if (!buttons.length) return;
  const wishlist = await loadWishlist();
  const ids = new Set(wishlist.map((w) => w.product_id));

  buttons.forEach((btn) => {
    const pid = btn.getAttribute("data-product-id");
    if (!pid) return;
    const saved = ids.has(pid);
    updateWishlistButton(btn, saved);
    btn.addEventListener("click", async () => {
      const currentlySaved = btn.classList.contains("wishlist-saved");
      updateWishlistButton(btn, !currentlySaved);
      try {
        await toggleWishlist(pid, currentlySaved);
      } catch (e) {
        console.error("Wishlist toggle failed", e);
      }
    });
  });
}

async function renderWishlistPage() {
  const grid = document.getElementById("wishlist-grid");
  const empty = document.getElementById("wishlist-empty");
  if (!grid) return;

  const wishlist = await loadWishlist();
  if (!wishlist.length) {
    if (empty) empty.style.display = "block";
    return;
  }

  // Fetch full product catalog to resolve details
  let products = [];
  try {
    const res = await fetch("/api/products");
    if (res.ok) {
      const data = await res.json();
      products = (data && data.items) || [];
    }
  } catch (e) {
    console.error("Failed to load products for wishlist", e);
  }

  const byId = new Map(products.map((p) => [p.id, p]));

  grid.innerHTML = wishlist
    .map((w) => {
      const p = byId.get(w.product_id) || { id: w.product_id, name: w.product_id };
      const img =
        p.imageUrl ||
        "https://images.unsplash.com/photo-1606144042614-b2417e99c4e3?w=800&q=80";
      const price =
        p.priceKES != null
          ? `KES ${p.priceKES.toLocaleString("en-KE")}`
          : "Ask for price";
      const compat =
        (p.specs && (p.specs.compatibility || p.specs.platform)) || "";
      const desc =
        p.description || "Saved product. Details may be updated in the catalog.";
      return `
        <article class="card product-card" data-wishlist-item="${w.product_id}">
          <img src="${img}" alt="${(p.name || "").replace(/"/g, "&quot;")}" class="product-image" loading="lazy" />
          <h3>${p.name || w.product_id}</h3>
          ${
            compat
              ? `<p class="meta"><strong>Compatibility:</strong> ${compat}</p>`
              : ""
          }
          <p class="meta"><strong>Price:</strong> ${price}</p>
          <p class="meta">${desc}</p>
          <div class="section-cta-wrap">
            <button type="button" class="btn btn-secondary" data-add-to-cart
              data-product-id="${p.id}"
              data-product-name="${(p.name || "").replace(/"/g, "&quot;")}"
              data-product-category="${p.category || ""}"
              data-product-compat="${compat}">
              Add to Cart
            </button>
            <button type="button" class="btn btn-outline wishlist-btn" data-wishlist-toggle
              data-product-id="${p.id}">
              ♡ Wishlist
            </button>
            <button type="button" class="btn btn-outline" data-share-product
              data-product-id="${p.id}"
              data-product-name="${(p.name || "").replace(/"/g, "&quot;")}">
              Share
            </button>
          </div>
        </article>
      `;
    })
    .join("");

  if (empty) empty.style.display = "none";
  // Re-wire cart and wishlist interactions in this grid
  syncCartButtons();
  const localButtons = grid.querySelectorAll("[data-add-to-cart]");
  localButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("btn-disabled")) {
        window.location.href = "cart.html";
        return;
      }
      addToCartFromElement(btn);
    });
  });
  initWishlistButtons(grid);
  attachShareHandlers(grid);
}

// Upgraded Products grid on home page (dynamic from admin catalog)
const upgradedGrid = document.getElementById("upgraded-products-grid");
const upgradedEmpty = document.getElementById("upgraded-products-empty");

if (upgradedGrid) {
  (async () => {
    try {
      const res = await fetch("/api/products/upgraded");
      if (!res.ok) throw new Error("Failed to load upgraded products");
      const data = await res.json();
      const items = (data && data.items) || [];

      if (!items.length) {
        if (upgradedEmpty) upgradedEmpty.style.display = "block";
        return;
      }

      upgradedGrid.innerHTML = items
        .map((p) => {
          const img =
            p.imageUrl ||
            "https://images.unsplash.com/photo-1606144042614-b2417e99c4e3?w=800&q=80";
          const price =
            p.priceKES != null
              ? `KES ${p.priceKES.toLocaleString("en-KE")}`
              : "Ask for price";
          const compat =
            (p.specs && (p.specs.compatibility || p.specs.platform)) || "";
          const desc =
            p.description ||
            "Elite, upgraded hardware tuned for serious gamers.";
          return `
            <article class="card product-card">
              <img src="${img}" alt="${(p.name || "").replace(/"/g, "&quot;")}" class="product-image" loading="lazy" />
              <h3>${p.name || "Upgraded product"}</h3>
              <p class="meta"><strong>Category:</strong> ${p.category || ""}</p>
              ${
                compat
                  ? `<p class="meta"><strong>Compatibility:</strong> ${compat}</p>`
                  : ""
              }
              <p class="meta"><strong>Price:</strong> ${price}</p>
              <p class="meta">${desc}</p>
              <div class="section-cta-wrap">
                <button type="button" class="btn btn-secondary" data-add-to-cart
                  data-product-id="${p.id}"
                  data-product-name="${(p.name || "").replace(/"/g, "&quot;")}"
                  data-product-category="${p.category || ""}"
                  data-product-compat="${compat}">
                  Add to Cart
                </button>
                <button type="button" class="btn btn-outline wishlist-btn" data-wishlist-toggle
                  data-product-id="${p.id}">
                  ♡ Wishlist
                </button>
                <button type="button" class="btn btn-outline" data-share-product
                  data-product-id="${p.id}"
                  data-product-name="${(p.name || "").replace(/"/g, "&quot;")}">
                  Share
                </button>
                <a href="https://wa.me/254720968268" target="_blank" rel="noopener noreferrer" class="btn btn-primary">
                  Upgrade via WhatsApp
                </a>
              </div>
            </article>
          `;
        })
        .join("");

      const buttons = upgradedGrid.querySelectorAll("[data-add-to-cart]");
      buttons.forEach((btn) => {
        btn.addEventListener("click", () => {
          if (typeof addToCartFromElement === "function") {
            if (btn.classList.contains("btn-disabled")) {
              window.location.href = "cart.html";
              return;
            }
            addToCartFromElement(btn);
          }
        });
      });
      attachShareHandlers(upgradedGrid);
    } catch (error) {
      console.error("Failed to load upgraded products", error);
      if (upgradedEmpty) {
        upgradedEmpty.textContent =
          "Upgraded products are temporarily unavailable. Please check back soon.";
        upgradedEmpty.style.display = "block";
      }
    }
  })();
}

// Repair Products grid on home page (filter from full catalog)
const repairGrid = document.getElementById("repair-products-grid");
const repairEmpty = document.getElementById("repair-products-empty");

if (repairGrid) {
  (async () => {
    try {
      const res = await fetch("/api/products");
      if (!res.ok) throw new Error("Failed to load repair products");
      const data = await res.json();
      const all = (data && data.items) || [];

      // Simple rule: treat any product with category "repair" or
      // a tag/flag repairProduct === true as a repair product.
      const items = all.filter((p) => {
        const cat = (p.category || "").toLowerCase();
        return cat === "repair" || p.repairProduct === true;
      });

      if (!items.length) {
        if (repairEmpty) repairEmpty.style.display = "block";
        return;
      }

      repairGrid.innerHTML = items
        .map((p) => {
          const img =
            p.imageUrl ||
            "https://images.unsplash.com/photo-1611050991820-b528a547935a?w=800&q=80";
          const price =
            p.priceKES != null
              ? `KES ${p.priceKES.toLocaleString("en-KE")}`
              : "Ask for price";
          const compat =
            (p.specs && (p.specs.compatibility || p.specs.platform)) || "Consoles";
          const desc =
            p.description ||
            "Repair-grade parts and accessories for console servicing.";
          return `
            <article class="card product-card">
              <img src="${img}" alt="${(p.name || "").replace(/"/g, "&quot;")}" class="product-image" loading="lazy" />
              <h3>${p.name || "Repair product"}</h3>
              <p class="meta"><strong>Category:</strong> ${p.category || "Repair"}</p>
              <p class="meta"><strong>Use:</strong> Repair / maintenance</p>
              ${
                compat
                  ? `<p class="meta"><strong>Compatibility:</strong> ${compat}</p>`
                  : ""
              }
              <p class="meta"><strong>Price:</strong> ${price}</p>
              <p class="meta">${desc}</p>
              <div class="section-cta-wrap">
                <button type="button" class="btn btn-secondary" data-add-to-cart
                  data-product-id="${p.id}"
                  data-product-name="${(p.name || "").replace(/"/g, "&quot;")}"
                  data-product-category="${p.category || "repair"}"
                  data-product-compat="${compat}">
                  Add to Cart
                </button>
                <button type="button" class="btn btn-outline" data-share-product
                  data-product-id="${p.id}"
                  data-product-name="${(p.name || "").replace(/"/g, "&quot;")}">
                  Share
                </button>
              </div>
            </article>
          `;
        })
        .join("");

      const buttons = repairGrid.querySelectorAll("[data-add-to-cart]");
      buttons.forEach((btn) => {
        btn.addEventListener("click", () => {
          if (typeof addToCartFromElement === "function") {
            if (btn.classList.contains("btn-disabled")) {
              window.location.href = "cart.html";
              return;
            }
            addToCartFromElement(btn);
          }
        });
      });
      attachShareHandlers(repairGrid);
    } catch (error) {
      console.error("Failed to load repair products", error);
      if (repairEmpty) {
        repairEmpty.textContent =
          "Repair products are temporarily unavailable. Please check back soon.";
        repairEmpty.style.display = "block";
      }
    }
  })();
}

// Gaming Peripherals grid on home page
const peripheralsGrid = document.getElementById("gaming-peripherals-grid");

if (peripheralsGrid) {
  (async () => {
    try {
      const res = await fetch("/api/products");
      if (!res.ok) throw new Error("Failed to load peripherals");
      const data = await res.json();
      const all = (data && data.items) || [];

      const items = all.filter((p) => {
        const cat = (p.category || "").toLowerCase();
        return cat === "peripheral" || p.peripheral === true;
      });

      if (!items.length) return;

      peripheralsGrid.innerHTML = items
        .map((p) => {
          const img =
            p.imageUrl ||
            "https://images.unsplash.com/photo-1611050991820-b528a547935a?w=800&q=80";
          const price =
            p.priceKES != null
              ? `KES ${p.priceKES.toLocaleString("en-KE")}`
              : "Ask for price";
          const compat =
            (p.specs && (p.specs.compatibility || p.specs.platform)) || p.compatibility || "";
          const desc = p.description || "";
          return `
            <article class="card product-card">
              <img src="${img}" alt="${(p.name || "").replace(/"/g, "&quot;")}" class="product-image" loading="lazy" />
              <h3>${p.name || "Peripheral"}</h3>
              ${
                compat
                  ? `<p class="meta"><strong>Compatibility:</strong> ${compat}</p>`
                  : ""
              }
              <p class="meta"><strong>Price:</strong> ${price}</p>
              ${desc ? `<p class="meta">${desc}</p>` : ""}
              <div class="section-cta-wrap">
                <button type="button" class="btn btn-secondary" data-add-to-cart
                  data-product-id="${p.id}"
                  data-product-name="${(p.name || "").replace(/"/g, "&quot;")}"
                  data-product-category="${p.category || "peripheral"}"
                  data-product-compat="${compat}">
                  Add to Cart
                </button>
                <button type="button" class="btn btn-outline wishlist-btn" data-wishlist-toggle
                  data-product-id="${p.id}">
                  ♡ Wishlist
                </button>
                <button type="button" class="btn btn-outline" data-share-product
                  data-product-id="${p.id}"
                  data-product-name="${(p.name || "").replace(/"/g, "&quot;")}">
                  Share
                </button>
                <a href="https://wa.me/254720968268" target="_blank" rel="noopener noreferrer" class="btn btn-primary">
                  Inquire on WhatsApp
                </a>
              </div>
            </article>
          `;
        })
        .join("");

      const buttons = peripheralsGrid.querySelectorAll("[data-add-to-cart]");
      buttons.forEach((btn) => {
        btn.addEventListener("click", () => {
          if (typeof addToCartFromElement === "function") {
            if (btn.classList.contains("btn-disabled")) {
              window.location.href = "cart.html";
              return;
            }
            addToCartFromElement(btn);
          }
        });
      });
      attachShareHandlers(peripheralsGrid);
    } catch (error) {
      console.error("Failed to load peripherals", error);
    }
  })();
}

// --- AI Chatbot (frontend shell; requires backend AI service) ---
const chatLauncher = document.getElementById("gp-chat-launcher");
const chatWindow = document.getElementById("gp-chat-window");
const chatClose = document.getElementById("gp-chat-close");
const chatForm = document.getElementById("gp-chat-form");
const chatInput = document.getElementById("gp-chat-input");
const chatMessages = document.getElementById("gp-chat-messages");

if (chatLauncher && chatWindow && chatForm && chatInput && chatMessages && chatClose) {
  // Conversation history — sent to backend so the AI has multi-turn context
  const chatHistory = [];

  function appendMessage(text, role) {
    const el = document.createElement("div");
    el.className = `chat-message ${role}`;
    el.textContent = text;
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    // Track history for multi-turn AI (cap at 20 turns to avoid huge payloads)
    if (role === "user" || role === "bot") {
      chatHistory.push({ role: role === "user" ? "user" : "assistant", content: text });
      if (chatHistory.length > 20) chatHistory.splice(0, chatHistory.length - 20);
    }
  }

  function getCurrentContext() {
    return {
      url: window.location.href,
      path: window.location.pathname,
      cart: loadCart(),
    };
  }

  function getLocalAssistantReply(message, context) {
    const text = message.toLowerCase();

    // Simple intent detection for repairs / diagnostics
    if (/(no power|won'?t turn on|black screen|hdmi|port|usb|overheat|overheating|fan noise|shutting down)/.test(text)) {
      return "It sounds like you have a hardware issue. Based on what you described, I recommend our repair services such as \"Power Supply, HDMI & USB Ports\" or \"Thermal Overhaul & Cooling Fixes\". You can book a repair below or send us photos and details on WhatsApp at +254720968268.";
    }

    // Pricing / quote intent
    if (/(price|how much|cost|quote|discount)/.test(text)) {
      const firstItem = (context.cart && context.cart[0]) || null;
      if (firstItem) {
        return `Pricing for ${firstItem.name} depends on current stock and offers. Tap Send Inquiry via WhatsApp on the cart page and our team will share a live quote with you.`;
      }
      return "Our prices depend on current stock and offers. Tell me which product you’re interested in (for example: PS5 console, Xbox Series X, PXN wheel, SSD), and I’ll guide you to a live quote via WhatsApp.";
    }

    // Product recommendation intent
    if (/(recommend|which is best|what is best|best wheel|best headset|suggest)/.test(text)) {
      if (/wheel|racing/.test(text)) {
        return "For racing and driving, we recommend our PXN and Logitech driving wheels, compatible with PlayStation, Xbox and PC. If you tell me your console and budget, I can narrow it down and help you add the right wheel to your cart.";
      }
      if (/headset|headphones/.test(text)) {
        return "For headsets, we stock wired and wireless gaming headsets with clear mic quality for PlayStation, Xbox and PC. Look at the Gaming Headsets section in the shop – then ask me about comfort, wireless vs wired, or price ranges and I’ll advise.";
      }
      if (/ssd|storage/.test(text)) {
        return "For SSD upgrades, we recommend NVMe SSDs for PS5 and fast SATA or NVMe options for PS4 and PC. Tell me your console model (PS5, PS4, or PC) and desired capacity, and I’ll suggest specific SSD options and expected performance gains.";
      }
      return "I can recommend products based on your setup. Tell me which console you use (PS5, PS4, Xbox, PC) and what you want to improve – storage, graphics, comfort, streaming, or racing – and I’ll suggest the best gear from our catalog.";
    }

    // Booking / appointment intent
    if (/(book|booking|appointment|schedule|repair my|fix my)/.test(text)) {
      return "To book a repair or installation, please fill in the booking form on the Home page (Book a Repair section) or send your console issue, preferred date, and WhatsApp number directly here. We’ll confirm time and pricing with you.";
    }

    // Cart / order assistance
    if (/(order|delivery|shipping|cart|checkout)/.test(text)) {
      return "If your cart is ready, go to the Cart page and submit the inquiry form – it will automatically send your selected products and contact details to us via WhatsApp. We’ll confirm availability, total cost, and delivery or pickup options.";
    }

    return null; // let backend handle more advanced queries
  }

  async function sendChatMessage(message) {
    const thinkingEl = document.createElement("div");
    thinkingEl.className = "chat-message bot";
    thinkingEl.textContent = "Thinking…";
    chatMessages.appendChild(thinkingEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    const context = getCurrentContext();

    // Local assistant handles only repair diagnostics and booking shortcuts.
    // Price / product queries are intentionally passed to the backend so the
    // AI returns live prices from the product catalog.
    const localReply = getLocalAssistantReply(message, context);
    const isPriceQuery = /(price|how much|cost|quote|discount|kes|ksh)/i.test(message);
    if (localReply && !isPriceQuery) {
      thinkingEl.remove();
      appendMessage(localReply, "bot");
      return;
    }

    const payload = {
      message,
      // Include conversation history for multi-turn AI context (last 10 turns)
      history: chatHistory.slice(-10).slice(0, -1), // exclude the message we just added
      context,
    };

    try {
      // Talk to GAMEPLAN AI backend at /api/chat (served by server.js)
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        // Try to use any fallback reply returned by the backend, even on 4xx/5xx
        let data = null;
        try {
          data = await response.json();
        } catch (e) {
          // ignore JSON parse errors here
        }
        thinkingEl.remove();
        const replyText = (data && data.reply) ||
          "Our chat service is currently unavailable. Please try again later or contact us on WhatsApp at +254720968268.";
        appendMessage(replyText, "bot");
        return;
      }

      const data = await response.json();
      thinkingEl.remove();
      const replyText = data.reply || "I’ve received your question. Our team will follow up with more details soon.";
      appendMessage(replyText, "bot");
    } catch (error) {
      thinkingEl.remove();
      appendMessage(
        "I couldn’t reach the chat service right now. Please try again later or contact us on WhatsApp at +254720968268.",
        "bot"
      );
      console.error("Chat error", error);
    }
  }

  chatLauncher.addEventListener("click", () => {
    const isOpen = chatWindow.classList.contains("is-open");
    if (!isOpen) {
      chatWindow.classList.add("is-open");
      chatInput.focus();
      if (!chatMessages.dataset.initialized) {
        appendMessage(
          "Hi, I’m your GAMEPLAN helper. I can help with console diagnostics, product recommendations, prices and bookings based on our catalog and services.",
          "bot"
        );
        chatMessages.dataset.initialized = "true";
      }
    } else {
      chatWindow.classList.remove("is-open");
    }
  });

  chatClose.addEventListener("click", () => {
    chatWindow.classList.remove("is-open");
  });

  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const message = chatInput.value.trim();
    if (!message) return;
    appendMessage(message, "user");
    chatInput.value = "";
    sendChatMessage(message);
  });
}
