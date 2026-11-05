import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = process.env.VACUULA_URL || 'http://192.168.0.230';
const CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PICS_DIR = path.resolve(__dirname, '../../pics');

async function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

async function waitForCanvas(page, timeout = 12000) {
    await page.waitForFunction(() => {
        const canvas = document.querySelector('canvas');
        if (!canvas || canvas.width === 0 || canvas.height === 0) return false;
        const ctx = canvas.getContext('2d');
        if (!ctx) return false;
        try {
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            for (let i = 3; i < data.length; i += 40) {
                if (data[i] > 0) return true;
            }
        } catch (e) {}
        return false;
    }, { timeout }).catch(() => {});
    await new Promise(r => setTimeout(r, 1000));
}

async function run() {
    await ensureDir(PICS_DIR);

    console.log(`Launching Chrome from: ${CHROME_PATH}`);
    console.log(`Connecting to Vacuula at: ${BASE_URL}`);

    const browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        // ── 1. Desktop UI Screenshot ──
        console.log('Capturing Desktop UI...');
        const deskPage = await browser.newPage();
        await deskPage.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
        await deskPage.goto(`${BASE_URL}/robot/OPS42417-7c38660f057e`, { waitUntil: 'domcontentloaded' });
        await waitForCanvas(deskPage);

        const deskRawBuf = await deskPage.screenshot();
        await deskPage.close();

        const deskMeta = await sharp(deskRawBuf).metadata();
        const deskW = deskMeta.width;
        const deskH = deskMeta.height;
        const deskRadius = 24;

        const deskMask = Buffer.from(
            `<svg width="${deskW}" height="${deskH}">
                <rect x="0" y="0" width="${deskW}" height="${deskH}" rx="${deskRadius}" ry="${deskRadius}" fill="white"/>
            </svg>`
        );
        const deskBorder = Buffer.from(
            `<svg width="${deskW}" height="${deskH}">
                <rect x="1" y="1" width="${deskW - 2}" height="${deskH - 2}" rx="${deskRadius}" ry="${deskRadius}" fill="none" stroke="rgba(255, 255, 255, 0.15)" stroke-width="2"/>
            </svg>`
        );

        const deskMasked = await sharp(deskRawBuf)
            .composite([{ input: deskMask, blend: 'dest-in' }])
            .png()
            .toBuffer();

        const deskWithBorder = await sharp(deskMasked)
            .composite([{ input: deskBorder, blend: 'over' }])
            .png()
            .toBuffer();

        const deskPad = 24;
        await sharp({
            create: {
                width: deskW + deskPad * 2,
                height: deskH + deskPad * 2,
                channels: 4,
                background: { r: 15, g: 17, b: 19, alpha: 1 }
            }
        })
        .composite([{ input: deskWithBorder, left: deskPad, top: deskPad }])
        .png()
        .toFile(path.join(PICS_DIR, 'desktop-showcase.png'));

        console.log('Saved pics/desktop-showcase.png');

        // ── 2. Mobile UI Screens ──
        console.log('Capturing Mobile UI screens...');

        // Screen 1: Home / Control
        console.log('  - Screen 1: Home/Control');
        const page1 = await browser.newPage();
        await page1.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        await page1.goto(`${BASE_URL}/robot/OPS42417-7c38660f057e`, { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 2000));
        const mobHomeBuf = await page1.screenshot();
        await page1.close();

        // Screen 2: Map floorplan (drawer collapsed to show full map)
        console.log('  - Screen 2: Map floorplan (collapsed)');
        const page2 = await browser.newPage();
        await page2.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        await page2.goto(`${BASE_URL}/robot/OPS42417-7c38660f057e/map`, { waitUntil: 'domcontentloaded' });
        await waitForCanvas(page2);
        // Map drawer is open by default; click handle once to collapse
        await page2.click('[class*="drawerHandle"]');
        await new Promise(r => setTimeout(r, 1200));
        const mobMapBuf = await page2.screenshot();
        await page2.close();

        // Screen 3: Map Zones / Drawer open
        console.log('  - Screen 3: Map features drawer');
        const page3 = await browser.newPage();
        await page3.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        await page3.goto(`${BASE_URL}/robot/OPS42417-7c38660f057e/map`, { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 2000));
        const mobDrawerBuf = await page3.screenshot();
        await page3.close();

        // Screen 4: Run detail (click first run)
        console.log('  - Screen 4: Run history & coverage');
        const page4 = await browser.newPage();
        await page4.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        await page4.goto(`${BASE_URL}/robot/OPS42417-7c38660f057e/runs`, { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 2000));
        const runButtons = await page4.$$('button[class*="item"]');
        if (runButtons.length > 0) {
            await runButtons[0].click();
            await waitForCanvas(page4);
        }
        const mobRunBuf = await page4.screenshot();
        await page4.close();

        // ── 3. Compose Mobile Showcase ──
        console.log('Framing and compositing mobile showcase...');
        const mobileBuffers = [mobHomeBuf, mobMapBuf, mobDrawerBuf, mobRunBuf];
        const screenH = 920;
        const mobRadius = 28;
        const framedScreens = [];

        for (const buf of mobileBuffers) {
            const resized = await sharp(buf).resize({ height: screenH }).toBuffer();
            const meta = await sharp(resized).metadata();
            const w = meta.width;
            const h = meta.height;

            const mask = Buffer.from(
                `<svg width="${w}" height="${h}">
                    <rect x="0" y="0" width="${w}" height="${h}" rx="${mobRadius}" ry="${mobRadius}" fill="white"/>
                </svg>`
            );
            const border = Buffer.from(
                `<svg width="${w}" height="${h}">
                    <rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="${mobRadius}" ry="${mobRadius}" fill="none" stroke="rgba(255, 255, 255, 0.15)" stroke-width="2"/>
                </svg>`
            );

            const masked = await sharp(resized)
                .composite([{ input: mask, blend: 'dest-in' }])
                .png()
                .toBuffer();

            const withBorder = await sharp(masked)
                .composite([{ input: border, blend: 'over' }])
                .png()
                .toBuffer();

            framedScreens.push({ buffer: withBorder, width: w, height: h });
        }

        const gap = 24;
        const padX = 24;
        const padY = 24;
        const totalScreensW = framedScreens.reduce((sum, s) => sum + s.width, 0);
        const totalW = totalScreensW + (framedScreens.length - 1) * gap + padX * 2;
        const totalH = screenH + padY * 2;

        const composites = [];
        let curX = padX;
        for (const s of framedScreens) {
            composites.push({
                input: s.buffer,
                left: curX,
                top: padY
            });
            curX += s.width + gap;
        }

        const finalMobileShowcase = await sharp({
            create: {
                width: totalW,
                height: totalH,
                channels: 4,
                background: { r: 15, g: 17, b: 19, alpha: 1 }
            }
        })
        .composite(composites)
        .png()
        .toBuffer();

        fs.writeFileSync(path.join(PICS_DIR, 'mobile-showcase.png'), finalMobileShowcase);
        fs.writeFileSync(path.join(PICS_DIR, 'showcase.png'), finalMobileShowcase);

        console.log('Saved pics/mobile-showcase.png and updated pics/showcase.png');
        console.log('All screenshots taken and generated successfully!');
    } finally {
        await browser.close();
    }
}

run().catch(err => {
    console.error('Screenshot generation failed:', err);
    process.exit(1);
});
