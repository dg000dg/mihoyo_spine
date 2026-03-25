import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import CanvasKitInit from "canvaskit-wasm/bin/canvaskit.js";
import {
  Physics,
  SkeletonDrawable,
  SkeletonRenderer,
  Vector2,
  loadSkeletonData,
  loadTextureAtlas,
} from "@esotericsoftware/spine-canvaskit";

const require = createRequire(import.meta.url);
const thisFilePath = fileURLToPath(import.meta.url);

if (process.stdin.isTTY) process.stdin.setEncoding("utf8");
process.stdout.setDefaultEncoding?.("utf8");
process.stderr.setDefaultEncoding?.("utf8");

const cwd = process.cwd();
const spineDir = path.join(cwd, "spine");
const outputDir = path.join(cwd, "task_output");
const tempRootDir = path.join(cwd, ".temp_frames");
const defaultConfigPath = path.join(cwd, "spine-render-tasks.json");
const padding = 8;
const fpsCandidates = [12, 15, 20, 24, 25, 30, 48, 50, 60];

const cli = parseArgs(process.argv.slice(2));

main().catch((error) => {
  console.error("转换失败：", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

async function main() {
  if (cli.workerPayload) {
    await runWorkerPayload(cli.workerPayload);
    return;
  }

  await ensureDir(spineDir);
  await fsp.mkdir(outputDir, { recursive: true });
  await fsp.mkdir(tempRootDir, { recursive: true });
  await assertFfmpegAvailable();

  const canvasKit = await loadCanvasKit();
  const resources = await findSkeletonResources(spineDir);
  const resourceMap = new Map(resources.map((resource) => [resource.name, resource]));

  if (resources.length === 0) {
    throw new Error(`在 ${spineDir} 中没有找到可用的 .json/.skel + .atlas 资源。`);
  }

  if (cli.listOnly) {
    await listResources(canvasKit, resources);
    return;
  }

  const tasks = await buildTasks(resources, resourceMap);
  if (tasks.length === 0) {
    console.log("没有需要执行的转换任务。");
    return;
  }

  for (const task of tasks) {
    await convertTask(canvasKit, task);
  }
}

async function buildTasks(resources, resourceMap) {
  if (await fileExists(cli.configPath)) {
    const config = await loadConfig(cli.configPath);
    return expandConfigTasks(config, resourceMap);
  }

  return resources
    .filter((resource) => !cli.skeletonFilter || resource.name.includes(cli.skeletonFilter))
    .map((resource) => ({
      resource,
      skinFilter: cli.skinFilter,
      animationFilter: cli.animationFilter,
      fps: cli.fps,
      scale: cli.scale,
      format: cli.format,
      frameWorkers: normalizeWorkerCount(cli.frameWorkers),
      keepFrames: cli.keepFrames,
      skipExistingOutput: null,
      overwrite: cli.overwrite,
      allSkins: cli.allSkins,
      skins: [],
      animations: [],
      filePrefix: "",
      outputSubdir: "",
    }));
}

async function loadConfig(configPath) {
  const rawText = stripUtf8Bom(await fsp.readFile(configPath, "utf8"));
  let config;
  try {
    config = JSON.parse(rawText);
  } catch (error) {
    throw new Error(
      `配置文件不是有效 JSON：${configPath}\n${error instanceof Error ? error.message : error}`,
    );
  }

  if (!config || typeof config !== "object" || !Array.isArray(config.jobs)) {
    throw new Error(`配置文件格式不正确：${configPath}\n需要包含 jobs 数组。`);
  }

  return config;
}

function stripUtf8Bom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function expandConfigTasks(config, resourceMap) {
  const defaults = normalizeConfigDefaults(config.defaults ?? {});
  const tasks = [];

  for (let index = 0; index < config.jobs.length; index += 1) {
    const job = config.jobs[index];
    if (!job || typeof job !== "object") {
      throw new Error(`配置文件第 ${index + 1} 个 job 不是对象。`);
    }
    if (typeof job.skeleton !== "string" || !job.skeleton.trim()) {
      throw new Error(`配置文件第 ${index + 1} 个 job 缺少 skeleton。`);
    }

    const resource = resourceMap.get(job.skeleton.trim());
    if (!resource) {
      throw new Error(`配置文件第 ${index + 1} 个 job 指定的 skeleton 不存在：${job.skeleton}`);
    }

    tasks.push({
      resource,
      skinFilter: "",
      animationFilter: "",
      fps: pickNumber(job.fps, defaults.fps, cli.fps),
      scale: pickNumber(job.scale, defaults.scale, cli.scale),
      format: pickFormat(job.format, defaults.format, cli.format),
      frameWorkers: normalizeWorkerCount(
        pickNumber(job.frameWorkers, defaults.frameWorkers, cli.frameWorkers),
      ),
      keepFrames: pickBoolean(job.keepFrames, defaults.keepFrames, cli.keepFrames),
      skipExistingOutput: pickNullableBoolean(
        job.skipExistingOutput,
        defaults.skipExistingOutput,
      ),
      overwrite: pickBoolean(job.overwrite, defaults.overwrite, cli.overwrite),
      allSkins: pickBoolean(job.allSkins, defaults.allSkins, cli.allSkins),
      skins: normalizeNameArray(job.skins),
      animations: normalizeNameArray(job.animations),
      filePrefix: typeof job.filePrefix === "string" && job.filePrefix.trim()
        ? job.filePrefix.trim()
        : "",
      outputSubdir: typeof job.outputSubdir === "string" && job.outputSubdir.trim()
        ? job.outputSubdir.trim()
        : "",
    });
  }

  return tasks;
}

function normalizeConfigDefaults(defaults) {
  return {
    fps: pickNumber(defaults.fps, null),
    scale: pickNumber(defaults.scale, 1),
    format: pickFormat(defaults.format, "gif"),
    frameWorkers: normalizeWorkerCount(
      pickNumber(defaults.frameWorkers, Math.max(1, Math.floor(os.cpus().length / 2))),
    ),
    keepFrames: Boolean(defaults.keepFrames),
    skipExistingOutput: pickNullableBoolean(defaults.skipExistingOutput),
    overwrite: Boolean(defaults.overwrite),
    allSkins: Boolean(defaults.allSkins),
  };
}

async function convertTask(canvasKit, task) {
  const { resource } = task;
  console.log(`\n[资源] ${resource.name}`);

  const atlas = await loadTextureAtlas(canvasKit, toSpinePath(resource.atlasPath), readBinaryFile);
  const skeletonData = await loadSkeletonData(
    toSpinePath(resource.skeletonPath),
    atlas,
    readBinaryFile,
    task.scale,
  );

  const rawData = resource.skeletonPath.endsWith(".json")
    ? JSON.parse(await fsp.readFile(resource.skeletonPath, "utf8"))
    : null;

  const selectedAnimations = pickAnimationNames(
    skeletonData.animations.map((animation) => animation.name),
    task,
  );
  if (selectedAnimations.length === 0) {
    console.log("  没有匹配到需要转换的动画，已跳过。");
    return;
  }

  const selectedSkins = pickSkinNames(
    skeletonData.skins.map((skin) => skin.name),
    task,
  );
  if (selectedSkins.length === 0) {
    console.log("  没有匹配到需要转换的皮肤，已跳过。");
    return;
  }

  const outputRoot = task.outputSubdir ? path.join(outputDir, safeName(task.outputSubdir)) : outputDir;

  for (const skinName of selectedSkins) {
    await fsp.mkdir(outputRoot, { recursive: true });
    console.log(`  [皮肤] ${skinName}`);

    for (const animationName of selectedAnimations) {
      const animation = skeletonData.animations.find((item) => item.name === animationName);
      if (!animation) continue;

      const inferredFps = inferAnimationFps(rawData?.animations?.[animation.name]);
      const fps = task.fps ?? inferredFps ?? 30;
      const frameCount = Math.max(1, Math.ceil(animation.duration * fps - 1e-6));
      const workers = normalizeWorkerCount(task.frameWorkers);

      console.log(
        `    - 动画 ${animation.name} | 时长 ${animation.duration.toFixed(3)}s | 采样 ${fps}fps | ${frameCount} 帧 | 出帧线程 ${workers}`,
      );

      const bounds = measureAnimationBounds(skeletonData, skinName, animation.name, fps, frameCount);
      const frameDir = path.join(
        tempRootDir,
        `${resource.name}_${safeName(skinName)}_${safeName(animation.name)}`,
      );
      const outputFileName = buildOutputFileName(task, resource.name, skinName, animation.name);
      const outputPath = path.join(outputRoot, outputFileName);

      if (shouldSkipExistingOutput(task) && fs.existsSync(outputPath)) {
        console.log(`      已存在，跳过：${outputPath}`);
        continue;
      }

      const frameCache = await inspectFrameCache(frameDir, frameCount);
      if (frameCache.missingFrames.length === 0) {
        console.log(`      发现已有完整帧，复用：${frameDir}`);
      } else {
        await fsp.mkdir(frameDir, { recursive: true });
        if (frameCache.existingCount > 0) {
          console.log(
            `      检测到残留帧 ${frameCache.existingCount}/${frameCount}，仅补缺失 ${frameCache.missingFrames.length} 帧`,
          );
        }

        const missingRanges = buildRangesFromFrameList(frameCache.missingFrames);
        await renderAnimationFramesParallel({
          resource,
          task,
          skinName,
          animationName: animation.name,
          fps,
          frameCount,
          bounds,
          frameDir,
        }, workers, canvasKit, skeletonData, missingRanges);
      }

      await encodeOutputWithFfmpeg(frameDir, outputPath, fps, task.format);

      if (!task.keepFrames) {
        await fsp.rm(frameDir, { recursive: true, force: true });
      }
    }
  }
}

function pickAnimationNames(allAnimationNames, task) {
  if (task.animations?.length) {
    return task.animations.filter((name) => allAnimationNames.includes(name));
  }
  if (task.animationFilter) {
    return allAnimationNames.filter((name) => name.includes(task.animationFilter));
  }
  return allAnimationNames;
}

function pickSkinNames(allSkinNames, task) {
  if (task.skins?.length) {
    return task.skins.filter((name) => allSkinNames.includes(name));
  }
  if (task.allSkins) {
    if (!task.skinFilter) return allSkinNames;
    return allSkinNames.filter((name) => name.includes(task.skinFilter));
  }
  if (task.skinFilter) {
    return allSkinNames.filter((name) => name.includes(task.skinFilter));
  }
  if (allSkinNames.includes("default")) return ["default"];
  return allSkinNames.length > 0 ? [allSkinNames[0]] : [];
}

function measureAnimationBounds(skeletonData, skinName, animationName, fps, frameCount) {
  const drawable = createDrawable(skeletonData, skinName, animationName);
  const offset = new Vector2();
  const size = new Vector2();
  const temp = [];

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let frame = 0; frame < frameCount; frame += 1) {
    stepDrawable(drawable, frame, fps);
    drawable.skeleton.getBounds(offset, size, temp, null);
    if (size.x <= 0 || size.y <= 0) continue;
    minX = Math.min(minX, offset.x);
    minY = Math.min(minY, offset.y);
    maxX = Math.max(maxX, offset.x + size.x);
    maxY = Math.max(maxY, offset.y + size.y);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return {
      minX: 0,
      minY: 0,
      width: Math.max(1, Math.ceil((skeletonData.width || 1) + padding * 2)),
      height: Math.max(1, Math.ceil((skeletonData.height || 1) + padding * 2)),
    };
  }

  return {
    minX,
    minY,
    width: Math.max(1, Math.ceil(maxX - minX + padding * 2)),
    height: Math.max(1, Math.ceil(maxY - minY + padding * 2)),
  };
}

async function renderAnimationFramesParallel(
  renderContext,
  workers,
  canvasKit,
  skeletonData,
  frameRanges = null,
) {
  const baseRanges = frameRanges && frameRanges.length > 0
    ? frameRanges
    : splitFrameRanges(renderContext.frameCount, workers);
  const ranges = splitRangesForWorkers(baseRanges, workers);

  if (ranges.length === 0) return;

  if (workers <= 1 || ranges.length === 1) {
    for (const range of ranges) {
      await renderAnimationFramesRange({
        ...renderContext,
        canvasKit,
        skeletonData,
        frameStart: range.start,
        frameEnd: range.end,
      });
    }
    return;
  }

  const limit = Math.min(workers, ranges.length);
  console.log(`      并行分片: ${ranges.length} 段 (线程上限 ${limit})`);
  await runWithConcurrency(limit, ranges, (range, index) =>
    spawnFrameWorker({
      resource: renderContext.resource,
      taskScale: renderContext.task.scale,
      skinName: renderContext.skinName,
      animationName: renderContext.animationName,
      fps: renderContext.fps,
      bounds: renderContext.bounds,
      frameDir: renderContext.frameDir,
      frameStart: range.start,
      frameEnd: range.end,
      workerIndex: index,
    }),
  );
}

async function spawnFrameWorker(payload) {
  const payloadText = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  await runCommand(process.execPath, [thisFilePath, "--worker-payload", payloadText], { quiet: true });
}

async function runWorkerPayload(encodedPayload) {
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64").toString("utf8"));
  } catch (error) {
    throw new Error(`worker payload 无法解析：${error instanceof Error ? error.message : error}`);
  }

  const canvasKit = await loadCanvasKit();
  const atlas = await loadTextureAtlas(canvasKit, toSpinePath(payload.resource.atlasPath), readBinaryFile);
  const skeletonData = await loadSkeletonData(
    toSpinePath(payload.resource.skeletonPath),
    atlas,
    readBinaryFile,
    payload.taskScale,
  );

  await renderAnimationFramesRange({
    canvasKit,
    skeletonData,
    skinName: payload.skinName,
    animationName: payload.animationName,
    fps: payload.fps,
    frameDir: payload.frameDir,
    bounds: payload.bounds,
    frameStart: payload.frameStart,
    frameEnd: payload.frameEnd,
  });
}

async function renderAnimationFramesRange({
  canvasKit,
  skeletonData,
  skinName,
  animationName,
  fps,
  frameDir,
  bounds,
  frameStart,
  frameEnd,
}) {
  const drawable = createDrawable(skeletonData, skinName, animationName);
  const renderer = new SkeletonRenderer(canvasKit);
  const surface = canvasKit.MakeSurface(bounds.width, bounds.height);
  if (!surface) {
    throw new Error(`无法创建离屏画布：${bounds.width}x${bounds.height}`);
  }

  const canvas = surface.getCanvas();

  try {
    for (let frame = 0; frame < frameStart; frame += 1) {
      stepDrawable(drawable, frame, fps);
    }

    for (let frame = frameStart; frame < frameEnd; frame += 1) {
      stepDrawable(drawable, frame, fps);
      const pngPath = path.join(frameDir, `${String(frame).padStart(5, "0")}.png`);
      if (fs.existsSync(pngPath)) {
        continue;
      }
      canvas.clear(canvasKit.TRANSPARENT);
      canvas.save();
      canvas.translate(-bounds.minX + padding, -bounds.minY + padding);
      renderer.render(canvas, drawable);
      canvas.restore();
      surface.flush();

      const image = surface.makeImageSnapshot();
      if (!image) throw new Error(`第 ${frame} 帧截图失败。`);
      const bytes = image.encodeToBytes();
      image.delete();
      if (!bytes) throw new Error(`第 ${frame} 帧编码 PNG 失败。`);
      await fsp.writeFile(pngPath, Buffer.from(bytes));
    }
  } finally {
    surface.dispose();
  }
}

function stepDrawable(drawable, frame, fps) {
  if (frame === 0) drawable.update(0, Physics.pose);
  else drawable.update(1 / fps, Physics.update);
}

function splitFrameRanges(frameCount, workers) {
  const ranges = [];
  const actualWorkers = Math.min(workers, frameCount);
  const base = Math.floor(frameCount / actualWorkers);
  const remainder = frameCount % actualWorkers;

  let start = 0;
  for (let i = 0; i < actualWorkers; i += 1) {
    const size = base + (i < remainder ? 1 : 0);
    const end = start + size;
    ranges.push({ start, end });
    start = end;
  }
  return ranges;
}

function splitRangesForWorkers(ranges, workers) {
  if (!ranges || ranges.length === 0) return [];
  const totalFrames = ranges.reduce((sum, range) => sum + Math.max(0, range.end - range.start), 0);
  if (totalFrames <= 0) return [];

  const targetChunks = Math.max(1, Math.min(workers, totalFrames));
  if (ranges.length >= targetChunks) return ranges;

  const result = [];
  let remainingFrames = totalFrames;
  let remainingChunks = targetChunks;

  for (const range of ranges) {
    let start = range.start;
    const end = range.end;
    while (start < end) {
      const maxChunkSize = Math.ceil(remainingFrames / remainingChunks);
      const size = Math.min(maxChunkSize, end - start);
      result.push({ start, end: start + size });
      start += size;
      remainingFrames -= size;
      remainingChunks -= 1;
    }
  }

  return result;
}

function buildRangesFromFrameList(frameList) {
  if (!frameList || frameList.length === 0) return [];
  const sorted = [...frameList].sort((a, b) => a - b);
  const ranges = [];

  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    ranges.push({ start, end: prev + 1 });
    start = current;
    prev = current;
  }
  ranges.push({ start, end: prev + 1 });
  return ranges;
}

