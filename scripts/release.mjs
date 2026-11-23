// Phát hành bản cập nhật bằng một lệnh: kiểm tra → commit → nâng version + tag → push → GitHub Actions đăng Release.
//
//   npm run release                 đọc loại bản + tiêu đề commit từ file .release-msg.txt (Claude soạn sẵn)
//   npm run release -- minor -m "Thêm module Báo cáo"
//   npm run release -- --dry-run    chỉ in các bước, không thay đổi gì
//   Thêm --skip-tests để bỏ qua typecheck + unit test (không khuyến khích).
//
// File .release-msg.txt (không commit, tự xóa sau khi phát hành):
//   bump: minor
//   Tiêu đề commit — dòng này thành ghi chú "Có gì mới" hiển thị cho user
//   (các dòng sau, nếu có, là phần mô tả thêm của commit)
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';

const MSG_FILE = path.resolve('.release-msg.txt');
const BUMPS = ['patch', 'minor', 'major'];
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const skipTests = args.includes('--skip-tests');
const yes = args.includes('--yes');
const mIdx = args.indexOf('-m');
let message = mIdx >= 0 ? args[mIdx + 1] ?? '' : '';
let bump = args.find((a) => BUMPS.includes(a)) ?? '';

const out = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const run = (cmd) => {
  console.log(`\n> ${cmd}`);
  if (dry) return;
  const r = spawnSync(cmd, { stdio: 'inherit', shell: true });
  if (r.status !== 0) fail(`Lệnh thất bại: ${cmd}`);
};
function fail(msg) {
  console.error(`\n✖ ${msg}\n  Chưa phát hành. Sửa lỗi rồi chạy lại.`);
  process.exit(1);
}

// --- Đọc loại bản + tiêu đề từ file nếu không truyền qua tham số ---
let body = '';
if (fs.existsSync(MSG_FILE)) {
  const lines = fs.readFileSync(MSG_FILE, 'utf8').replace(/^﻿/, '').split(/\r?\n/);
  const rest = [];
  for (const line of lines) {
    const m = line.match(/^\s*bump\s*:\s*(\w+)\s*$/i);
    if (m && BUMPS.includes(m[1].toLowerCase())) {
      if (!bump) bump = m[1].toLowerCase();
    } else rest.push(line);
  }
  while (rest.length && !rest[0].trim()) rest.shift();
  if (!message && rest.length) {
    message = rest.shift().trim();
    body = rest.join('\n').trim();
  }
}

// --- Kiểm tra repo ---
try {
  out('git rev-parse --is-inside-work-tree');
} catch {
  fail('Thư mục này không phải git repo.');
}
const branch = out('git rev-parse --abbrev-ref HEAD');
if (branch !== 'main') fail(`Đang ở nhánh "${branch}" — chỉ phát hành từ nhánh main.`);
console.log('Kiểm tra bản mới nhất trên GitHub…');
try {
  out('git fetch origin --tags');
} catch (e) {
  fail(`Không kết nối được GitHub (git fetch): ${e.stderr || e.message}`);
}
const behind = Number(out('git rev-list --count HEAD..origin/main'));
if (behind > 0) fail(`Máy đang thiếu ${behind} commit mới trên GitHub. Chạy "git pull" trước.`);

const status = out('git status --porcelain').split('\n').filter((l) => l && !l.endsWith('.release-msg.txt'));
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const [ma, mi, pa] = pkg.version.split('.').map(Number);

const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
if (!bump) {
  const a = rl ? (await rl.question('Loại bản? [1] patch – sửa lỗi  [2] minor – tính năng  [3] major  (mặc định 1): ')).trim() : '';
  bump = { 2: 'minor', 3: 'major', minor: 'minor', major: 'major' }[a] ?? 'patch';
}
if (status.length && !message) {
  message = rl ? (await rl.question('Tiêu đề commit (thành ghi chú "Có gì mới", viết tiếng Việt): ')).trim() : '';
  if (!message) fail('Cần tiêu đề commit cho các thay đổi chưa commit.');
}
if (message && /^(chore|ci|test|build):/i.test(message))
  console.warn(`\n⚠ Tiêu đề bắt đầu bằng "${message.split(':')[0]}:" sẽ KHÔNG hiện trong ghi chú "Có gì mới".`);

const next = bump === 'major' ? `${ma + 1}.0.0` : bump === 'minor' ? `${ma}.${mi + 1}.0` : `${ma}.${mi}.${pa + 1}`;
if (out(`git tag -l v${next}`)) fail(`Tag v${next} đã tồn tại.`);

console.log(`\n=== Phát hành ${pkg.version} → ${next} (${bump}) ===`);
if (status.length) {
  console.log(`Commit ${status.length} file thay đổi với tiêu đề:\n  ${message}`);
  for (const l of status) console.log(`   ${l}`);
} else console.log('Không có thay đổi chưa commit — chỉ nâng version cho các commit đã có.');
if (dry) console.log('\n(--dry-run: chỉ in các bước)');
if (rl && !yes && !dry) {
  const ok = (await rl.question('\nTiếp tục? [Y/n] ')).trim().toLowerCase();
  if (ok && ok !== 'y' && ok !== 'yes' && ok !== 'c' && ok !== 'co') fail('Đã hủy.');
}
rl?.close();

// Máy chưa cài thư viện (mới clone / mới pull) → cài đúng theo package-lock trước khi test.
const binDir = path.resolve('node_modules', '.bin');
if (!skipTests && !fs.existsSync(path.join(binDir, process.platform === 'win32' ? 'tsc.cmd' : 'tsc'))) {
  console.log('\nChưa cài thư viện (node_modules) — đang cài, lần đầu mất vài phút…');
  run('npm ci');
}
if (!skipTests) {
  run('npm run typecheck');
  run('npm test');
}
if (status.length) {
  run('git add -A');
  if (!dry) {
    // Không bao giờ commit file ghi chú phát hành.
    spawnSync('git', ['reset', '-q', '--', '.release-msg.txt'], { stdio: 'ignore' });
    const msgPath = path.resolve('.git', 'RELEASE_COMMIT_MSG');
    fs.writeFileSync(msgPath, body ? `${message}\n\n${body}\n` : `${message}\n`, 'utf8');
    run(`git commit -F "${msgPath}"`);
    fs.rmSync(msgPath, { force: true });
  } else console.log(`\n> git commit -m "${message}"`);
}
run(`npm version ${bump}`);
run('git push --follow-tags origin main');

if (!dry) {
  fs.rmSync(MSG_FILE, { force: true });
  let repo = '';
  try {
    repo = out('git remote get-url origin').replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/');
  } catch {}
  console.log(`\n✔ Đã đẩy v${next} lên GitHub. GitHub Actions đang test, build và đăng Release (~5–10 phút).`);
  if (repo) console.log(`  Theo dõi: ${repo}/actions\n  Release:  ${repo}/releases`);
}
