// Đóng gói bộ cài Windows.
//   node scripts/dist.mjs              → bộ cài NSIS local (không upload)
//   node scripts/dist.mjs --portable   → bản portable (không tự cập nhật được)
//   node scripts/dist.mjs --publish    → build + đăng GitHub Release (dùng trong CI, cần GH_TOKEN)
// Repo nhận bản phát hành: biến RELEASE_REPO ("owner/repo"), nếu không có thì lấy từ `git remote origin`.
// Có repo thì bộ cài nhúng app-update.yml trỏ về đó để app tự kiểm tra cập nhật.
import { execSync, spawnSync } from 'node:child_process';

const publish = process.argv.includes('--publish');
const portable = process.argv.includes('--portable');

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
const args = ['electron-builder', '--win', portable ? 'portable' : 'nsis', '--publish', publish ? 'always' : 'never'];
if (repo && /^[\w.-]+\/[\w.-]+$/.test(repo)) {
  const [owner, name] = repo.split('/');
  args.push('-c.publish.provider=github', `-c.publish.owner=${owner}`, `-c.publish.repo=${name}`, '-c.publish.releaseType=release');
  console.log(`[dist] Kênh cập nhật: github.com/${repo}`);
} else if (publish) {
  console.error('[dist] Thiếu RELEASE_REPO hoặc remote GitHub — không thể phát hành.');
  process.exit(1);
} else {
  console.warn('[dist] Chưa có remote GitHub: bản build này sẽ KHÔNG tự cập nhật được.');
}
if (process.env.RELEASE_NOTES_FILE) args.push(`-c.releaseInfo.releaseNotesFile=${process.env.RELEASE_NOTES_FILE}`);
for (const a of process.argv.slice(2)) if (a.startsWith('-c.')) args.push(a);

const r = spawnSync('npx', args, { stdio: 'inherit', shell: true });
process.exit(r.status ?? 1);