function createDrawable(skeletonData, skinName, animationName) {
  const drawable = new SkeletonDrawable(skeletonData);
  if (skinName) drawable.skeleton.setSkinByName(skinName);
  drawable.skeleton.setToSetupPose();
  drawable.skeleton.setSlotsToSetupPose();
  drawable.animationState.setAnimation(0, animationName, false);
  return drawable;
}

async function encodeOutputWithFfmpeg(frameDir, outputPath, fps, format) {
  if (format === "mp4_264") {
    await encodeMp4H264WithFfmpeg(frameDir, outputPath, fps);
    return;
  }
  if (format === "mp4_265") {
    await encodeMp4H265WithFfmpeg(frameDir, outputPath, fps);
    return;
  }
  if (format === "webm") {
    await encodeWebmWithFfmpeg(frameDir, outputPath, fps);
    return;
  }
  await encodeGifWithFfmpeg(frameDir, outputPath, fps);
}

async function encodeGifWithFfmpeg(frameDir, gifPath, fps) {
  const inputPattern = path.join(frameDir, "%05d.png");
  const filter =
    "split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3:alpha_threshold=128";
  await runCommand("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-framerate",
    String(fps),
    "-i",
    inputPattern,
    "-lavfi",
    filter,
    "-loop",
    "0",
    gifPath,
  ]);
}

