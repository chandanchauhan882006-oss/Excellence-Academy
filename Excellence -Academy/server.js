// Excellence Academy backend: zero dependencies, Node 16+
// Serves public/index.html and accepts enquiries at POST /api/enquiry.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "enquiries.json");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "change-me";
if (ADMIN_TOKEN === "change-me")
  console.warn("WARNING: ADMIN_TOKEN is the default. Set a long random ADMIN_TOKEN before going live.");

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]");

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon",
};

// Injected into index.html so the existing form posts to the backend (no HTML edits needed).
const INJECT = `<script>
(function () {
  var form = document.getElementById("contactForm");
  var status = document.getElementById("formStatus");
  if (!form) return;
  var clone = form.cloneNode(true);           // drops the demo mailto handler
  form.parentNode.replaceChild(clone, form);
  clone.classList.add("visible");             // the copy is not watched by the scroll-reveal, so show it now
  clone.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!clone.reportValidity()) return;
    var btn = clone.querySelector("button[type=submit]");
    btn.disabled = true; status.style.color = ""; status.textContent = "Sending...";
    var payload = {};
    new FormData(clone).forEach(function (v, k) { payload[k] = v; });
    fetch("/api/enquiry", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (res.ok) { status.textContent = "Thank you! Your enquiry has been received."; clone.reset(); }
        else { status.style.color = "#b42318"; status.textContent = res.j.error || "Something went wrong."; }
      })
      .catch(function () { status.style.color = "#b42318"; status.textContent = "Network error. Please try again."; })
      .then(function () { btn.disabled = false; });
  });
})();
</script>`;

function readEnquiries() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { return []; }
}

function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

const hits = new Map(); // naive rate limit: 5 enquiries / 10 min / IP
function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 600000);
  list.push(now); hits.set(ip, list);
  return list.length > 5;
}

const clean = (v, max) => String(v || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "POST" && url.pathname === "/api/enquiry") {
    const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
    if (limited(ip)) return send(res, 429, { error: "Too many enquiries. Please try later." });
    let body = "";
    req.on("data", c => { body += c; if (body.length > 20000) req.destroy(); });
    req.on("end", () => {
      let d;
      try { d = JSON.parse(body); } catch { return send(res, 400, { error: "Invalid request." }); }
      const e = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: clean(d.name, 100), phone: clean(d.phone, 20), email: clean(d.email, 120),
        course: clean(d.course, 80), message: clean(d.message, 2000),
        receivedAt: new Date().toISOString(),
      };
      if (!e.name || !e.phone || !e.course || !e.message)
        return send(res, 400, { error: "Please complete all required fields." });
      if (!/^[0-9+\-()\s]{7,20}$/.test(e.phone))
        return send(res, 400, { error: "Please enter a valid phone number." });
      if (e.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.email))
        return send(res, 400, { error: "Please enter a valid email address." });
      const all = readEnquiries(); all.push(e);
      fs.writeFileSync(DATA_FILE, JSON.stringify(all, null, 2));
      console.log("New enquiry:", e.name, "-", e.course);
      send(res, 201, { ok: true, id: e.id });
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/enquiries") {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    const a = Buffer.from(token), b = Buffer.from(ADMIN_TOKEN);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return send(res, 401, { error: "Unauthorized" });
    return send(res, 200, readEnquiries());
  }

  if (req.method === "GET" && url.pathname === "/api/health") return send(res, 200, { ok: true });

  if (req.method !== "GET") return send(res, 405, { error: "Method not allowed" });

  // Static files
  let rel;
  try { rel = decodeURIComponent(url.pathname); }
  catch { res.writeHead(400, { "Content-Type": "text/plain" }); return res.end("Bad request"); }
  if (rel === "/") rel = "/index.html";
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not found"); }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    if (ext === ".html") res.end(buf.toString().replace("</body>", INJECT + "\n</body>"));
    else res.end(buf);
  });
});

server.listen(PORT, () => console.log("Excellence Academy server running on http://localhost:" + PORT));
