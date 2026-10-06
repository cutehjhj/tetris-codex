"use strict";

// 보드의 크기는 가로 10칸, 세로 20칸입니다.
// 게임 좌표는 픽셀이 아니라 칸 단위를 사용합니다.
const BOARD_WIDTH = 10;
const BOARD_HEIGHT = 20;

// null은 빈 칸을 뜻합니다. 이후 고정 블록의 색상을 저장할 수 있습니다.
// 각 행을 따로 생성하여 한 행의 수정이 다른 행에 영향을 주지 않게 합니다.
const board = Array.from(
  { length: BOARD_HEIGHT },
  () => Array(BOARD_WIDTH).fill(null)
);

// 1은 블록이 차지하는 칸, 0은 모양 안의 빈 칸입니다.
// 모양 데이터와 색상을 한곳에서 관리하고, 활성 블록에는 모양을 복사합니다.
const TETROMINOES = {
  I: {
    shape: [[1, 1, 1, 1]],
    color: "#22d3ee"
  },
  O: {
    shape: [
      [1, 1],
      [1, 1]
    ],
    color: "#facc15"
  },
  T: {
    shape: [
      [0, 1, 0],
      [1, 1, 1]
    ],
    color: "#a855f7"
  },
  S: {
    shape: [
      [0, 1, 1],
      [1, 1, 0]
    ],
    color: "#4ade80"
  },
  Z: {
    shape: [
      [1, 1, 0],
      [0, 1, 1]
    ],
    color: "#f87171"
  },
  J: {
    shape: [
      [1, 0, 0],
      [1, 1, 1]
    ],
    color: "#60a5fa"
  },
  L: {
    shape: [
      [0, 0, 1],
      [1, 1, 1]
    ],
    color: "#fb923c"
  }
};

// 지정한 종류 또는 무작위 종류의 블록을 상단 중앙에 생성합니다.
// 모양은 복사하여 각 블록과 원본 정의가 서로 영향을 주지 않게 합니다.
function createPiece(type) {
  const types = Object.keys(TETROMINOES);
  const selectedType = type ?? types[Math.floor(Math.random() * types.length)];
  const definition = TETROMINOES[selectedType];

  return {
    type: selectedType,
    shape: definition.shape.map((row) => row.slice()),
    color: definition.color,
    x: Math.floor((BOARD_WIDTH - definition.shape[0].length) / 2),
    y: 0
  };
}

// 1,000점마다 레벨을 올리고 간격을 40ms 줄입니다. 최소 간격은 100ms입니다.
const BASE_DROP_INTERVAL_MS = 500;
const MIN_DROP_INTERVAL_MS = 100;
const DROP_SPEED_STEP_MS = 40;
const POINTS_PER_LEVEL = 1000;

// 한 번의 고정으로 지운 줄 수에 따라 점수를 더합니다.
// 줄이 지워지지 않으면 0점이며, 낙하 자체에는 추가 점수가 없습니다.
const LINE_SCORES = [0, 100, 300, 500, 800];
let score = 0;
let level = 1;
let dropIntervalMs = BASE_DROP_INTERVAL_MS;
let currentPiece = null;
let nextPiece = null;
let isGameOver = false;

// 재시작 시 기존 타이머를 해제하여 중복 실행을 방지합니다.
let dropTimer = null;

// index.html의 defer 속성 덕분에 캔버스가 생성된 뒤 이 코드가 실행됩니다.
const canvas = document.getElementById("game-board");
const context = canvas.getContext("2d");
const scoreElement = document.getElementById("score");
const levelElement = document.getElementById("level");
const nextCanvas = document.getElementById("next-board");
const nextContext = nextCanvas.getContext("2d");
const gameOverElement = document.getElementById("game-over");
const restartButton = document.getElementById("restart-button");

// 캔버스 내부 크기에서 한 칸의 픽셀 크기를 계산합니다.
// 현재 300 × 600 캔버스에서는 한 칸이 30 × 30 픽셀입니다.
const CELL_WIDTH = canvas.width / BOARD_WIDTH;
const CELL_HEIGHT = canvas.height / BOARD_HEIGHT;

// 칸 좌표를 픽셀 좌표로 변환하여 색칠하는 공통 함수입니다.
function drawCell(column, row, color) {
  context.fillStyle = color;
  context.fillRect(
    column * CELL_WIDTH,
    row * CELL_HEIGHT,
    CELL_WIDTH,
    CELL_HEIGHT
  );
}