async function encodeMp4H264WithFfmpeg(frameDir, videoPath, fps) {
  const inputPattern = path.join(frameDir, "%05d.png");
  await runCommand("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-framerate",
    String(fps),
    "-i",
    inputPattern,
    "-vf",
    "pad=ceil(iw/2)*2:ceil(ih/2)*2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv444p",
    "-movflags",
    "+faststart",
    videoPath,
  ]);
}

async function encodeMp4H265WithFfmpeg(frameDir, videoPath, fps) {
  const inputPattern = path.join(frameDir, "%05d.png");
  await runCommand("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-framerate",
    String(fps),
    "-i",
    inputPattern,
    "-vf",
    "pad=ceil(iw/2)*2:ceil(ih/2)*2",
    "-c:v",
    "libx265",
    "-pix_fmt",
    "yuv444p",
    "-movflags",
    "+faststart",
    videoPath,
  ]);
}

async function encodeWebmWithFfmpeg(frameDir, videoPath, fps) {
  const inputPattern = path.join(frameDir, "%05d.png");
  await runCommand("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-framerate",
    String(fps),
    "-i",
    inputPattern,
    "-c:v",
    "libvpx-vp9",
    "-pix_fmt",
    "yuva420p",
    videoPath,
  ]);
}

function inferAnimationFps(animationData) {
  if (!animationData || typeof animationData !== "object") return 30;
  const times = [];
  collectTimes(animationData, times);
  if (times.length < 2) return 30;

  const uniqueTimes = [...new Set(times)].sort((a, b) => a - b);
  const deltas = [];
  for (let i = 1; i < uniqueTimes.length; i += 1) {
    const delta = uniqueTimes[i] - uniqueTimes[i - 1];
    if (delta > 1e-5) deltas.push(delta);
  }
  if (deltas.length === 0) return 30;

  let bestFps = 30;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of fpsCandidates) {
    let score = 0;
    for (const delta of deltas) {
      const frames = delta * candidate;
      score += Math.abs(frames - Math.round(frames));
    }
    score /= deltas.length;
    if (score < bestScore - 1e-8) {
      bestScore = score;
      bestFps = candidate;
    }
  }
  return bestFps;
}

