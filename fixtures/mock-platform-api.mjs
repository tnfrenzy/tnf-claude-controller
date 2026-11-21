// Mock of the Platform's read-only monitoring API (docs/API-NHAN-VIEN-AO.md) for demos and manual checks.
// Usage: node fixtures/mock-platform-api.mjs [port]   (token: demo-token). Numbers shift over time so the office moves.
import http from "node:http";

const PORT = Number(process.argv[2]) || 4802;
const TOKEN = "demo-token";
const base = [
  ["bao-gia", "Báo Giá", "sales"],
  ["ban-ve", "Bản vẽ", "sales"],
  ["hop-dong", "Hợp Đồng", "sales", false],
  ["chung-thu", "Chứng Thư", "acc"],
  ["de-nghi-chung-thu", "Đề nghị chứng thư", "acc"],
  ["xuat-amis", "Xuất AMIS", "acc", false],
  ["ban-ve-thang", "Bản vẽ thang", "eng"],
  ["bom", "BOM", "eng", false],
  ["hsll", "Hồ sơ lý lịch thang", "eng"],
];

function snapshot() {
  const tick = Math.floor(Date.now() / 6000);
  const employees = base.map(([id, name, department, known = true], i) => {
    const phase = (tick + i) % 6;
    if (!known) return { id, name, department, queueKnown: false, paused: false };
    return {
      id,
      name,
      department,
      paused: id === "de-nghi-chung-thu",
      queueKnown: true,
      counts: { pending: phase === 2 ? 2 : 0, processing: phase < 2 ? 1 : 0, failed: id === "ban-ve-thang" ? 1 : 0, done: 5 + i },
      waitingLock: phase === 2,
      lastFinishedAt: new Date(Date.now() - 60_000 * (i + 1)).toISOString(),
      avgSeconds: 150 + i * 20,
      failedRate: id === "ban-ve-thang" ? 0.1 : 0,
    };
  });
  return { generatedAt: new Date().toISOString(), employees };
}

http
  .createServer((req, res) => {
    if (req.method !== "GET") {
      res.writeHead(405).end();
      return;
    }
    if (req.url !== "/api/monitor/nhan-vien-ao") {
      res.writeHead(404).end();
      return;
    }
    if (req.headers.authorization !== "Bearer " + TOKEN) {
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "token" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(snapshot()));
  })
  .listen(PORT, "127.0.0.1", () => console.log("Mock Platform API: http://127.0.0.1:" + PORT));
