
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const RESOLVER_URL = process.env.RESOLVER_URL || "";
const RESOLVER_API_KEY = process.env.RESOLVER_API_KEY || "";

app.disable("x-powered-by");
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "32kb" }));

// Simple per-IP rate limiter
const requests = new Map();
const WINDOW = 60 * 1000;
const MAX_REQUESTS = 30;

app.use((req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  let record = requests.get(ip);

  if (!record || now - record.start > WINDOW) {
    record = { start: now, count: 0 };
  }

  record.count++;
  requests.set(ip, record);

  if (record.count > MAX_REQUESTS) {
    return res.status(429).json({
      success: false,
      error: "Too many requests. Try again later."
    });
  }

  next();
});

// Accept only public TeraBox share links
function validateUrl(value) {
  try {
    const url = new URL(value);

    const allowedHosts = [
      "terabox.com",
      "www.terabox.com",
      "1024terabox.com",
      "www.1024terabox.com",
      "teraboxapp.com",
      "www.teraboxapp.com",
      "terabox.app",
      "www.terabox.app",
      "4funbox.com",
      "www.4funbox.com",
      "mirrobox.com",
      "www.mirrobox.com",
      "nephobox.com",
      "www.nephobox.com"
    ];

    return (
      ["https:", "http:"].includes(url.protocol) &&
      allowedHosts.includes(url.hostname.toLowerCase()) &&
      /^\/s\//.test(url.pathname)
    );
  } catch {
    return false;
  }
}

// Normalize resolver response
function normalizeFiles(data) {
  const source = Array.isArray(data)
    ? data
    : data.files || data.list || data.data?.files || data.data?.list || [];

  return source.map(file => ({
    name: file.file_name ||
          file.server_filename ||
          file.filename ||
          file.name || null,

    file_id: file.fs_id || file.file_id || null,

    size: file.size_bytes ??
          file.size ??
          null,

    mime_type: file.mime_type ||
               file.mime ||
               null,

    category: file.category || "unknown",

    direct_download_url:
      file.direct_download_url ||
      file.original_download_url ||
      file.dlink ||
      file.download_url ||
      file.download ||
      null,

    thumbnail: file.thumbnail || file.thumb || null,

    is_directory: Boolean(
      file.isdir || file.is_directory || file.type === "folder"
    )
  }));
}

// Home
app.get("/", (req, res) => {
  res.json({
    name: "TeraBoxDL API",
    version: "1.0.0",
    status: "online",
    endpoints: {
      health: "/health",
      resolve: "/api/resolve?url=TERABOX_LINK"
    },
    resolver_configured: Boolean(RESOLVER_URL)
  });
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "online",
    resolver_configured: Boolean(RESOLVER_URL),
    timestamp: new Date().toISOString()
  });
});

// Resolve file or folder
app.get("/api/resolve", async (req, res) => {
  try {
    const shareUrl = req.query.url;

    if (!shareUrl) {
      return res.status(400).json({
        success: false,
        error: "TeraBox URL is required"
      });
    }

    if (!validateUrl(shareUrl)) {
      return res.status(400).json({
        success: false,
        error: "Invalid or unsupported public TeraBox share URL"
      });
    }

    if (!RESOLVER_URL) {
      return res.status(503).json({
        success: false,
        error: "Resolver engine is not configured",
        message: "Set RESOLVER_URL in Render environment variables."
      });
    }

    const headers = {
      "Content-Type": "application/json",
      "Accept": "application/json"
    };

    if (RESOLVER_API_KEY) {
      headers["Authorization"] = `Bearer ${RESOLVER_API_KEY}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    let upstream;

    try {
      upstream = await fetch(RESOLVER_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          url: shareUrl,
          recursive: true,
          include_all_files: true
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    const raw = await upstream.text();

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(502).json({
        success: false,
        error: "Resolver returned invalid JSON"
      });
    }

    if (!upstream.ok) {
      return res.status(502).json({
        success: false,
        error: "Resolver request failed",
        upstream_status: upstream.status
      });
    }

    if (data.success === false || data.status === "error") {
      return res.status(502).json({
        success: false,
        error: data.error || "Unable to resolve TeraBox link"
      });
    }

    const files = normalizeFiles(data);

    return res.json({
      success: true,
      source: "TeraBox",
      total_files: files.length,
      files_with_download_links:
        files.filter(f => f.direct_download_url).length,
      files,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("Resolve error:", error.message);

    return res.status(
      error.name === "AbortError" ? 504 : 500
    ).json({
      success: false,
      error: error.name === "AbortError"
        ? "Resolver timed out"
        : "Internal server error"
    });
  }
});

// 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found"
  });
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`TeraBoxDL API running on port ${PORT}`);
});