function collectTimes(value, output) {
  if (Array.isArray(value)) {
    for (const item of value) collectTimes(item, output);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (typeof value.time === "number") output.push(value.time);
  for (const nested of Object.values(value)) collectTimes(nested, output);
}

async function findSkeletonResources(rootDir) {
  const entries = await fsp.readdir(rootDir, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const atlasNames = new Set(files.filter((name) => name.endsWith(".atlas")));
  const skeletonNames = files.filter((name) => name.endsWith(".json") || name.endsWith(".skel"));

  return skeletonNames
    .map((name) => {
      const baseName = name.replace(/\.(json|skel)$/u, "");
      const atlasName = `${baseName}.atlas`;
      if (!atlasNames.has(atlasName)) return null;
      return {
        name: baseName,
        skeletonPath: path.join(rootDir, name),
        atlasPath: path.join(rootDir, atlasName),
      };
    })
    .filter(Boolean);
}

async function loadCanvasKit() {
  const canvasKitJs = require.resolve("canvaskit-wasm/bin/canvaskit.js");
  const canvasKitDir = path.dirname(canvasKitJs);
  return CanvasKitInit({
    locateFile: (file) => path.join(canvasKitDir, file),
  });
}

async function listResources(canvasKit, resources) {
  for (const resource of resources) {
    const atlas = await loadTextureAtlas(canvasKit, toSpinePath(resource.atlasPath), readBinaryFile);
    const skeletonData = await loadSkeletonData(
      toSpinePath(resource.skeletonPath),
      atlas,
      readBinaryFile,
      cli.scale,
    );
    console.log(`\n[资源] ${resource.name}`);
    console.log(`  皮肤: ${skeletonData.skins.map((skin) => skin.name).join(", ") || "无"}`);
    console.log(`  动画: ${skeletonData.animations.map((animation) => animation.name).join(", ") || "无"}`);
  }
}

async function readBinaryFile(filePath) {
  return fsp.readFile(path.normalize(filePath));
}

function toSpinePath(filePath) {
  return filePath.replaceAll("\\", "/");
}

async function assertFfmpegAvailable() {
  await runCommand("ffmpeg", ["-version"], { quiet: true });
}

async function ensureDir(dirPath) {
  const stat = await fsp.stat(dirPath).catch(() => null);
  if (!stat || !stat.isDirectory()) throw new Error(`目录不存在：${dirPath}`);
}

async function fileExists(filePath) {
  const stat = await fsp.stat(filePath).catch(() => null);
  return Boolean(stat);
}

async function inspectFrameCache(frameDir, frameCount) {
  const stat = await fsp.stat(frameDir).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    return {
      existingCount: 0,
      missingFrames: [...Array(frameCount).keys()],
    };
  }

  const files = await fsp.readdir(frameDir).catch(() => []);
  const frameSet = new Set(files.filter((name) => /^\d{5}\.png$/u.test(name)));
  const missingFrames = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    const fileName = `${String(frame).padStart(5, "0")}.png`;
    if (!frameSet.has(fileName)) {
      missingFrames.push(frame);
    }
  }

  return {
    existingCount: frameCount - missingFrames.length,
    missingFrames,
  };
}

