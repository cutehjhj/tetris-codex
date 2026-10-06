// 실제 index.html을 브라우저에서 열어 키 입력과 화면 상태를 검증합니다.
// 실행: Playwright가 설치된 환경에서 node tests/playtest.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

async function verifyBrowser(channel) {
  const browser = await chromium.launch({ channel, headless: true });
  const page = await browser.newPage();
  const failures = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  try {
    // 시간을 멈춰 입력 테스트 중 자동 하강이 끼어들지 않게 하고,
    // 자동 하강 검증에서는 브라우저 시간을 정확히 전진시킵니다.
    await page.clock.install({ time: new Date('2026-10-06T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-10-06T00:00:01Z'));
    await page.addInitScript(() => {
      const nativeSetInterval = window.setInterval.bind(window);
      const nativeClearInterval = window.clearInterval.bind(window);
      window.activeGameTimers = new Set();
      window.setInterval = (...args) => {
        const id = nativeSetInterval(...args);
        window.activeGameTimers.add(id);
        return id;
      };
      window.clearInterval = (id) => {
        window.activeGameTimers.delete(id);
        nativeClearInterval(id);
      };
    });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);

    async function test(name, action) {
      try {
        await page.evaluate(() => restartGame());
        await action();
        console.log(`PASS [${channel}] ${name}`);
      } catch (error) {
        failures.push(`${name}: ${error.message}`);
        console.log(`FAIL [${channel}] ${name}: ${error.message}`);
      }
    }

    await test('7종 블록이 무작위 선택 경로와 Next를 거쳐 실제 등장', async () => {
      await page.evaluate(() => {
        window.savedRandom = Math.random;
        let index = 0;
        Math.random = () => ((index++ % 7) + 0.5) / 7;
        restartGame();
      });
      try {
        for (const type of ['I', 'O', 'T', 'S', 'Z', 'J', 'L']) {
          assert.equal(await page.evaluate(() => currentPiece.type), type);
          assert.equal(await page.evaluate(() => currentPiece.shape.flat().filter(Boolean).length), 4);
          await page.evaluate(() => board.forEach((row) => row.fill(null)));
          await page.keyboard.press('Space');
        }
      } finally {
        await page.evaluate(() => { Math.random = window.savedRandom; });
      }
    });

    await test('좌우 입력, 회전, Soft/Hard Drop, 자동 하강 및 충돌 취소', async () => {
      await page.evaluate(() => { currentPiece = createPiece('T'); draw(); });
      const x = await page.evaluate(() => currentPiece.x);
      await page.keyboard.press('ArrowLeft');
      assert.equal(await page.evaluate(() => currentPiece.x), x - 1);
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.evaluate(() => currentPiece.x), x);
      await page.keyboard.press('ArrowUp');
      assert.equal(await page.evaluate(() => JSON.stringify(currentPiece.shape)), '[[1,0],[1,1],[1,0]]');
      await page.keyboard.press('ArrowDown');
      assert.equal(await page.evaluate(() => currentPiece.y), 1);
      await page.clock.runFor(499);
      assert.equal(await page.evaluate(() => currentPiece.y), 1);
      await page.clock.runFor(1);
      assert.equal(await page.evaluate(() => currentPiece.y), 2);
      await page.evaluate(() => {
        currentPiece = createPiece('I');
        currentPiece.shape = rotateClockwise(currentPiece.shape);
        currentPiece.x = 9;
        draw();
      });
      const before = await page.evaluate(() => JSON.stringify(currentPiece));
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowUp');
      assert.equal(await page.evaluate(() => JSON.stringify(currentPiece)), before);
      await page.evaluate(() => {
        currentPiece = createPiece('T');
        board[0][currentPiece.x] = '#fixed';
      });
      const blocked = await page.evaluate(() => JSON.stringify(currentPiece));
      await page.keyboard.press('ArrowUp');
      assert.equal(await page.evaluate(() => JSON.stringify(currentPiece)), blocked);
      await page.evaluate(() => { board.forEach((row) => row.fill(null)); currentPiece = createPiece('O'); });
      await page.keyboard.press('Space');
      assert.equal(await page.evaluate(() => board[19][4]), '#facc15');
      assert.equal(await page.evaluate(() => currentPiece.y), 0);
    });

    async function prepareLines(count) {
      await page.evaluate((n) => {
        board.forEach((row) => row.fill(null));
        for (let y = 20 - n; y < 20; y += 1) {
          board[y].fill('#fixed');
          board[y][4] = null;
        }
        board[10][0] = '#marker';
        currentPiece = createPiece('I');
        currentPiece.shape = rotateClockwise(currentPiece.shape);
        currentPiece.x = 4;
        draw();
      }, count);
    }

    await test('1/2/3줄 동시 삭제, 위 블록 이동, 점수 누적과 화면 갱신', async () => {
      let total = 0;
      for (const [count, points] of [[1, 100], [2, 300], [3, 500]]) {
        await prepareLines(count);
        await page.keyboard.press('Space');
        total += points;
        assert.equal(await page.locator('#score').textContent(), String(total));
        assert.equal(await page.evaluate(() => score), total);
        assert.equal(await page.evaluate((n) => board[10 + n][0], count), '#marker');
        assert.equal(await page.evaluate(() => board.length), 20);
        assert.equal(await page.evaluate(() => board.some((row) => row.every((cell) => cell !== null))), false);
      }
    });

    await test('4줄 동시 삭제는 정확히 800점', async () => {
      await prepareLines(4);
      await page.keyboard.press('Space');
      assert.equal(await page.locator('#score').textContent(), '800');
      assert.equal(await page.evaluate(() => score), 800);
      assert.equal(await page.evaluate(() => board[14][0]), '#marker');
    });

    await test('게임오버 중단 및 버튼 재시작 후 초기화·키 입력·단일 타이머', async () => {
      await prepareLines(4);
      await page.keyboard.press('Space');
      await page.evaluate(() => {
        board.forEach((row) => row.fill(null));
        board[0].fill('#blocked');
        board[0][0] = null;
        currentPiece = createPiece('O');
        currentPiece.y = 18;
        draw();
      });
      await page.keyboard.press('Space');
      assert.equal(await page.locator('#game-over').isVisible(), true);
      assert.equal(await page.evaluate(() => activeGameTimers.size), 0);
      const stopped = await page.evaluate(() => JSON.stringify(board));
      await page.clock.runFor(1500);
      await page.keyboard.press('ArrowDown');
      assert.equal(await page.evaluate(() => JSON.stringify(board)), stopped);
      await page.locator('#restart-button').click();
      assert.equal(await page.locator('#game-over').isVisible(), false);
      assert.equal(await page.locator('#score').textContent(), '0');
      assert.equal(await page.locator('#level').textContent(), '1');
      assert.equal(await page.evaluate(() => board.every((row) => row.every((cell) => cell === null))), true);
      assert.equal(await page.evaluate(() => activeGameTimers.size), 1);
      const x = await page.evaluate(() => currentPiece.x);
      await page.keyboard.press('ArrowLeft');
      assert.equal(await page.evaluate(() => currentPiece.x), x - 1);
      for (let i = 0; i < 5; i += 1) await page.locator('#restart-button').click();
      assert.equal(await page.evaluate(() => activeGameTimers.size), 1);
      await page.clock.runFor(500);
      assert.equal(await page.evaluate(() => currentPiece.y), 1);
    });

    assert.deepEqual(errors, [], '브라우저 실행 오류');
    if (failures.length) throw new Error(failures.join('\n'));
  } finally {
    await browser.close();
  }
}

(async () => {
  let failed = false;
  for (const channel of ['chrome', 'msedge']) {
    try { await verifyBrowser(channel); }
    catch (error) { failed = true; console.error(error.message); }
  }
  process.exitCode = failed ? 1 : 0;
})();
