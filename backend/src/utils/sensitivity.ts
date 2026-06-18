const SENSITIVE_KEYWORDS = [
  'đơn hàng',
  'mã đơn',
  'khách hàng',
  'số điện thoại',
  'địa chỉ',
  'doanh thu',
  'báo cáo',
  'tồn kho',
  'số lượng còn',
  'nhân viên',
  'lương',
  'nội bộ',
  'api key',
  'database',
  'cơ sở dữ liệu',
];

export function isSensitiveQuestion(message: string): boolean {
  const normalized = message.toLowerCase();
  return SENSITIVE_KEYWORDS.some((keyword) => normalized.includes(keyword));
}
