let shown = location.pathname + location.search;

const PREFETCH_LIMIT = 30;
const prefetched = new Map();

async function fetchPage(url) {
  const ahead = prefetched.get(url);
  prefetched.delete(url);
  const response = await (ahead ?? fetch(url));
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return { page: new DOMParser().parseFromString(await response.text(), "text/html"), url: response.url };
}

function prefetch(url) {
  if (prefetched.has(url) || url === location.href) return;
  if (prefetched.size >= PREFETCH_LIMIT) prefetched.delete(prefetched.keys().next().value);
  prefetched.set(url, fetch(url).then((response) => (response.ok ? response : Promise.reject(new Error(response.status)))).catch(() => {
    prefetched.delete(url);
    return fetch(url);
  }));
}

async function load(url) {
  const { page, url: final } = await fetchPage(url);
  const next = page.getElementById("page");
  if (next === null) throw new Error(`no content in ${url}`);

  const scrolled = document.querySelector(".toc-list")?.scrollTop ?? 0;
  const typed = document.getElementById("toc-filter")?.value ?? "";
  keepContents(next);
  document.getElementById("page").replaceWith(next);
  await completeContents(false);
  const list = next.querySelector(".toc-list");
  if (list !== null) {
    list.scrollTop = scrolled;
    const current = list.querySelector("a.cur");
    if (current !== null) {
      const above = current.offsetTop - list.offsetTop;
      const below = above + current.offsetHeight - list.clientHeight;
      if (above < list.scrollTop) list.scrollTop = above;
      else if (below > list.scrollTop) list.scrollTop = below;
    }
  }
  document.body.className = page.body.className;
  document.title = page.title;
  const input = document.getElementById("toc-filter");
  if (input !== null && typed !== "") input.value = typed;
  filterContents();
  return final;
}

const contentsCache = new Map();

function keepContents(incoming) {
  const current = document.querySelector("nav.toc[data-done]");
  const next = incoming.querySelector("nav.toc[data-all]");
  if (current === null || next === null) return;
  const target = new URL(next.dataset.all, location.href);
  const act = target.pathname.split("/")[1];
  const day = target.pathname.match(/\/(\d{4}-\d{2}-\d{2})\/cuprins$/)?.[1];
  if (new URL(current.dataset.done, location.href).pathname.split("/")[1] !== act) return;
  const open = next.querySelector(".toc-list > a.cur")?.getAttribute("href") ?? null;
  const list = current.querySelector(".toc-list");
  for (const row of list.querySelectorAll("a[href]")) {
    const article = new URL(row.getAttribute("href"), location.href).pathname.split("/")[2];
    if (article === undefined || !article.startsWith("art-")) continue;
    row.setAttribute("href", `/${act}/${article}${day === undefined ? "" : `/${day}`}${target.search}`);
    row.classList.toggle("cur", row.getAttribute("href") === open);
    if (row.getAttribute("href") === open) row.setAttribute("aria-current", "page");
    else row.removeAttribute("aria-current");
  }
  next.querySelector(".toc-list").replaceWith(list);
  next.dataset.done = next.dataset.all;
  delete next.dataset.all;
}

async function completeContents(fresh) {
  const toc = document.querySelector("nav.toc[data-all]");
  if (toc === null) return;
  const url = toc.dataset.all;
  if (!contentsCache.has(url)) {
    const fetched = fetchPage(url).then(({ page }) => {
      const found = page.querySelector(".toc-list");
      if (found === null) throw new Error(`no contents in ${url}`);
      return found;
    });
    fetched.catch(() => contentsCache.delete(url));
    contentsCache.set(url, fetched);
  }
  const list = (await contentsCache.get(url)).cloneNode(true);
  const current = toc.querySelector(".toc-list > a.cur")?.getAttribute("href") ?? null;
  const same = [...list.querySelectorAll("a")].find((row) => row.getAttribute("href") === current);
  if (same !== undefined) {
    same.classList.add("cur");
    same.setAttribute("aria-current", "page");
  }
  toc.querySelector(".toc-list").replaceWith(list);
  toc.dataset.done = url;
  delete toc.dataset.all;
  if (fresh && same !== undefined) list.scrollTop = same.offsetTop - list.offsetTop - (list.clientHeight - same.offsetHeight) / 2;
  filterContents();
}

