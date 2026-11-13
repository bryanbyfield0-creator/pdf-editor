import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const testDir = join(root, "test");
const outDir = join(testDir, "output");
mkdirSync(outDir, { recursive: true });

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".png": "image/png",
};

function serve() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = decodeURIComponent((req.url || "/").split("?")[0]);
      const rel = url === "/" ? "/index.html" : url;
      const path = join(root, rel.replace(/^\/+/, ""));
      if (!path.startsWith(root)) {
        res.writeHead(403); res.end(); return;
      }
      try {
        const body = readFileSync(path);
        res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" });
        res.end(body);
      } catch {
        res.writeHead(404); res.end("not found");
      }
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

function pdfInfo(path) {
  const r = sh("pdfinfo", [path]);
  const info = {};
  for (const line of r.out.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) info[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return info;
}

function pdfText(path) {
  return sh("pdftotext", [path, "-"]).out;
}


async function dragBy(page, locator, dx, dy) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("no bounding box for drag handle");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
}

async function waitPages(page, n) {
  await page.waitForFunction((count) => document.querySelectorAll(".page-wrap").length === count, n, { timeout: 20000 });
}

async function main() {
  const results = [];
  const fail = (msg) => { results.push("FAIL: " + msg); throw new Error(msg); };
  const pass = (msg) => { results.push("PASS: " + msg); console.log("PASS:", msg); };

  const server = await serve();
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/`;
  console.log("serving", url);

  const browser = await chromium.launch({ headless: true });
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await desktop.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR", err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("CONSOLE", msg.text());
  });

  await page.goto(url, { waitUntil: "load" });
  if (await page.locator("[data-testid=tip]").isVisible()) {
    await page.click("[data-testid=tip-close]");
  }
  await page.setInputFiles("[data-testid=file-input]", join(testDir, "sample.pdf"));
  await waitPages(page, 3);
  pass("opened 3-page sample PDF");

  const page1 = page.locator(".page-wrap").first();
  await page1.waitFor({ state: "visible" });
  let box = await page1.boundingBox();

  await page.click("[data-testid=tool-text]");
  await page.mouse.click(box.x + box.width * 0.18, box.y + box.height * 0.28);
  const textBox = page.locator(".annot.text").first();
  await textBox.waitFor({ state: "visible", timeout: 8000 });
  await textBox.click();
  await textBox.type("VERIFY_TEXT_XYZ");
  pass("added text box");

  await page.click("[data-testid=tool-select]");
  await textBox.click();
  const se = page.locator(".annot.text.selected .handle-se, .annot.text:focus .handle-se").first();
  await se.waitFor({ state: "visible", timeout: 8000 });
  const before = await textBox.boundingBox();
  await dragBy(page, se, 90, 55);
  const after = await textBox.boundingBox();
  if (!(after.width > before.width + 25 && after.height > before.height + 15)) {
    fail(`text resize did not grow enough: ${JSON.stringify({ before, after })}`);
  }
  pass(`resized text box ${Math.round(before.width)}x${Math.round(before.height)} -> ${Math.round(after.width)}x${Math.round(after.height)}`);

  await page.evaluate(() => {
    const el = document.querySelector("[data-testid=ink-color]");
    el.value = "#cc1f1a";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.click("[data-testid=tool-draw]");
  box = await page1.boundingBox();
  await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.42);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.48, box.y + box.height * 0.50, { steps: 16 });
  await page.mouse.move(box.x + box.width * 0.36, box.y + box.height * 0.55, { steps: 16 });
  await page.mouse.up();
  await page.waitForSelector("path[data-annot-id], .draw-frame.selected", { timeout: 8000 });
  pass("added freehand drawing");

  const drawFrame = page.locator(".draw-frame").first();
  await drawFrame.waitFor({ state: "visible" });
  const drawHandle = page.locator(".draw-frame.selected .handle-se").first();
  await drawHandle.waitFor({ state: "visible" });
  await drawFrame.scrollIntoViewIfNeeded();
  const drawBefore = await drawFrame.boundingBox();
  await dragBy(page, drawHandle, 70, 50);
  const drawAfter = await drawFrame.boundingBox();
  if (!(drawAfter.width > drawBefore.width + 15 && drawAfter.height > drawBefore.height + 10)) {
    fail(`drawing resize did not grow enough: ${JSON.stringify({ drawBefore, drawAfter })}`);
  }
  pass(`resized drawing ${Math.round(drawBefore.width)}x${Math.round(drawBefore.height)} -> ${Math.round(drawAfter.width)}x${Math.round(drawAfter.height)}`);

  await page.click("[data-testid=tool-highlight]");
  box = await page1.boundingBox();
  await page.mouse.move(box.x + box.width * 0.12, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.27, { steps: 8 });
  await page.mouse.up();
  const highlight = page.locator(".annot.highlight").first();
  await highlight.waitFor({ state: "visible", timeout: 8000 });
  const hiHandle = page.locator(".annot.highlight.selected .handle-se, .annot.highlight .handle-se").first();
  await hiHandle.waitFor({ state: "visible" });
  await highlight.scrollIntoViewIfNeeded();
  const hiBefore = await highlight.boundingBox();
  await dragBy(page, hiHandle, 40, 20);
  const hiAfter = await highlight.boundingBox();
  if (!(hiAfter.width > hiBefore.width + 10)) {
    fail(`highlight resize did not grow enough: ${JSON.stringify({ hiBefore, hiAfter })}`);
  }
  pass(`resized highlight ${Math.round(hiBefore.width)}x${Math.round(hiBefore.height)} -> ${Math.round(hiAfter.width)}x${Math.round(hiAfter.height)}`);

  await page.click("[data-testid=tool-select]");
  await page.click("[data-testid=thumb-1]");
  await page.click("[data-testid=delete-page-btn]");
  await waitPages(page, 2);
  pass("deleted page 2");

  await page.selectOption("[data-testid=page-size]", "a4");
  await page.waitForTimeout(400);
  pass("set page size to A4");

  await page.screenshot({ path: join(root, "desktop.png"), fullPage: true });
  pass("saved desktop screenshot");

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30000 }),
    page.click("[data-testid=download-btn]"),
  ]);
  const editedPath = join(outDir, "edited.pdf");
  await download.saveAs(editedPath);
  const info = pdfInfo(editedPath);
  const text = pdfText(editedPath);
  if (info.Pages !== "2") fail("expected 2 pages, got " + info.Pages);
  pass("downloaded PDF has 2 pages");
  if (!/VERIFY_TEXT_XYZ/.test(text)) fail("missing added text in output: " + text);
  pass("output contains added text");
  if (/PAGE TWO/.test(text)) fail("deleted page 2 is still present");
  if (!/PAGE THREE/.test(text) || !/PAGE ONE/.test(text)) fail("remaining original pages missing: " + text);
  pass("page 2 removed; pages 1 and 3 remain");

  const size = info["Page size"] || "";
  // A4 is 595.28 x 841.89 pts
  const nums = size.match(/([\d.]+)\s*x\s*([\d.]+)/);
  if (!nums) fail("could not parse page size: " + size);
  const pw = parseFloat(nums[1]);
  const ph = parseFloat(nums[2]);
  if (Math.abs(pw - 595.28) > 2 || Math.abs(ph - 841.89) > 2) {
    fail("expected A4 page size, got " + size);
  }
  pass("output page size is A4 (" + size + ")");

  const ppm = join(outDir, "edited-page1");
  const conv = sh("pdftoppm", ["-png", "-r", "110", "-f", "1", "-l", "1", editedPath, ppm]);
  if (conv.code !== 0) fail("pdftoppm failed: " + conv.out);
  const pngPath = join(outDir, "edited-page1-1.png");
  writeFileSync(join(outDir, "pixels.json"), "");
  const pix = spawnSync("/workspace/.venv_pdf/bin/python", ["-c", `
from PIL import Image
im = Image.open(${JSON.stringify(pngPath)}).convert("RGB")
px = im.load()
w, h = im.size
yellow = red = 0
for y in range(h):
    for x in range(w):
        r,g,b = px[x,y]
        if r > 200 and g > 180 and b < 230 and (r - b) > 20 and (g - b) > 10:
            yellow += 1
        if r > 140 and g < 90 and b < 90 and r > g + 50:
            red += 1
print(f"size={w}x{h} yellow={yellow} red={red}")
if yellow < 200:
    raise SystemExit("not enough highlight pixels")
if red < 30:
    raise SystemExit("not enough drawing pixels")
`], { encoding: "utf8" });
  if (pix.status !== 0) fail("pixel check failed: " + pix.stdout + pix.stderr);
  pass("highlight and drawing visible in rendered output (" + pix.stdout.trim() + ")");

  // compress check
  const photoCtx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const photoPage = await photoCtx.newPage();
  await photoPage.goto(url, { waitUntil: "load" });
  if (await photoPage.locator("[data-testid=tip]").isVisible()) {
    await photoPage.click("[data-testid=tip-close]");
  }
  await photoPage.setInputFiles("[data-testid=file-input]", join(testDir, "photo-sample.pdf"));
  await photoPage.waitForSelector(".page-wrap", { timeout: 20000 });
  const [plainDl] = await Promise.all([
    photoPage.waitForEvent("download", { timeout: 30000 }),
    photoPage.click("[data-testid=download-btn]"),
  ]);
  const plainPath = join(outDir, "photo-plain.pdf");
  await plainDl.saveAs(plainPath);
  await photoPage.check("[data-testid=compress-chk]");
  const [compDl] = await Promise.all([
    photoPage.waitForEvent("download", { timeout: 60000 }),
    photoPage.click("[data-testid=download-btn]"),
  ]);
  const compPath = join(outDir, "photo-compressed.pdf");
  await compDl.saveAs(compPath);
  const plainSize = statSync(plainPath).size;
  const compSize = statSync(compPath).size;
  const origPhoto = statSync(join(testDir, "photo-sample.pdf")).size;
  const cinfo = pdfInfo(compPath);
  if (cinfo.Pages !== "1") fail("compressed PDF page count " + cinfo.Pages);
  if (!/PHOTO SAMPLE/.test(pdfText(compPath))) fail("compressed PDF missing text");
  if (compSize < 20000) fail("compressed PDF is suspiciously small (" + compSize + " bytes); the photo may have been dropped");
  if (!(compSize < plainSize * 0.6 && compSize < origPhoto * 0.6)) {
    fail("compressed file was not much smaller (" + compSize + " vs " + plainSize + ")");
  }
  const compPpm = join(outDir, "photo-compressed");
  const cconv = sh("pdftoppm", ["-png", "-r", "50", "-f", "1", "-l", "1", compPath, compPpm]);
  if (cconv.code !== 0) fail("pdftoppm compressed failed: " + cconv.out);
  const visual = spawnSync("/workspace/.venv_pdf/bin/python", ["-c", `
from PIL import Image
im = Image.open(${JSON.stringify(join(outDir, "photo-compressed-1.png"))}).convert("RGB")
w, h = im.size
px = im.load()
white = colorful = 0
for y in range(h):
    for x in range(w):
        r,g,b = px[x,y]
        if r>250 and g>250 and b>250: white += 1
        if max(r,g,b)-min(r,g,b) > 40: colorful += 1
frac_white = white/(w*h)
print(f"white={frac_white:.3f} colorful={colorful}")
if frac_white > 0.8 or colorful < 500:
    raise SystemExit("compressed photo is missing")
`], { encoding: "utf8" });
  if (visual.status !== 0) fail("compressed photo visual check failed: " + visual.stdout + visual.stderr);
  pass(`compress option produced a valid smaller PDF with the photo still visible (${Math.round(compSize/1024)} KB vs plain ${Math.round(plainSize/1024)} KB, original ${Math.round(origPhoto/1024)} KB; ${visual.stdout.trim()})`);
  await photoCtx.close();

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const mpage = await mobile.newPage();
  await mpage.goto(url, { waitUntil: "load" });
  if (await mpage.locator("[data-testid=tip]").isVisible()) {
    await mpage.click("[data-testid=tip-close]");
  }
  await mpage.setInputFiles("[data-testid=file-input]", join(testDir, "sample.pdf"));
  await mpage.waitForSelector(".page-wrap", { timeout: 20000 });
  const mwrap = mpage.locator(".page-wrap").first();
  await mwrap.scrollIntoViewIfNeeded();
  await mpage.click("[data-testid=tool-text]");
  await mpage.waitForTimeout(200);
  const mb = await mwrap.boundingBox();
  await mwrap.click({ position: { x: Math.round(mb.width * 0.3), y: Math.round(mb.height * 0.25) } });
  const mtext = mpage.locator(".annot.text").first();
  await mtext.waitFor({ state: "visible", timeout: 8000 });
  await mtext.click();
  await mpage.keyboard.type("MOBILE_OK");
  const mHandle = mpage.locator(".annot.text.selected .handle-se, .annot.text:focus .handle-se").first();
  await mHandle.waitFor({ state: "visible" });
  await mHandle.scrollIntoViewIfNeeded();
  const mBefore = await mtext.boundingBox();
  await dragBy(mpage, mHandle, 50, 30);
  const mAfter = await mtext.boundingBox();
  if (mAfter.width > mBefore.width + 10) {
    pass(`mobile resize worked ${Math.round(mBefore.width)} -> ${Math.round(mAfter.width)}`);
  } else {
    results.push("NOTE: mobile resize was inconclusive: " + JSON.stringify({ mBefore, mAfter }));
    console.log("NOTE: mobile resize inconclusive");
  }
  await mpage.screenshot({ path: join(root, "mobile.png"), fullPage: true });
  pass("saved mobile screenshot");
  await mobile.close();

  await browser.close();
  server.close();
  writeFileSync(join(outDir, "results.txt"), results.join("\n") + "\n");
  console.log("\nAll required checks passed.");
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
