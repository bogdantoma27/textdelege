function initPanelTabs() {
  const tabs = document.querySelectorAll("a[data-panel]");
  if (tabs.length === 0) return;
  const show = (name) => {
    for (const tab of tabs) {
      const active = tab.dataset.panel === name;
      const panel = document.getElementById(tab.dataset.panel);
      if (panel) panel.hidden = !active;
      tab.parentElement.classList.toggle("selected", active);
      if (active) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    }
  };
  for (const tab of tabs) {
    tab.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      show(tab.dataset.panel);
      const url = new URL(tab.href);
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    });
  }
}

function initSearchOverlay() {
  const overlay = document.getElementById("cauta");
  const opener = document.querySelector(".find");
  const field = overlay?.querySelector("input");
  if (!overlay || !opener || !field) return;

  const clearHash = () => {
    if (location.hash === "#cauta") history.replaceState(null, "", location.pathname + location.search);
  };
  const behind = () => [...document.body.children].filter((element) => element !== overlay && element.tagName !== "SCRIPT");
  const open = () => {
    overlay.classList.add("open");
    for (const element of behind()) element.inert = true;
    clearHash();
    field.focus();
  };
  const close = () => {
    const wasOpen = overlay.classList.contains("open");
    overlay.classList.remove("open");
    for (const element of behind()) element.inert = false;
    clearHash();
    if (wasOpen) opener.focus();
  };

  opener.addEventListener("click", (event) => {
    event.preventDefault();
    open();
  });
  overlay.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest(".scrim, .close")) {
      event.preventDefault();
      close();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && overlay.classList.contains("open")) close();
  });
  if (location.hash === "#cauta") open();
}

function initSearchForms() {
  for (const form of document.querySelectorAll("form[role=search]")) {
    const field = form.querySelector("input[name=q]");
    if (!field) continue;
    const hint = document.createElement("p");
    hint.className = "search-hint";
    hint.setAttribute("role", "status");
    form.append(hint);
    const clear = () => {
      hint.textContent = "";
    };
    form.addEventListener("submit", (event) => {
      if (field.value.trim() !== "") return;
      event.preventDefault();
      field.value = "";
      hint.textContent = form.dataset.empty ?? "";
      field.focus();
    });
    field.addEventListener("input", clear);
    field.addEventListener("blur", clear);
  }
}

const LIVE_DELAY = 250;
const LIVE_MIN_LENGTH = 2;