// 현재 보드와 활성 블록을 표시합니다.
// 상태를 읽어서 그리기만 하며, 좌표나 보드 데이터는 변경하지 않습니다.
function draw() {
  // 매번 배경을 새로 칠하면 다시 그릴 때 이전 화면의 잔상이 남지 않습니다.
  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);

  // 빈 칸은 배경을 유지하고, 색상이 저장된 칸만 그립니다.
  for (let row = 0; row < BOARD_HEIGHT; row += 1) {
    for (let column = 0; column < BOARD_WIDTH; column += 1) {
      if (board[row][column] !== null) {
        drawCell(column, row, board[row][column]);
      }
    }
  }

  // 모양의 1인 칸에 블록 위치를 더하여 보드 위의 실제 위치를 구합니다.
  // 생성 위치가 막혀 종료된 경우 활성 블록은 없고 고정 보드만 표시합니다.
  if (currentPiece !== null) {
    for (let row = 0; row < currentPiece.shape.length; row += 1) {
      for (let column = 0; column < currentPiece.shape[row].length; column += 1) {
        if (currentPiece.shape[row][column] === 1) {
          drawCell(
            currentPiece.x + column,
            currentPiece.y + row,
            currentPiece.color
          );
        }
      }
    }
  }

  // 블록을 그린 뒤 격자선을 덧그려 블록 위에서도 칸 구분이 보이게 합니다.
  context.beginPath();
  context.strokeStyle = "#303030";
  context.lineWidth = 1;

  for (let column = 0; column <= BOARD_WIDTH; column += 1) {
    // 내부 선은 반 픽셀 위치에 맞춰 1픽셀 선이 선명하게 보이도록 합니다.
    const x = column === BOARD_WIDTH
      ? canvas.width - 0.5
      : column * CELL_WIDTH + 0.5;
    context.moveTo(x, 0);
    context.lineTo(x, canvas.height);
  }

  for (let row = 0; row <= BOARD_HEIGHT; row += 1) {
    const y = row === BOARD_HEIGHT
      ? canvas.height - 0.5
      : row * CELL_HEIGHT + 0.5;
    context.moveTo(0, y);
    context.lineTo(canvas.width, y);
  }

  context.stroke();

  // 보드와 점수 표시를 같은 화면 갱신에서 처리하여 최신 점수가 보이게 합니다.
  // textContent는 텍스트만 갱신하며 새로운 DOM 요소를 만들지 않습니다.
  scoreElement.textContent = String(score);
  levelElement.textContent = String(level);
  drawNextPiece();
  // 종료 안내는 게임 상태를 읽어서 표시하며 정상 진행 중에는 숨깁니다.
  gameOverElement.hidden = !isGameOver;
}

// 현재 위치와 이동량을 받아 후보 위치의 충돌을 상태 변경 없이 판정합니다.
// 모양의 0은 빈 칸이므로 1인 셀만 벽·바닥·고정 셀과 비교합니다.
function hasCollision(grid, piece, offsetX = 0, offsetY = 0) {
  for (let row = 0; row < piece.shape.length; row += 1) {
    for (let column = 0; column < piece.shape[row].length; column += 1) {
      if (piece.shape[row][column] !== 1) {
        continue;
      }

      const x = piece.x + column + offsetX;
      const y = piece.y + row + offsetY;

      // 먼저 경계를 확인하여 보드 밖의 배열에 접근하지 않습니다.
      if (x < 0 || x >= BOARD_WIDTH || y < 0 || y >= BOARD_HEIGHT) {
        return true;
      }

      if (grid[y][x] !== null) {
        return true;
      }
    }
  }

  return false;
}

// 유효한 현재 위치의 네 칸을 고정 보드에 저장합니다.
// 고정 후에는 활성 블록이 바뀌어도 이 색상이 보드에 남습니다.
function lockPiece(grid, piece) {
  for (let row = 0; row < piece.shape.length; row += 1) {
    for (let column = 0; column < piece.shape[row].length; column += 1) {
      if (piece.shape[row][column] === 1) {
        grid[piece.y + row][piece.x + column] = piece.color;
      }
    }
  }
}