function fold(text) {
  return text
    .normalize("NFC")
    .replace(/\u015f/g, "\u0219")
    .replace(/\u015e/g, "\u0218")
    .replace(/\u0163/g, "\u021b")
    .replace(/\u0162/g, "\u021a")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function filterContents() {
  const input = document.getElementById("toc-filter");
  const toc = document.querySelector("nav.toc");
  if (input === null || toc === null) return;
  if (toc.dataset.all !== undefined) {
    contentsReady.then(() => {
      if (toc.dataset.all === undefined) filterContents();
    });
    return;
  }
  const list = toc.querySelector(".toc-list");
  const query = fold(input.value).replace(/^art\.?\s*/, "");
  let shown = 0;
  for (const row of list.querySelectorAll(":scope > a:not(.more)")) {
    const hit = query === "" || fold(row.dataset.n ?? "").startsWith(query) || fold(row.dataset.title ?? "").includes(query) || fold(row.dataset.lead ?? "").includes(query);
    row.hidden = !hit;
    if (hit) shown++;
  }
  for (const more of list.querySelectorAll(":scope > a.more")) more.hidden = query !== "";
  list.querySelector(".toc-none")?.remove();
  if (query !== "" && shown === 0) {
    const note = document.createElement("p");
    note.className = "toc-note toc-none";
    note.textContent = toc.dataset.none ?? "";
    list.append(note);
  }
  const count = toc.dataset.count ?? "";
  document.getElementById("toc-status").textContent = query === "" ? "" : count.replace("{n}", shown);
  const cnt = toc.querySelector(".toc-head .cnt");
  if (cnt !== null) {
    cnt.dataset.total ??= cnt.textContent;
    cnt.textContent = query === "" ? cnt.dataset.total : count.replace("{n}", shown);
  }
}

let filterTimer = 0;
document.addEventListener("input", (event) => {
  if (event.target.id !== "toc-filter") return;
  clearTimeout(filterTimer);
  filterTimer = setTimeout(filterContents, 80);
});

const phoneSheet = matchMedia("(max-width:1100px)");

function focusFilterOnPhone() {
  if (location.hash === "#cuprins" && phoneSheet.matches) document.getElementById("toc-filter")?.focus();
}

addEventListener("hashchange", focusFilterOnPhone);

async function visit(url, { push }) {
  try {
    const final = new URL(await load(url));
    final.hash = new URL(url, location.href).hash;
    history[push ? "pushState" : "replaceState"](null, "", final);
    shown = final.pathname + final.search;
  } catch {
    location.assign(url);
  }
}

function apply(box) {
  const value = box.checked ? box.dataset.on : box.dataset.off;
  const url = new URL(location.href);
  if (value === "") url.searchParams.delete(box.dataset.param);
  else url.searchParams.set(box.dataset.param, value);

  if (box.dataset.flips) {
    document.querySelector("main article").classList.toggle(box.dataset.flips, box.checked);
    history.replaceState(null, "", url);
    shown = url.pathname + url.search;
    carryFlag(box.dataset.param, value);
    if (box.checked) showChange(true);
  } else {
    visit(url, { push: false });
  }
}

const calm = matchMedia("(prefers-reduced-motion:reduce)");

function showChange(smooth) {
  const line = document.querySelector("main article.hl .p.last");
  if (line === null) return false;
  line.scrollIntoView({ block: "start", behavior: smooth && !calm.matches ? "smooth" : "auto" });
  return true;
}

function carryFlag(param, value) {
  const carry = (address) => {
    const target = new URL(address, location.href);
    if (value === "") target.searchParams.delete(param);
    else target.searchParams.set(param, value);
    target.searchParams.sort();
    return target.pathname + target.search + target.hash;
  };
  for (const link of document.querySelectorAll("#page a[href]")) {
    if (inPlace(link)) link.setAttribute("href", carry(link.getAttribute("href")));
  }
  const toc = document.querySelector("nav.toc");
  if (toc === null) return;
  for (const key of ["all", "done"]) {
    if (toc.dataset[key] !== undefined) toc.dataset[key] = carry(toc.dataset[key]);
  }
  const form = toc.querySelector("form");
  const hidden = form.querySelector(`input[type=hidden][name="${param}"]`);
  if (value === "") hidden?.remove();
  else if (hidden !== null) hidden.value = value;
  else {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = param;
    input.value = value;
    form.append(input);
  }
}

function pick(url) {
  url.search = location.search;
  visit(url, { push: true });
}

document.addEventListener("change", (event) => {
  if (event.target.matches("input[type=checkbox][data-param]")) apply(event.target);
});

const IN_PLACE = /^\/(?!cauta$|modificari|despre$|legenda$|legislatie|lege\/|jurisprudenta\/)[a-z0-9-]+(\/(art-[^/]+|istoric|jurisprudenta|statistici|date|\d{4}-\d{2}-\d{2}))?(\/\d{4}-\d{2}-\d{2})?(\/compara\/[^/]+)?$/;

function inPlace(link) {
  if (link.target !== "" || link.hasAttribute("download") || link.origin !== location.origin) return false;
  if (link.getAttribute("href").startsWith("#")) return false;
  if (link.pathname === location.pathname && link.search === location.search && link.hash !== "") return false;
  return IN_PLACE.test(link.pathname);
}

for (const type of ["mouseover", "focusin", "touchstart"]) {
  document.addEventListener(type, (event) => {
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (link !== null && link.closest("#page") !== null && (link.matches("a[data-pick]") || inPlace(link))) prefetch(link.href);
  }, { passive: true });
}

document.addEventListener("click", (event) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target.closest("a[href]");
  if (link === null || link.closest("#page") === null) return;
  if (link.matches("a[data-pick]")) {
    event.preventDefault();
    pick(new URL(link.href));
  } else if (inPlace(link)) {
    event.preventDefault();
    const strip = link.closest(".tabs-list");
    if (strip === null) {
      visit(link.href, { push: true }).then(arrive);
      return;
    }
    const top = strip.getBoundingClientRect().top;
    visit(link.href, { push: true }).then(() => {
      const next = document.querySelector("#page .tabs-list");
      if (next === null) return arrive();
      scrollBy(0, next.getBoundingClientRect().top - top);
      next.querySelector("a[aria-current]")?.focus({ preventScroll: true });
      prefetchTabs();
    });
  }
});

function prefetchTabs() {
  for (const tab of document.querySelectorAll("#page .tabs-list a[href]:not([aria-current])")) {
    if (inPlace(tab)) prefetch(tab.href);
  }
}

function arrive() {
  const heading = document.querySelector("#main h1");
  if (heading !== null) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
  const target = location.hash.length > 1 ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
  if (target !== null) target.scrollIntoView();
  else if (!showChange(false)) document.getElementById("page").scrollIntoView();
}

addEventListener("popstate", () => {
  if (location.pathname + location.search === shown) return;
  load(location.href).then(
    () => {
      shown = location.pathname + location.search;
    },
    () => location.reload(),
  );
});

let contentsReady = completeContents(true).catch(() => {});
(window.requestIdleCallback ?? ((run) => setTimeout(run, 200)))(prefetchTabs);
focusFilterOnPhone();
if (location.hash.length <= 1) showChange(false);