async function resetDirectory(dirPath) {
  await fsp.rm(dirPath, { recursive: true, force: true });
  await fsp.mkdir(dirPath, { recursive: true });
}

async function runWithConcurrency(limit, items, handler) {
  const total = items.length;
  const workers = Math.max(1, Math.min(limit, total));
  let cursor = 0;

  const runners = Array.from({ length: workers }, async (_, workerIndex) => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= total) return;
      await handler(items[index], workerIndex);
    }
  });

  await Promise.all(runners);
}

function safeName(name) {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_").trim() || "item";
}

function normalizeNameArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => item.trim());
}

function buildOutputFileName(task, skeletonName, skinName, animationName) {
  const parts = [];
  if (task.filePrefix) parts.push(task.filePrefix);
  parts.push(skeletonName);
  if (skinName && skinName !== "default") parts.push(skinName);
  parts.push(animationName);
  return `${parts.map((part) => safeName(part)).join("_")}.${getOutputExtension(task.format)}`;
}

function pickNumber(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function pickBoolean(...values) {
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  return false;
}

function pickNullableBoolean(...values) {
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  return null;
}

function shouldSkipExistingOutput(task) {
  if (typeof task.skipExistingOutput === "boolean") {
    return task.skipExistingOutput;
  }
  return !task.overwrite;
}

function pickFormat(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = value.trim().toLowerCase();
    if (
      normalized === "gif" ||
      normalized === "webm" ||
      normalized === "mp4_264" ||
      normalized === "mp4_265"
    ) {
      return normalized;
    }
  }
  return "gif";
}