// 미리보기는 보드 좌표와 관계없이 모양을 작은 캔버스 중앙에 배치합니다.
function drawNextPiece() {
  nextContext.fillStyle = "#000";
  nextContext.fillRect(0, 0, nextCanvas.width, nextCanvas.height);

  if (nextPiece === null) {
    return;
  }

  const cellSize = Math.min(
    24,
    nextCanvas.width / (nextPiece.shape[0].length + 1),
    nextCanvas.height / (nextPiece.shape.length + 1)
  );
  const offsetX = (nextCanvas.width - nextPiece.shape[0].length * cellSize) / 2;
  const offsetY = (nextCanvas.height - nextPiece.shape.length * cellSize) / 2;

  nextContext.fillStyle = nextPiece.color;
  for (let row = 0; row < nextPiece.shape.length; row += 1) {
    for (let column = 0; column < nextPiece.shape[row].length; column += 1) {
      if (nextPiece.shape[row][column] === 1) {
        // 1px 여백으로 미리보기에서도 각 칸을 구분합니다.
        nextContext.fillRect(
          offsetX + column * cellSize + 1,
          offsetY + row * cellSize + 1,
          cellSize - 2,
          cellSize - 2
        );
      }
    }
  }
}

// 점수에서 레벨과 하강 간격을 계산합니다. 타이머는 속도가 바뀔 때만 교체합니다.
function updateLevelAndSpeed() {
  level = Math.floor(score / POINTS_PER_LEVEL) + 1;
  const newInterval = Math.max(
    MIN_DROP_INTERVAL_MS,
    BASE_DROP_INTERVAL_MS - (level - 1) * DROP_SPEED_STEP_MS
  );

  if (newInterval !== dropIntervalMs) {
    dropIntervalMs = newInterval;
    if (dropTimer !== null) {
      clearInterval(dropTimer);
      dropTimer = setInterval(stepDown, dropIntervalMs);
    }
  }
}

// 완성되지 않은 행을 원래 순서대로 남겨 모든 완성 행을 한 번에 제거합니다.
// 아래에서 순회하며 한 행씩 삭제하는 방식과 달리 인접한 완성 행도 놓치지 않습니다.
function clearCompletedLines(grid) {
  const remainingRows = grid.filter((row) => row.some((cell) => cell === null));
  const clearedLines = grid.length - remainingRows.length;

  if (clearedLines === 0) {
    return 0;
  }

  // 삭제된 줄 수만큼 상단에 빈 행을 보충합니다.
  // 각 빈 행은 독립된 배열이며, 남은 행은 삭제된 아래 행 수만큼 내려갑니다.
  const emptyRows = Array.from(
    { length: clearedLines },
    () => Array(BOARD_WIDTH).fill(null)
  );

  // 보드 배열 자체는 유지하여 기존 참조를 사용하는 렌더러도 새 내용을 읽습니다.
  grid.splice(0, grid.length, ...emptyRows, ...remainingRows);
  return clearedLines;
}

// 자동 하강, Soft Drop, Hard Drop 모두 같은 고정·생성 처리를 사용합니다.
function lockAndSpawn() {
  lockPiece(board, currentPiece);

  // 고정 → 줄 제거 → 점수 누적 → 새 블록 생성 순서를 지킵니다.
  // 한 블록은 네 칸이므로 한 번에 완성 가능한 줄은 최대 네 줄입니다.
  const clearedLines = clearCompletedLines(board);
  score += LINE_SCORES[clearedLines];
  updateLevelAndSpeed();

  // 미리 보였던 블록을 그대로 등장시킵니다. 생성 성공 후에만 미리보기를 교체합니다.

  // 생성 위치가 막히면 기존 보드를 덮어쓰지 않고 타이머를 중단합니다.
  // 이후 draw() 호출에서 종료 안내를 표시합니다.
  if (hasCollision(board, nextPiece)) {
    currentPiece = null;
    isGameOver = true;
    clearInterval(dropTimer);
    dropTimer = null;
  } else {
    currentPiece = nextPiece;
    nextPiece = createPiece();
  }
}

// 한 번의 하강 처리: 이동 가능하면 한 칸, 막혔으면 고정 후 새 블록 생성.
// 아래 방향키도 이 함수를 호출하므로 자동 하강을 기다리지 않고 내려갑니다.
function stepDown() {
  if (isGameOver) {
    return;
  }

  if (!hasCollision(board, currentPiece, 0, 1)) {
    currentPiece.y += 1;
  } else {
    lockAndSpawn();
  }

  draw();
}

