const questions = [
  'FanMe hiện có những phòng ban nào?',
  'Quy trình phê duyệt sản phẩm là gì?',
  'Chính sách nghỉ phép như thế nào?',
  'File dữ liệu KPI ở đâu?',
  'Ai là người quản lý bộ phận A?',
];

export function SuggestedQuestions({ onSelect }: { onSelect: (question: string) => void }) {
  return (
    <section className="suggestions">
      <div>
        <h3>Gợi ý câu hỏi</h3>
        <p>Chọn nhanh một câu hỏi để bắt đầu tra cứu</p>
      </div>
      <div className="suggestion-list">
        {questions.map((question) => (
          <button key={question} type="button" onClick={() => onSelect(question)}>
            {question}
          </button>
        ))}
      </div>
    </section>
  );
}
