import { spawn, execFile } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { promisify } from 'util';
import { app } from 'electron';
import type { HandlerFn, LogPusher } from './_types';
import { Config } from '../../db';
import { ensurePlanetilerAuxSources } from './planetiler-aux';
import { convertOsmXmlToPbf } from './osm-xml-to-pbf';
import { resolveOutputDir } from '../../paths';
import {
  buildPlanetilerCliFlags,
  createDefaultPlanetilerForm,
  normalizeConvertMode,
  normalizeArchiveFormat,
  archiveExtension,
  type PlanetilerConvertForm,
} from '../../../shared/planetiler-options';
import { slugifyRegionName } from '../../../shared/slugify';

const execFileP = promisify(execFile);

/**
 * Spawn Planetiler + OpenMapTiles profile.
 *
 * Expects options.osm_path (absolute path to .osm or .osm.pbf from a prior
 * download task). Falls back to task.output_path if set.
 * XML inputs are converted to .osm.pbf first (Planetiler only reads PBF).
 */
export const execPlanetilerConvert: HandlerFn = async (task, abort, pushLog) => {
  const java = await detectJava(pushLog);
  if (!java) throw new Error('Java not found — install JDK 21+ and ensure `java` is on PATH');

  const jar = await detectPlanetilerJar(pushLog);
  if (!jar) throw new Error('planetiler.jar not found — place it at tools/planetiler.jar');

  let osmPath = task.options.osm_path || task.output_path || null;
  if (!osmPath || !existsSync(osmPath)) {
    throw new Error(
      `OSM input missing. Pass options.osm_path from a completed download task (got: ${osmPath ?? 'undefined'})`
    );
  }

  if (osmPath.endsWith('.osm') && !osmPath.endsWith('.osm.pbf')) {
    const pbfPath = osmPath + '.pbf';
    pushLog('out', `[planetiler] converting XML → PBF: ${pbfPath}`);
    const stats = await convertOsmXmlToPbf(osmPath, pbfPath);
    pushLog(
      'out',
      `[planetiler] converted ${stats.nodes}n/${stats.ways}w/${stats.relations}r → ${stats.bytes} bytes`
    );
    osmPath = pbfPath;
  }

  const form = resolveConvertForm(task);
  const downloadAux = form.download_aux;

  const downloadDir = resolve(process.cwd(), 'data', 'sources');
  if (downloadAux) {
    pushLog('out', '[planetiler] ensuring auxiliary sources (via curl/Node)...');
    await ensurePlanetilerAuxSources(downloadDir, pushLog);
  }

  const outputDir = resolveOutputDir();
  mkdirSync(outputDir, { recursive: true });

  const ext = archiveExtension(form.archive_format);
  const baseName = slugifyRegionName(task.region.name, {
    bbox: task.region.bbox,
    fallbackId: task.id,
  });
  let filename = task.options.planetiler?.output_filename;
  if (filename) {
    filename = filename.replace(/\.(pmtiles|mbtiles)$/i, '') + ext;
  } else {
    filename = `${baseName}${ext}`;
  }
  // Avoid overwriting an existing archive with a blank-looking collision.
  let outputPath = resolve(outputDir, filename);
  if (!task.options.planetiler?.output_filename && existsSync(outputPath)) {
    const stem = filename.replace(/\.(pmtiles|mbtiles)$/i, '');
    filename = `${stem}-${task.id.slice(0, 6)}${ext}`;
    outputPath = resolve(outputDir, filename);
  }
  mkdirSync(dirname(outputPath), { recursive: true });

  const cliFlags = buildPlanetilerCliFlags({
    form,
    osmPath,
    outputPath,
    downloadDir,
  });

  const args = [`-Xmx${form.java_heap}`, '-jar', jar.path, ...cliFlags];

  pushLog('out', `[planetiler] mode=${form.mode} archive=${form.archive_format}`);
  pushLog('out', `[planetiler] java=${java}`);
  pushLog('out', `[planetiler] osm=${osmPath}`);
  pushLog('out', `[planetiler] out=${outputPath}`);
  pushLog('out', `$ ${java} ${args.join(' ')}`);
  console.log('[planetiler]', java, args.join(' '));

  return new Promise((resolve_p, reject) => {
    const child = spawn(java, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let killed = false;
    abort.addEventListener('abort', () => {
      pushLog('err', '[abort] SIGTERM sent to planetiler');
      child.kill('SIGTERM');
      killed = true;
      setTimeout(() => child.kill('SIGKILL'), 5000);
    });

    child.stdout.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) pushLog('out', line);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) {
          const isErr = /\b(ERROR|Exception|FATAL)\b/i.test(line);
          pushLog(isErr ? 'err' : 'out', line);
        }
      }
    });
    child.on('close', (code) => {
      if (killed) return reject(new Error('Task cancelled'));
      if (code === 0) {
        if (existsSync(outputPath)) {
          resolve_p({ output_path: outputPath });
        } else {
          reject(new Error(`Planetiler exit 0 but output ${outputPath} missing`));
        }
      } else {
        reject(new Error(`Planetiler exited with code ${code}`));
      }
    });
    child.on('error', (err) => reject(err));
  });
};

function resolveConvertForm(task: Parameters<HandlerFn>[0]): PlanetilerConvertForm {
  const bbox = task.options.planetiler?.bbox_clip ?? task.region.bbox;
  const fromForm = task.options.planetiler_form;
  if (fromForm) {
    const mode = normalizeConvertMode(fromForm.mode);
    const archive_format = normalizeArchiveFormat(fromForm.archive_format);
    // Standard mode: community defaults + chosen archive format + bbox.
    if (mode === 'standard') {
      return createDefaultPlanetilerForm(bbox, { mode: 'standard', archive_format });
    }
    return {
      ...createDefaultPlanetilerForm(bbox),
      ...fromForm,
      bbox_clip: fromForm.bbox_clip ?? bbox,
      mode: 'custom',
      archive_format,
    };
  }

  // Legacy tasks that only set planetiler.zoom_* / java_heap
  const legacy = task.options.planetiler;
  return createDefaultPlanetilerForm(bbox, {
    mode: 'standard',
    maxzoom: legacy?.zoom_max ?? 14,
    minzoom: legacy?.zoom_min ?? 0,
    java_heap:
      legacy?.java_heap ||
      (Config.get('default_java_heap') as string) ||
      '6g',
    download_aux: legacy?.download_aux !== false,
  });
}

async function detectJava(pushLog: LogPusher): Promise<string | null> {
  const candidates = [
    'java',
    'C:\\Program Files (x86)\\jdk\\bin\\java.exe',
    'C:\\Program Files\\Eclipse Adoptium\\jdk-21\\bin\\java.exe',
    'C:\\Program Files\\Java\\jdk-21\\bin\\java.exe',
  ];
  for (const cmd of candidates) {
    try {
      await execFileP(cmd, ['-version'], { timeout: 5000, windowsHide: true });
      return cmd;
    } catch {
      // try next
    }
  }
  pushLog('err', 'Java not found');
  return null;
}

async function detectPlanetilerJar(pushLog: LogPusher): Promise<{ path: string } | null> {
  const candidates = [
    resolve(process.cwd(), 'tools', 'planetiler.jar'),
    join(app.getAppPath(), 'tools', 'planetiler.jar'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return { path: p };
  }
  pushLog('err', 'planetiler.jar not found');
  return null;
}