function getOutputExtension(format) {
  if (format === "mp4_264" || format === "mp4_265") {
    return "mp4";
  }
  return format;
}

function normalizeWorkerCount(value) {
  const fallback = 1;
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const rounded = Math.floor(value);
  return Math.max(1, Math.min(32, rounded));
}

function parseArgs(argv) {
  const parsed = {
    skeletonFilter: "",
    animationFilter: "",
    skinFilter: "",
    fps: null,
    scale: 1,
    format: "gif",
    frameWorkers: null,
    keepFrames: false,
    allSkins: false,
    listOnly: false,
    overwrite: false,
    configPath: defaultConfigPath,
    workerPayload: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--skeleton" && next) {
      parsed.skeletonFilter = next;
      index += 1;
      continue;
    }
    if (arg === "--animation" && next) {
      parsed.animationFilter = next;
      index += 1;
      continue;
    }
    if (arg === "--skin" && next) {
      parsed.skinFilter = next;
      index += 1;
      continue;
    }
    if (arg === "--fps" && next) {
      parsed.fps = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--scale" && next) {
      parsed.scale = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--format" && next) {
      parsed.format = pickFormat(next);
      index += 1;
      continue;
    }
    if (arg === "--frame-workers" && next) {
      parsed.frameWorkers = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--config" && next) {
      parsed.configPath = path.resolve(cwd, next);
      index += 1;
      continue;
    }
    if (arg === "--worker-payload" && next) {
      parsed.workerPayload = next;
      index += 1;
      continue;
    }
    if (arg === "--keep-frames") {
      parsed.keepFrames = true;
      continue;
    }
    if (arg === "--all-skins") {
      parsed.allSkins = true;
      continue;
    }
    if (arg === "--list") {
      parsed.listOnly = true;
      continue;
    }
    if (arg === "--overwrite") {
      parsed.overwrite = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(`用法：
node spine-batch-render.js
node spine-batch-render.js --config spine-render-tasks.json
node spine-batch-render.js --format mp4_264 --frame-workers 4
node spine-batch-render.js --skeleton ren --skin default --animation idel
node spine-batch-render.js --list

说明：
  默认优先读取当前目录的 spine-render-tasks.json。
  如果配置文件存在，直接按配置批量转换。
  如果配置文件不存在，则回退到命令行筛选模式。
  输出文件直接放在 task_output 根目录。
  视频模式会先按 1 倍速度导出原始帧，再调用 ffmpeg 合成为视频。
  单个 skeleton+skin+animation 会按 frame-workers 拆分并行出帧。

参数：
  --config         指定配置文件路径
  --format         输出格式：gif / mp4_264 / mp4_265 / webm
  --frame-workers  单任务并行出帧线程数（1-32）
  配置项 skipExistingOutput:
    true  = 目标文件已存在时跳过
    false = 目标文件已存在时重新生成
    未设置时按 overwrite 兼容旧行为
  --skeleton       只处理名称包含该文本的骨骼资源
  --animation      只处理名称包含该文本的动画
  --skin           只处理名称包含该文本的皮肤
  --all-skins      处理全部皮肤
  --list           仅列出可用资源、皮肤、动画
  --overwrite      即使目标文件已存在也重新生成
  --fps            手动指定输出采样帧率
  --scale          读取 Spine 数据时额外缩放，默认 1
  --keep-frames    保留中间 PNG 帧
`);
      process.exit(0);
    }
  }

  return parsed;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
      if (!options.quiet && chunk.trim()) process.stdout.write(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
      if (!options.quiet && chunk.trim()) process.stderr.write(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${command} 执行失败，退出码 ${code}。\n${stderr || stdout || "没有输出信息。"}`,
        ),
      );
    });
  });
}
