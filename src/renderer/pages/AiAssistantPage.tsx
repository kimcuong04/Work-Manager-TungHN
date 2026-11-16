import { MessageSquareText, ShieldCheck, Sparkles } from 'lucide-react';
import { usePageTitle } from '../state/ui';

export function AiAssistantPage() {
  usePageTitle('AI Assistant');
  return (
    <div className="coming-soon">
      <div className="card card-pad stack" style={{ alignItems: 'center' }}>
        <Sparkles size={42} style={{ color: 'var(--accent)' }} />
        <h1 style={{ margin: 0 }}>AI Assistant</h1>
        <span className="soon-badge" style={{ fontSize: 12 }}>
          Coming Soon · Phase 2
        </span>
        <p className="muted" style={{ maxWidth: 520 }}>
          Trợ lý AI sẽ đọc nội dung trao đổi từ các nguồn bạn chủ động chọn (Zalo, Telegram, Viber… qua API/connector hợp lệ), đề xuất bản nháp Project
          kèm đoạn trích làm căn cứ. Bạn kiểm tra, chỉnh sửa và xác nhận trước khi lưu.
        </p>
        <div className="stack" style={{ textAlign: 'left', width: '100%', maxWidth: 520, gap: 10 }}>
          <div className="row small">
            <MessageSquareText size={16} /> Chọn nguồn hội thoại và khoảng thời gian cần đọc
          </div>
          <div className="row small">
            <Sparkles size={16} /> AI trích xuất tên dự án, CĐT, deadline, Priority đề xuất
          </div>
          <div className="row small">
            <ShieldCheck size={16} /> AI chỉ tạo bản nháp — không ghi trực tiếp khi chưa có xác nhận của bạn
          </div>
        </div>
        <p className="faint small">Phase 1 không gửi bất kỳ dữ liệu nào ra khỏi máy tính.</p>
      </div>
    </div>
  );
}