// 좌우 한 칸 이동도 후보 위치가 유효한 경우에만 적용합니다.
function movePiece(direction) {
  if (isGameOver) {
    return;
  }

  if (!hasCollision(board, currentPiece, direction, 0)) {
    currentPiece.x += direction;
    draw();
  }
}

// 직사각형 모양에도 적용되는 시계 방향 회전입니다.
// 새 모양을 만들기만 하고 원본은 변경하지 않으므로 실패 시 취소가 쉽습니다.
function rotateClockwise(shape) {
  const height = shape.length;
  const width = shape[0].length;

  return Array.from({ length: width }, (_, row) =>
    Array.from({ length: height }, (_, column) =>
      shape[height - 1 - column][row]
    )
  );
}

function rotatePiece() {
  if (isGameOver) {
    return;
  }

  const rotatedShape = rotateClockwise(currentPiece.shape);
  const candidate = { ...currentPiece, shape: rotatedShape };

  // 벽이나 고정 블록에 걸리면 모양과 위치를 그대로 유지합니다.
  // 별도의 벽 보정 이동은 하지 않습니다.
  if (!hasCollision(board, candidate)) {
    currentPiece.shape = rotatedShape;
    draw();
  }
}

// 내려갈 수 있는 마지막 칸을 찾은 뒤 즉시 고정하고 다음 블록을 생성합니다.
// 충돌하지 않는 한 칸씩만 이동하여 고정 블록을 관통하지 않습니다.
function hardDrop() {
  if (isGameOver) {
    return;
  }

  while (!hasCollision(board, currentPiece, 0, 1)) {
    currentPiece.y += 1;
  }

  lockAndSpawn();
  draw();
}

// 게임 키의 기본 스크롤 동작을 막고 각 조작 함수로 연결합니다.
// 방향키는 누르고 있으면 브라우저의 반복 입력으로 계속 조작할 수 있습니다.
function handleKeyDown(event) {
  // 버튼의 기본 키보드 조작을 유지하고 Space 클릭과 Hard Drop의 중복을 막습니다.
  if (event.target?.closest?.("button, input, textarea, select, [contenteditable='true']")) {
    return;
  }

  const key = event.code === "Space" ? " " : event.key;
  if (!["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", " "].includes(key)) {
    return;
  }

  event.preventDefault();

  // 종료 후에는 입력이 게임 상태를 변경하지 않습니다.
  // 스페이스를 길게 눌러 새 블록까지 연속 고정되는 것도 방지합니다.
  if (isGameOver || (key === " " && event.repeat)) {
    return;
  }

  switch (key) {
    case "ArrowLeft":
      movePiece(-1);
      break;
    case "ArrowRight":
      movePiece(1);
      break;
    case "ArrowDown":
      stepDown();
      break;
    case "ArrowUp":
      rotatePiece();
      break;
    case " ":
      hardDrop();
      break;
  }
}

document.addEventListener("keydown", handleKeyDown);

// 진행 중과 종료 후 모두 새 게임을 시작할 수 있습니다.
function restartGame() {
  // 이전 타이머부터 해제하여 반복 클릭해도 낙하 주기가 중복되지 않게 합니다.
  if (dropTimer !== null) {
    clearInterval(dropTimer);
    dropTimer = null;
  }

  // 보드 참조는 유지하고 각 행을 새 배열로 만들어 이전 게임 데이터를 제거합니다.
  board.splice(
    0,
    board.length,
    ...Array.from({ length: BOARD_HEIGHT }, () => Array(BOARD_WIDTH).fill(null))
  );
  score = 0;
  level = 1;
  dropIntervalMs = BASE_DROP_INTERVAL_MS;
  isGameOver = false;
  currentPiece = createPiece();
  nextPiece = createPiece();
  draw();

  // 재시작 후 첫 하강까지 온전한 0.5초를 기다립니다.
  dropTimer = setInterval(stepDown, dropIntervalMs);
}

// 핸들러는 한 번만 등록하고 재시작 시에는 상태와 타이머만 초기화합니다.
restartButton.addEventListener("click", () => {
  restartGame();
  // 버튼에 남은 포커스가 게임 입력을 막지 않도록 보드로 이동합니다.
  // 키보드로 버튼을 누른 경우에도 즉시 방향키와 Space로 플레이할 수 있습니다.
  canvas.focus({ preventScroll: true });
});
restartGame();