function initLiveSearch() {
  let serial = 0;
  for (const form of document.querySelectorAll("form[role=search]")) {
    const field = form.querySelector("input[name=q]");
    if (!field) continue;
    const listId = `live-results-${++serial}`;

    const box = document.createElement("div");
    box.className = "search-results";
    box.hidden = true;
    const status = document.createElement("p");
    status.className = "search-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const list = document.createElement("ul");
    list.className = "plain hits";
    list.id = listId;
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", form.querySelector("label")?.textContent ?? "");
    box.append(status, list);
    form.append(box);
    field.setAttribute("role", "combobox");
    field.setAttribute("aria-autocomplete", "list");
    field.setAttribute("aria-controls", listId);
    field.setAttribute("aria-expanded", "false");

    const cache = new Map();
    let controller = null;
    let timer = 0;
    let shown = "";
    let active = -1;

    const options = () => [...list.children];
    const activate = (index) => {
      const items = options();
      for (const item of items) item.setAttribute("aria-selected", "false");
      active = index;
      if (index < 0) {
        field.removeAttribute("aria-activedescendant");
        return;
      }
      items[index].setAttribute("aria-selected", "true");
      field.setAttribute("aria-activedescendant", items[index].id);
      items[index].scrollIntoView({ block: "nearest" });
    };
    const hide = () => {
      clearTimeout(timer);
      controller?.abort();
      box.hidden = true;
      field.setAttribute("aria-expanded", "false");
      status.textContent = "";
      list.replaceChildren();
      shown = "";
      activate(-1);
    };
    const render = (query, result) => {
      status.textContent = result.status;
      const all = document.createElement("li");
      all.className = "search-all";
      const allLink = document.createElement("a");
      allLink.textContent = form.dataset.all ?? "";
      allLink.href = `/cauta?q=${encodeURIComponent(query)}`;
      all.append(allLink);
      list.replaceChildren(...result.hits.map((hit) => hit.cloneNode(true)), all);
      options().forEach((item, index) => {
        item.id = `${listId}-${index}`;
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", "false");
      });
      activate(-1);
      box.hidden = false;
      field.setAttribute("aria-expanded", "true");
      shown = query;
    };
    const load = async (query) => {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch(`/cauta?q=${encodeURIComponent(query)}`, {
          credentials: "same-origin",
          signal: controller.signal,
        });
        const page = new DOMParser().parseFromString(await response.text(), "text/html");
        const result = { status: "", hits: [] };
        if (response.redirected) {
          const item = document.createElement("li");
          item.className = "hit";
          const link = document.createElement("a");
          link.href = response.url;
          link.textContent = page.querySelector("h1")?.textContent ?? response.url;
          item.append(link);
          result.hits.push(item);
        } else {
          result.hits.push(...page.querySelectorAll("ul.hits li.hit"));
          const note = result.hits.length > 0 ? page.querySelector(".results-bar .count") : page.querySelector("main h2");
          result.status = note?.textContent.trim() ?? "";
        }
        cache.set(query, result);
        render(query, result);
      } catch (error) {
        if (error.name !== "AbortError") hide();
      }
    };
    const update = () => {
      clearTimeout(timer);
      const query = field.value.trim();
      if (query.length < LIVE_MIN_LENGTH) {
        hide();
        return;
      }
      if (query === shown && !box.hidden) return;
      const cached = cache.get(query);
      if (cached) {
        controller?.abort();
        render(query, cached);
      } else {
        timer = setTimeout(() => load(query), LIVE_DELAY);
      }
    };
    const firstHit = () => list.querySelector("li.hit .hit-head a, li.hit > a");

    field.addEventListener("input", () => {
      activate(-1);
      update();
    });
    field.addEventListener("focus", () => {
      if (box.hidden && field.value.trim().length >= LIVE_MIN_LENGTH) update();
    });
    list.addEventListener("click", (event) => {
      const link = event.target instanceof Element ? event.target.closest("li")?.querySelector("a") : null;
      if (link && !link.contains(event.target)) link.click();
    });
    box.addEventListener("mousedown", (event) => event.preventDefault());
    form.addEventListener("focusout", (event) => {
      if (!(event.relatedTarget instanceof Node && form.contains(event.relatedTarget))) hide();
    });
    form.addEventListener("keydown", (event) => {
      if (event.target !== field) {
        if (event.key === "Escape" && !box.hidden) {
          event.stopPropagation();
          hide();
          field.focus();
        }
        return;
      }
      if (event.key === "Escape" && !box.hidden) {
        event.preventDefault();
        event.stopPropagation();
        hide();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        if (box.hidden) update();
        else activate(Math.min(active + 1, options().length - 1));
      } else if (event.key === "ArrowUp" && !box.hidden) {
        event.preventDefault();
        activate(active - 1);
      } else if (event.key === "Enter" && !box.hidden && active >= 0) {
        event.preventDefault();
        location.assign(options()[active].querySelector("a").href);
      } else if (event.key === "Enter" && !box.hidden && shown === field.value.trim() && firstHit()) {
        event.preventDefault();
        location.assign(firstHit().href);
      }
    });
    document.addEventListener("click", (event) => {
      if (event.target instanceof Node && !form.contains(event.target)) hide();
    });
  }
}

const TYPED_DAY = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, "0");

function isoOf(text) {
  const value = text.trim();
  if (ISO_DAY.test(value)) return value;
  const match = TYPED_DAY.exec(value);
  return match ? `${match[3]}-${pad(match[2])}-${pad(match[1])}` : "";
}

function showCalendarButtons() {
  if (!("showPicker" in HTMLInputElement.prototype)) return;
  for (const button of document.querySelectorAll("button[data-calendar]")) button.hidden = false;
}

for (const box of document.querySelectorAll(".search-filters input[type=checkbox]")) {
  box.addEventListener("change", () => box.form.requestSubmit());
}

document.addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest("button[data-calendar]") : null;
  if (button === null) return;
  const field = document.getElementById(button.dataset.calendar);
  const picker = button.parentElement.querySelector("input[type=date]");
  if (field === null || picker === null) return;
  picker.value = isoOf(field.value);
  picker.onchange = () => {
    const [year, month, day] = picker.value.split("-");
    if (day === undefined) return;
    field.value = `${day}.${month}.${year}`;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.focus();
  };
  try {
    picker.showPicker();
  } catch {
    field.focus();
  }
});

function openExternalLinksApart() {
  for (const link of document.querySelectorAll("a[href^='http']")) {
    if (link.host === location.host || link.target !== "") continue;
    link.target = "_blank";
    link.rel = "noopener";
  }
}

function updateScrollLinks() {
  const up = document.querySelector(".to-top");
  const down = document.querySelector(".to-bottom");
  if (!up || !down) return;
  const pastTop = scrollY > 400;
  up.classList.toggle("show", pastTop);
  down.classList.toggle("show", !pastTop && document.documentElement.scrollHeight - scrollY - innerHeight > 400);
}

const messages = new WeakMap();

function report(button, text, seconds) {
  const status = button.nextElementSibling;
  clearTimeout(messages.get(status));
  status.textContent = text;
  messages.set(status, setTimeout(() => (status.textContent = ""), seconds * 1000));
}

function initCopyButtons() {
  document.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("button[data-copy]") : null;
    if (button === null) return;
    navigator.clipboard.writeText(button.dataset.copy).then(
      () => report(button, button.dataset.copied, 2),
      () => report(button, button.dataset.failed, 6),
    );
  });
}

