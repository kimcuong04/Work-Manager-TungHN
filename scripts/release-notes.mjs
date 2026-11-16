// In ra ghi chú phát hành (markdown) cho một tag, hiển thị trong hộp thoại "Có gì mới" của app.
// Ưu tiên nội dung tag có chú thích (git tag -a v1.3.0 -m "..."); nếu tag chỉ có số phiên bản
// (mặc định của `npm version`) thì lấy tiêu đề các commit kể từ tag trước.
import { spawnSync } from 'node:child_process';

const tag = process.argv[2];
if (!tag) {
  console.error('Cách dùng: node scripts/release-notes.mjs v1.2.3');
  process.exit(1);
}

const git = (...args) => {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
};

const version = tag.replace(/^v/, '');
const tagMessage = git('tag', '-l', '--format=%(contents)', tag);
if (tagMessage && tagMessage !== version && tagMessage !== tag) {
  console.log(tagMessage);
  process.exit(0);
}

const prev = git('describe', '--tags', '--abbrev=0', `${tag}^`);
const range = prev ? `${prev}..${tag}` : tag;
const lines = git('log', range, '--no-merges', '--pretty=format:%s')
  .split('\n')
  .map((s) => s.trim())
  .filter((s) => s && !/^v?\d+\.\d+\.\d+(-[\w.]+)?$/.test(s) && !/^(chore|ci|test|build)(\(.+\))?:/i.test(s));

console.log(lines.length ? lines.map((s) => `- ${s}`).join('\n') : '- Cải thiện và sửa lỗi.');
