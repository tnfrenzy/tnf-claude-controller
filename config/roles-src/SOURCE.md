# Nguồn gốc bộ vai lập trình

Các file `.md` trong thư mục này là **bản sao nguyên văn** từ dự án ai-agents
(MIT License, bản quyền (c) 2025 rjmurillo), đường dẫn gốc
`src/claude/agents/{analyst,task-decomposer,critic,implementer,qa,debug,orchestrator}.md`,
lấy từ bản tải về ở `D:\Office TN\ai-agents-main` ngày 2026-10-21.

Controller **không** nạp các file này khi chạy. Chúng chỉ là tài liệu tham khảo;
prompt dùng thật nằm ở `config/roles-coding.json` (mỗi vai ≤ 3 KB, không dùng
Serena/GitHub MCP, một lệnh Bash mỗi lần gọi) và `config/coordinator-coding.md`.

Ý tưởng mượn: thang bằng chứng (analyst), reviewer ngữ cảnh mới và dòng verdict
(critic, qa), task nguyên tử có tiêu chí nghiệm thu (task-decomposer → planner),
bốn pha assess/investigate/resolve/verify (debug), phân loại và ngân sách giao
việc (orchestrator → coordinator). Giấy phép MIT kèm trong `LICENSE`.
