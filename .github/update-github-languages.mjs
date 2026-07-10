import fs from "node:fs/promises";
import path from "node:path";

const OWNER = process.env.GITHUB_LANGUAGE_OWNER || "zay002";
const OUTPUT_PATH = process.env.GITHUB_LANGUAGE_OUTPUT || "assets/github-languages.json";
const INCLUDE_FORKS = process.env.GITHUB_LANGUAGE_INCLUDE_FORKS === "true";
const INCLUDE_ARCHIVED = process.env.GITHUB_LANGUAGE_INCLUDE_ARCHIVED !== "false";
const MAX_LANGUAGES = Number.parseInt(process.env.GITHUB_LANGUAGE_LIMIT || "8", 10);

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "zay002-language-profile-updater",
};

if (token) {
  headers.Authorization = `Bearer ${token}`;
}

const LANGUAGE_COLORS = {
  Python: "#63d7ff",
  JavaScript: "#f7df1e",
  TypeScript: "#3178c6",
  HTML: "#e34c26",
  CSS: "#8aa4ff",
  GDScript: "#355570",
  "Jupyter Notebook": "#da5b0b",
  C: "#555555",
  "C++": "#f34b7d",
  Cuda: "#7bf1c7",
  CUDA: "#7bf1c7",
  Shell: "#89e051",
  MATLAB: "#e16737",
  Java: "#b07219",
  Vue: "#41b883",
  Astro: "#ff5d01",
};

const LANGUAGE_DISPLAY_NAMES = {
  Cuda: "CUDA",
};

async function main() {
  const repos = await fetchAllPages(`https://api.github.com/users/${OWNER}/repos?per_page=100&type=owner&sort=updated`);
  const countedRepos = repos.filter((repo) => {
    if (!INCLUDE_FORKS && repo.fork) return false;
    if (!INCLUDE_ARCHIVED && repo.archived) return false;
    return !repo.private;
  });

  const totals = new Map();

  for (const repo of countedRepos) {
    const languages = await requestJson(repo.languages_url);
    Object.entries(languages).forEach(([language, bytes]) => {
      totals.set(language, (totals.get(language) || 0) + bytes);
    });
  }

  const totalBytes = Array.from(totals.values()).reduce((sum, bytes) => sum + bytes, 0);
  const languages = Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_LANGUAGES)
    .map(([name, bytes]) => ({
      name: LANGUAGE_DISPLAY_NAMES[name] || name,
      bytes,
      share: totalBytes ? Number(((bytes / totalBytes) * 100).toFixed(1)) : 0,
      color: LANGUAGE_COLORS[name] || "#9fb3ff",
    }));

  const payload = {
    owner: OWNER,
    updatedAt: new Date().toISOString(),
    source: "GitHub Linguist language statistics",
    repoCount: countedRepos.length,
    totalBytes,
    languages,
  };
  const existing = await readExistingProfile(OUTPUT_PATH);

  if (existing && isSameLanguageProfile(existing, payload)) {
    payload.updatedAt = existing.updatedAt || payload.updatedAt;
  }

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(`${OUTPUT_PATH}.tmp`, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.rename(`${OUTPUT_PATH}.tmp`, OUTPUT_PATH);

  console.log(`Wrote ${OUTPUT_PATH} with ${languages.length} languages across ${countedRepos.length} repositories.`);
}

async function fetchAllPages(url) {
  const items = [];
  let nextUrl = url;

  while (nextUrl) {
    const response = await request(nextUrl);
    const page = await response.json();
    if (!Array.isArray(page)) {
      throw new Error(`Expected an array from ${nextUrl}`);
    }

    items.push(...page);
    nextUrl = parseNextLink(response.headers.get("link"));
  }

  return items;
}

async function requestJson(url) {
  const response = await request(url);
  return response.json();
}

async function request(url) {
  const response = await fetch(url, { headers });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}\n${body}`);
  }

  return response;
}

function parseNextLink(linkHeader) {
  if (!linkHeader) return null;

  const next = linkHeader
    .split(",")
    .map((part) => part.trim())
    .find((part) => part.endsWith('rel="next"'));

  return next?.match(/<([^>]+)>/)?.[1] || null;
}

async function readExistingProfile(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function isSameLanguageProfile(a, b) {
  return JSON.stringify(profileComparableFields(a)) === JSON.stringify(profileComparableFields(b));
}

function profileComparableFields(profile) {
  return {
    owner: profile.owner,
    source: profile.source,
    repoCount: profile.repoCount,
    totalBytes: profile.totalBytes,
    languages: profile.languages,
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
