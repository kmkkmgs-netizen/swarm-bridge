const net = require("net");
const WebSocket = require("ws");

// ========================================
// 설정
// ========================================

// 나중에 규원님이 알려주는 ESP32 IP 주소를 여기에 입력
const ESP32_IP = "192.168.219.189";
const ESP32_PORT = 4000;

const WS_PORT = 8080;

const RECONNECT_DELAY = 3000; // 재연결 시도 간격 (3초)

// ========================================
// 1. React ↔ Bridge WebSocket 서버
// ========================================

const wss = new WebSocket.Server({ port: WS_PORT });

let esp32Socket = null;

wss.on("connection", (ws) => {
  console.log("React 앱이 연결되었습니다.");

  ws.send(
    JSON.stringify({
      type: "bridge",
      status: "connected",
    })
  );

  ws.on("message", (message) => {
    const command = message.toString();

    console.log("React → Bridge:", command);

    // ESP32가 연결되어 있으면 명령 전달
    if (esp32Socket && !esp32Socket.destroyed) {
      esp32Socket.write(command + "\n");
      console.log("Bridge → ESP32:", command);
    } else {
      console.log("ESP32가 아직 연결되지 않았습니다.");
    }
  });

  ws.on("close", () => {
    console.log("React 연결이 종료되었습니다.");
  });
});

console.log(`WebSocket 서버 실행 중: 포트 ${WS_PORT}`);

// ========================================
// 2. Bridge → ESP32 TCP 연결
// ========================================

function connectToESP32() {
  console.log(`ESP32 연결 시도: ${ESP32_IP}:${ESP32_PORT}`);

  const socket = new net.Socket();

  socket.connect(ESP32_PORT, ESP32_IP, () => {
    console.log("ESP32에 연결되었습니다!");
    esp32Socket = socket;

    broadcast({
      type: "esp32",
      status: "connected",
    });
  });

  socket.on("data", (data) => {
    const message = data.toString().trim();

    console.log("ESP32 → Bridge:", message);

    // ESP32에서 받은 데이터를 React에 전달
    broadcast({
      type: "robot",
      data: message,
    });
  });

  socket.on("close", () => {
    console.log("ESP32 연결이 종료되었습니다.");

    if (esp32Socket === socket) {
      esp32Socket = null;
    }

    broadcast({
      type: "esp32",
      status: "disconnected",
    });

    // 재연결 시도
    console.log(`${RECONNECT_DELAY / 1000}초 후 재연결을 시도합니다...`);
    setTimeout(connectToESP32, RECONNECT_DELAY);
  });

  socket.on("error", (err) => {
    console.log("ESP32 연결 오류:", err.message);

    if (esp32Socket === socket) {
      esp32Socket = null;
    }
  });
}

// ========================================
// 3. React 전체에 데이터 전달
// ========================================

function broadcast(data) {
  const message = JSON.stringify(data);

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// ========================================
// 4. ESP32 연결 시작
// ========================================

connectToESP32();