
const ENGINE_URL = process.env.TERABOX_ENGINE_URL;

function normalizeFiles(files) {
  if (!Array.isArray(files)) return [];

  return files.map(file => ({
    name: file.file_name || file.name || null,
    file_id: file.fs_id || null,
    size: file.file_size || file.size_bytes || null,
    mime_type: file.mime_type || null,
    category: file.category || "unknown",
    direct_download_url:
      file.download_url ||
      file.stream_url ||
      file.dlink ||
      null,
    original_download_url: file.dlink || null,
    thumbnail: file.thumbnail || null,
    is_directory: false
  }));
}

async function resolveTeraBox(shareUrl) {
  if (!ENGINE_URL) {
    throw new Error("TERABOX_ENGINE_URL is not configured");
  }

  const endpoint = new URL("/api/resolve", ENGINE_URL);
  endpoint.searchParams.set("link", shareUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json"
      },
      signal: controller.signal
    });

    const result = await response.json();

    if (!response.ok || result.status !== "success") {
      throw new Error(
        result.error?.message ||
        result.error ||
        "TeraBox resolution failed"
      );
    }

    const files = normalizeFiles(result.files);

    return {
      success: true,
      source: "TeraBox",
      total_files: files.length,
      files_with_download_links:
        files.filter(f => f.direct_download_url).length,
      truncated: Boolean(result.share?.truncated),
      files
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { resolveTeraBox };
