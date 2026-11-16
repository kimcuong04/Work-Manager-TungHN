// Đóng gói bộ cài Windows.
//   node scripts/dist.mjs              → bộ cài NSIS local (không upload)
//   node scripts/dist.mjs --portable   → bản portable (không tự cập nhật được)
//   node scripts/dist.mjs --publish    → build + đăng GitHub Release (dùng trong CI, cần GH_TOKEN)
// Repo nhận bản phát hành: biến RELEASE_REPO ("owner/repo"), nếu không có thì lấy từ `git remote origin`.
// Có repo thì bộ cài nhúng app-update.yml trỏ về đó để app tự kiểm tra cập nhật.
//
// Khi phát hành: tự tạo trước MỘT release nháp rồi mới cho electron-builder upload, cuối cùng mới công khai.
// Nếu để electron-builder tự tạo, các luồng upload song song có thể tạo 2 release trùng tag → link tải 404.
import fs from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';

const publish = process.argv.includes('--publish');
const portable = process.argv.includes('--portable');
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const tag = `v${version}`;

function detectRepo() {
  if (process.env.RELEASE_REPO) return process.env.RELEASE_REPO.trim();
  try {
    const url = execSync('git remote get-url origin', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const m = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
    return m ? `${m[1]}/${m[2]}` : null;
  } catch {
    return null;
  }
}

const repo = detectRepo();
const validRepo = !!repo && /^[\w.-]+\/[\w.-]+$/.test(repo);
if (publish && !validRepo) {
  console.error('[dist] Thiếu RELEASE_REPO hoặc remote GitHub — không thể phát hành.');
  process.exit(1);
}

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
async function gh(method, path, body) {
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ppm-release',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub API ${method} ${path} → ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

function runBuilder(releaseType) {
  const args = ['electron-builder', '--win', portable ? 'portable' : 'nsis', '--publish', publish ? 'always' : 'never'];
  if (validRepo) {
    const [owner, name] = repo.split('/');
    args.push('-c.publish.provider=github', `-c.publish.owner=${owner}`, `-c.publish.repo=${name}`, `-c.publish.releaseType=${releaseType}`);
  }
  for (const a of process.argv.slice(2)) if (a.startsWith('-c.')) args.push(a);
  const r = spawnSync('npx', args, { stdio: 'inherit', shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!publish) {
  if (validRepo) console.log(`[dist] Kênh cập nhật: github.com/${repo}`);
  else console.warn('[dist] Chưa có remote GitHub: bản build này sẽ KHÔNG tự cập nhật được.');
  runBuilder('release');
  process.exit(0);
}

if (!token) {
  console.error('[dist] Thiếu GH_TOKEN.');
  process.exit(1);
}
const notes = process.env.RELEASE_NOTES_FILE && fs.existsSync(process.env.RELEASE_NOTES_FILE)
  ? fs.readFileSync(process.env.RELEASE_NOTES_FILE, 'utf8').trim()
  : '';

console.log(`[dist] Phát hành ${tag} lên github.com/${repo}`);
const existing = (await gh('GET', '/releases?per_page=100')).filter((r) => r.tag_name === tag);
if (existing.some((r) => !r.draft)) {
  console.error(`[dist] Đã có release công khai cho ${tag}. Hãy tăng version (npm version patch) rồi đẩy tag mới.`);
  process.exit(1);
}
const [draft, ...duplicates] = existing.length ? existing : [await gh('POST', '/releases', { tag_name: tag, name: version, body: notes, draft: true })];
for (const d of duplicates) await gh('DELETE', `/releases/${d.id}`);
console.log(`[dist] Release nháp #${draft.id} sẵn sàng, bắt đầu build & upload.`);

runBuilder('draft');

const uploaded = (await gh('GET', `/releases/${draft.id}`)).assets.map((a) => a.name);
const required = [`PersonalProjectManager-Setup-${version}.exe`, 'latest.yml'];
const missing = required.filter((n) => !uploaded.includes(n));
if (missing.length) {
  console.error(`[dist] Thiếu file trong release nháp: ${missing.join(', ')} — chưa công khai.`);
  process.exit(1);
}
const strays = (await gh('GET', '/releases?per_page=100')).filter((r) => r.tag_name === tag && r.id !== draft.id);
if (strays.length) {
  console.error(`[dist] Phát hiện ${strays.length} release trùng tag ${tag} — chưa công khai.`);
  process.exit(1);
}

await gh('PATCH', `/releases/${draft.id}`, { tag_name: tag, name: version, body: notes, draft: false, make_latest: 'true' });
console.log(`[dist] Đã công khai ${tag}: ${uploaded.join(', ')}`);

for (let i = 0; i < 12; i++) {
  const res = await fetch(`https://github.com/${repo}/releases/download/${tag}/latest.yml`, { redirect: 'follow' });
  if (res.ok && (await res.text()).includes(`version: ${version}`)) {
    console.log('[dist] Kiểm tra link tải latest.yml: OK');
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 10000));
}
console.error('[dist] Release đã công khai nhưng link tải latest.yml chưa truy cập được sau 2 phút.');
process.exit(1);