function initFilterForms() {
  for (const form of document.querySelectorAll("form[data-filter]:not([data-ready])")) {
    form.dataset.ready = "";
    const button = form.querySelector("button[type=submit]");
    if (button === null) continue;
    const state = () => new URLSearchParams([...new FormData(form)].filter(([, value]) => value !== "")).toString();
    const loaded = state();
    const update = () => {
      button.disabled = state() === loaded;
    };
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    form.addEventListener("submit", (event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      const query = state();
      location.assign(form.action.split("?")[0] + (query === "" ? "" : "?" + query));
    });
    update();
  }
}

function initTimelineWheel() {
  document.addEventListener(
    "wheel",
    (event) => {
      const track = event.target instanceof Element ? event.target.closest(".track.even") : null;
      if (track === null || event.ctrlKey || event.deltaY === 0 || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const max = track.scrollWidth - track.clientWidth;
      if (max <= 0) return;
      if ((event.deltaY < 0 && track.scrollLeft <= 0) || (event.deltaY > 0 && track.scrollLeft >= max - 1)) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? track.clientWidth : 1;
      track.scrollLeft += event.deltaY * unit;
    },
    { passive: false },
  );
}

function centreTimelines() {
  for (const track of document.querySelectorAll(".track.even:not([data-centred])")) {
    track.dataset.centred = "";
    const current = track.querySelector("li.cur");
    if (current === null) continue;
    track.scrollLeft = current.offsetLeft - track.clientWidth / 2;
  }
}

function initScrollLinks() {
  addEventListener("scroll", updateScrollLinks, { passive: true });
  addEventListener("resize", updateScrollLinks);
  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest(".to-top, .to-bottom") : null;
    if (link === null) return;
    event.preventDefault();
    const top = link.classList.contains("to-top") ? 0 : document.documentElement.scrollHeight;
    scrollTo({ top, behavior: "smooth" });
  });
  updateScrollLinks();
}

const SIZES = [15, 16, 17, 19, 21];
const DEFAULT_SIZE = 19;
const SETTINGS_KEY = "tdl.settings";

function readSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {
    return {};
  }
}

function applySettings(settings) {
  const root = document.documentElement;
  for (const size of SIZES) root.classList.toggle("text-" + size, settings.size === size);
  if (settings.theme === "light" || settings.theme === "dark") root.setAttribute("data-theme", settings.theme);
  else root.removeAttribute("data-theme");
}

function initPhoneMenu() {
  const menu = document.querySelector("details.menu");
  if (menu === null) return;
  document.addEventListener("click", (event) => {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !menu.open || menu.querySelector("details.display[open]") !== null) return;
    menu.open = false;
    menu.querySelector("summary").focus();
  });
}

function initTabStrips() {
  for (const list of document.querySelectorAll(".tabs-list:not([data-strip])")) {
    list.dataset.strip = "";
    const tabs = list.closest(".tabs");
    const update = () => {
      tabs.classList.toggle("fade-start", list.scrollLeft > 1);
      tabs.classList.toggle("fade-end", list.scrollLeft + list.clientWidth < list.scrollWidth - 1);
    };
    list.addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
    const selected = list.querySelector(".selected");
    if (selected !== null && list.scrollWidth > list.clientWidth) list.scrollLeft = selected.offsetLeft - 16;
    update();
  }
}

function initDisplayMenus() {
  const menus = [...document.querySelectorAll("details.display")];
  if (menus.length === 0) return;
  const settings = readSettings();
  const fill = () => {
    for (const input of menus.flatMap((menu) => [...menu.querySelectorAll("input")])) {
      if (input.name.endsWith("theme")) input.checked = input.value === (settings.theme || "auto");
      else if (input.name.endsWith("size")) input.checked = Number(input.value) === (settings.size || DEFAULT_SIZE);
    }
  };
  fill();
  for (const menu of menus) {
    menu.addEventListener("change", (event) => {
      const input = event.target;
      if (input.name.endsWith("theme")) settings.theme = input.value === "auto" ? undefined : input.value;
      else if (input.name.endsWith("size")) settings.size = Number(input.value) === DEFAULT_SIZE ? undefined : Number(input.value);
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch {}
      applySettings(settings);
      fill();
    });
    menu.addEventListener("toggle", () => {
      if (menu.open) for (const other of menus) if (other !== menu) other.open = false;
    });
  }
  document.addEventListener("click", (event) => {
    for (const menu of menus) if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") for (const menu of menus) menu.open = false;
  });
}

new MutationObserver(() => {
  showCalendarButtons();
  openExternalLinksApart();
  updateScrollLinks();
  centreTimelines();
  initTabStrips();
  initFilterForms();
}).observe(document.body, { childList: true });

initPanelTabs();
initSearchOverlay();
initSearchForms();
initLiveSearch();
showCalendarButtons();
openExternalLinksApart();
initScrollLinks();
initTimelineWheel();
initFilterForms();
initCopyButtons();
centreTimelines();
initPhoneMenu();
initDisplayMenus();
initTabStrips();
