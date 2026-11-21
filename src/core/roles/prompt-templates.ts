/** Built-in prompt templates seeded into the library once. Slots use {{name}} (letters, digits, underscore). */
export interface PromptTemplate {
  id: string;
  name: string;
  content: string;
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: "tpl-fix-bug",
    name: "Sửa lỗi",
    content:
      "Sửa lỗi sau trong dự án: {{mô_tả_lỗi}}. Tìm nguyên nhân gốc, sửa tối thiểu, thêm hoặc cập nhật test chứng minh lỗi đã hết, rồi commit.",
  },
  {
    id: "tpl-add-test",
    name: "Thêm test",
    content:
      "Viết thêm test cho file {{tên_file}}, tập trung vào {{hành_vi_cần_kiểm}}. Không đổi hành vi của mã nguồn, chạy test và commit.",
  },
  {
    id: "tpl-rename-function",
    name: "Đổi tên hàm",
    content:
      "Đổi tên hàm {{tên_cũ}} thành {{tên_mới}} ở mọi nơi được dùng trong dự án, cập nhật test liên quan, chạy test và commit.",
  },
];
