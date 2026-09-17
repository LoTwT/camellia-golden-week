import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

// Synthetic rendering fixtures only. No game save, route, score or completion is fabricated.
const fixture = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>R1 局部渲染夹具</title><body>
<main class="game-shell" data-challenge="antivirus"><header class="hud-top"><button id="menu-button">菜单 Esc</button></header><section class="playfield"><canvas id="game-canvas" tabindex="0"></canvas><div id="tile-labels"></div><section class="antivirus-overlay"><strong class="antivirus-heading">杀毒程序 · 重度</strong><aside class="antivirus-status" data-pressure="high"><div class="antivirus-count"><span>侵蚀数据</span><strong id="count"></strong></div><p>保持 9 个以内，第 10 个出现即失败。</p></aside><div class="antivirus-run"><span id="score"></span><span>局部渲染夹具</span></div><div class="antivirus-legend">蓝色 +1 · 紫色 +2 · 金星清除全部蓝紫数据</div></section></section><footer class="hud-bottom"><div class="controls"><span class="key-hint">WASD / ↑↓←→ 移动</span><button id="fixture-antivirus">杀毒</button><button id="fixture-theft-1">盗取 01</button><button id="fixture-theft-3">盗取 03</button><button id="fixture-theft-power">供电状态</button><button id="fixture-reduced">减少动态与闪烁</button></div></footer></main>
<script type="module">
import '/src/ui/style.css';import '/src/ui/firewall.css';import '/src/ui/r1-challenges.css';
import {BoardRenderer} from '/src/render/board.ts';
import {advanceR1Antivirus,createR1Antivirus} from '/src/core/antivirus.ts';
import virus from '/src/content/challenges/antivirus-r1.json';
import theft from '/src/content/challenges/theft-r1.json';
const canvas=document.querySelector('canvas');const callbacks=[];
const renderer=new BoardRenderer(canvas,document.querySelector('#tile-labels'),tileId=>callbacks.push(tileId));
let settings={muted:true,reducedMotion:false,reducedFlash:false,colorAssist:true,quality:'high',zoom:1};
let board;
async function show(mode) {
document.querySelector('.game-shell').dataset.challenge=mode==='antivirus'?'antivirus':'theft';
document.querySelector('.antivirus-overlay').hidden=mode!=='antivirus';
if(mode==='antivirus') {
 const d=virus.definitions[2];const s=advanceR1Antivirus(d,createR1Antivirus(d),7000).state;
 board={id:d.boardId,local:true,focus:{x:2,y:0},antivirus:{score:s.score,targetScore:d.rules.completionRules.targetScore,activeCount:s.activeTargets.filter(t=>t.kind!=='star').length,maxActiveCorruption:9},tiles:d.tiles.map(tile=>{const t=s.activeTargets.find(t=>t.tileId===tile.id);return {...tile,known:true,visited:true,player:tile.id===s.playerTileId,color:t?.kind==='purple'?'#7966a5':t?.kind==='star'?'#d8c46b':'#333248',icon:t?'target-'+t.kind:null,label:t?.kind??'空格',mark:t?.kind==='purple'?'2':t?.kind==='blue'?'1':''};})};
 document.querySelector('#count').textContent=board.antivirus.activeCount+' / 9';document.querySelector('#score').textContent='清除 0 / 60';
} else {
 const d=theft.definitions[mode==='theft1'?0:2];const power=mode==='theftPower';
 board={id:d.boardId,local:true,focus:{x:3,y:3},theft:{phase:power?'power':'assembly',satisfiedPorts:0,totalPorts:d.powerPortIds.length},tiles:d.tiles.map(tile=>{let icon=tile.terrain==='buffer'?'theft-buffer':null;let label=icon?'缓冲区 · 仅玩家可走':'普通地板';let color='#62676a',mark='';const ball=Object.entries(d.initialBallTileById).find(([,id])=>id===tile.id);const base=Object.entries(d.initialStationTileById).find(([,id])=>id===tile.id);if(ball||base){const colorId=ball?d.componentCompatibility.colorByBallId[ball[0]]:d.componentCompatibility.colorByStationId[base[0]];color={cyan:'#88bafb',amber:'#eda870',magenta:'#c994c4'}[colorId];mark={cyan:'A',amber:'C',magenta:'B'}[colorId];icon=ball?'theft-ball':'theft-base';label=ball?'信号球':'固定基站';}return {...tile,known:true,visited:true,player:tile.id===d.startTileId,color,icon,label,mark};})};
}
if(mode==='theftPower'){const d=theft.definitions[2];for(const tile of board.tiles){if(tile.icon==='theft-ball'){tile.icon=null;tile.mark='';}if(tile.icon==='theft-base')tile.icon='theft-combined';const port=d.powerPortIds.find(id=>d.portTileById[id]===tile.id);if(port){tile.icon='theft-socket';const colorId=d.portCompatibility[port];tile.color={cyan:'#88bafb',amber:'#eda870',magenta:'#c994c4'}[colorId];tile.mark={cyan:'A',amber:'C',magenta:'B'}[colorId];}}}
await renderer.prepare(board,settings);canvas.focus();window.fixtureReady=mode;
}
document.querySelector('#fixture-antivirus').onclick=()=>show('antivirus');document.querySelector('#fixture-theft-1').onclick=()=>show('theft1');document.querySelector('#fixture-theft-3').onclick=()=>show('theft3');
document.querySelector('#fixture-theft-power').onclick=()=>show('theftPower');
document.querySelector('#fixture-reduced').onclick=()=>{settings={...settings,reducedMotion:true,reducedFlash:true};document.documentElement.dataset.reducedMotion='true';document.documentElement.dataset.reducedFlash='true';renderer.update(board,settings);canvas.focus();};
window.renderFixture={metrics:()=>renderer.metrics(),callbacks:()=>[...callbacks]};
function frame(t){renderer.frame(t);requestAnimationFrame(frame)}requestAnimationFrame(frame);
await document.fonts.ready;await show('antivirus');
</script></body></html>`;

export async function verifyR1Stages() {
  const output = resolve("test-results/r1-ui");
  await mkdir(output, { recursive: true });
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    optimizeDeps: {
      noDiscovery: true,
      include: ["three", "three/addons/geometries/RoundedBoxGeometry.js"],
    },
    server: { host: "localhost", port: 5181, strictPort: true },
    plugins: [
      {
        name: "r1-render-fixture",
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            if (request.url !== "/__r1_stage") {
              next();
              return;
            }
            response.setHeader("Content-Type", "text/html");
            response.end(fixture);
          });
        },
      },
    ],
  });
  await server.listen();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const records: unknown[] = [];
  try {
    for (const [width, height] of [
      [1024, 640],
      [1512, 771],
      [1920, 1080],
    ]) {
      await page.setViewportSize({ width: width!, height: height! });
      await page.goto("http://localhost:5181/__r1_stage");
      await page.waitForFunction(() => (window as any).fixtureReady === "antivirus");
      await page.screenshot({ path: resolve(output, `antivirus-${width}x${height}.png`) });
      const virus = await page.evaluate(() => (window as any).renderFixture.metrics());
      assert.equal(virus.antivirusWaveforms, 4);
      assert.equal(virus.tileCount, 20);
      assert.ok(virus.layout.targetCss.minimum >= 44);
      for (const kind of ["1", "3"]) {
        await page.locator(`#fixture-theft-${kind}`).click();
        await page.waitForFunction((kind) => (window as any).fixtureReady === `theft${kind}`, kind);
        const panel = await page.evaluate(() => (window as any).renderFixture.metrics().theftPanel);
        assert.equal(panel.surface, "flat-terminal");
        assert.equal(panel.tileTargets.length, kind === "1" ? 36 : 64);
        for (const tile of panel.tileTargets) {
          assert.ok(
            tile.width >= 44 && tile.height >= 44,
            `${width}×${height}: ${tile.tileId} ${tile.width}×${tile.height}`,
          );
          assert.ok(tile.x > 0 && tile.x < width! && tile.y > 0 && tile.y < height!);
        }
        await page.screenshot({ path: resolve(output, `theft-${kind}-${width}x${height}.png`) });
        const before = await page.evaluate(() => (window as any).renderFixture.callbacks().length);
        await page.locator('.theft-cell[data-kind="theft-ball"]').first().click();
        const after = await page.evaluate(() => ({
          count: (window as any).renderFixture.callbacks().length,
          focus: document.activeElement?.id,
        }));
        assert.equal(after.count, before + 1);
        assert.equal(after.focus, "game-canvas");
        await page.keyboard.press("Enter");
        assert.equal(
          await page.evaluate(() => (window as any).renderFixture.callbacks().length),
          after.count,
        );
        records.push({
          width,
          height,
          mode: `theft${kind}`,
          minimumTarget: Math.min(
            ...panel.tileTargets.map((tile: any) => Math.min(tile.width, tile.height)),
          ),
          clickCallbacks: 1,
          canvasFocus: true,
        });
      }
      await page.locator("#fixture-theft-power").click();
      await page.waitForFunction(() => (window as any).fixtureReady === "theftPower");
      assert.equal(await page.locator('.theft-cell[data-kind="theft-combined"]').count(), 2);
      assert.equal(await page.locator('.theft-cell[data-kind="theft-socket"]').count(), 2);
      await page.screenshot({ path: resolve(output, `theft-power-${width}x${height}.png`) });
      await page.locator("#fixture-reduced").click();
      await page.locator("#fixture-antivirus").click();
      await page.waitForFunction(() => (window as any).fixtureReady === "antivirus");
      await page.screenshot({ path: resolve(output, `antivirus-reduced-${width}x${height}.png`) });
      const frozenFirst = await page.locator("#game-canvas").screenshot();
      await page.waitForTimeout(340);
      assert.deepEqual(
        await page.locator("#game-canvas").screenshot(),
        frozenFirst,
        "reduced effects keep waveforms stable",
      );
      records.push({
        width,
        height,
        mode: "antivirus",
        waveforms: virus.antivirusWaveforms,
        minimumTarget: virus.layout.targetCss.minimum,
      });
    }
    assert.deepEqual(errors, []);
    const result = {
      fixtureOnly: true,
      browser: await browser.version(),
      checkedAt: new Date().toISOString(),
      errors,
      records,
    };
    await writeFile(resolve(output, "render-results.json"), JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
}

if (import.meta.main) await verifyR1Stages();
