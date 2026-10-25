const net = require("net");
const WebSocket = require("ws");

// ========================================
// 설정: 로봇 3대 IP (당일 시리얼 모니터에 뜬 IP로 교체)
// ========================================
const ROBOTS = [
  { id: "01", ip: "192.168.0.101" },
  { id: "02", ip: "192.168.0.102" },
  { id: "03", ip: "192.168.0.103" },
];
const ESP32_PORT = 4000;
const WS_PORT = 8080;
const RECONNECT_DELAY = 3000;

// ========================================
// 1. React ↔ Bridge (WebSocket)
// ========================================
const wss = new WebSocket.Server({ port: WS_PORT });
const sockets = {}; // robotId -> 연결된 로봇 소켓

function broadcast(data) {
  const message = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  });
}

wss.on("connection", (ws) => {
  console.log("React 앱이 연결되었습니다.");
  ws.send(JSON.stringify({ type: "bridge", status: "connected" }));

  ws.on("message", (message) => {
    const text = message.toString();
    let robotId = null;
    let command = text;

    // {"robotId":"01","command":"forward"} 형태면 해당 로봇에만, 아니면 전체에 전달
    try {
      const obj = JSON.parse(text);
      robotId = obj.robotId;
      command = obj.command;
    } catch (e) {}

    const targets = robotId ? [sockets[robotId]] : Object.values(sockets);
    targets.forEach((s) => {
      if (s && !s.destroyed) {
        s.write(command + "\n");
        console.log(`Bridge → ESP32(${robotId || "ALL"}):`, command);
      }
    });
  });

  ws.on("close", () => console.log("React 연결이 종료되었습니다."));
});

console.log(`WebSocket 서버 실행 중: 포트 ${WS_PORT}`);

// ========================================
// 2. Bridge → 로봇 (TCP), 로봇마다 하나씩
// ========================================
function connectRobot(robot) {
  const socket = new net.Socket();
  let buffer = "";
  let wasConnected = false;

  console.log(`[${robot.id}] 연결 시도: ${robot.ip}:${ESP32_PORT}`);

  socket.connect(ESP32_PORT, robot.ip, () => {
    console.log(`[${robot.id}] 연결되었습니다!`);
    sockets[robot.id] = socket;
    wasConnected = true;
    broadcast({ type: "esp32", robotId: robot.id, status: "connected" });
  });

  socket.on("data", (data) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop(); // 아직 덜 온 마지막 줄은 보관

    lines.forEach((line) => {
      const msg = line.trim();
      if (!msg) return;
      console.log(`[${robot.id}] →`, msg);
      broadcast({ type: "robot", data: msg });
    });
  });

  socket.on("error", (err) => {
    console.log(`[${robot.id}] 오류: ${err.message}`);
  });

  socket.on("close", () => {
    if (sockets[robot.id] === socket) delete sockets[robot.id];

    // 실제로 연결돼 있다가 끊긴 경우에만 앱에 알림 (재시도 실패는 조용히)
    if (wasConnected) {
      console.log(`[${robot.id}] 연결이 종료되었습니다.`);
      broadcast({ type: "esp32", robotId: robot.id, status: "disconnected" });
    }
    setTimeout(() => connectRobot(robot), RECONNECT_DELAY);
  });
}

ROBOTS.forEach(connectRobot);