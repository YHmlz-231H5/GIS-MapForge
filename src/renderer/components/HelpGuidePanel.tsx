/**
 * HelpGuidePanel — in-app manual: workflow diagram + usage instructions.
 * Opened from header「📖 说明」button. Static layout, no diagram library.
 */

import type { ReactNode } from 'react';

function FlowBox({
  title,
  detail,
  tone = 'default',
}: {
  title: string;
  detail?: string;
  tone?: 'default' | 'network' | 'local' | 'output';
}) {
  const tones = {
    default: 'border-slate-200 bg-white',
    network: 'border-amber-200 bg-amber-50',
    local: 'border-emerald-200 bg-emerald-50',
    output: 'border-blue-200 bg-blue-50',
  };
  return (
    <div className={`rounded-lg border px-3 py-2 text-center ${tones[tone]}`}>
      <div className="text-xs font-medium text-slate-800">{title}</div>
      {detail && <div className="text-[10px] text-slate-500 mt-0.5 leading-snug">{detail}</div>}
    </div>
  );
}

function FlowArrow({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center py-1 text-slate-400">
      <span className="text-sm leading-none">↓</span>
      {label && <span className="text-[10px] text-slate-500 mt-0.5">{label}</span>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="font-medium text-base text-slate-800">{title}</h3>
      {children}
    </section>
  );
}

export function HelpGuidePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-3xl max-h-[88vh] overflow-y-auto rounded-lg shadow-xl thin-scroll"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="help-guide-title"
      >
        <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-white z-10">
          <h2 id="help-guide-title" className="text-lg font-semibold">
            📖 使用说明
          </h2>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-800 px-2"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-6 text-sm text-slate-700">
          {/* Positioning */}
          <Section title="这是什么？">
            <p className="text-xs text-slate-600 leading-relaxed">
              地图下载器用于在<strong>联网</strong>条件下，选定区域后下载 OpenStreetMap 矢量数据，
              并在本机用 Planetiler 生成 <code className="text-[11px] bg-slate-100 px-1 rounded">.pmtiles</code>{' '}
              离线瓦片包。底图预览、区域搜索、数据下载都需要网络；生成的 PMTiles 可在其他离线地图应用中使用。
            </p>
          </Section>

          {/* Quick start */}
          <Section title="快速上手">
            <ol className="text-xs space-y-2 list-decimal list-inside text-slate-600">
              <li>
                <strong className="text-slate-800">左栏</strong>：搜索地名或导入 GeoJSON，确认 bbox 后点{' '}
                <strong className="text-slate-800">「下载数据」</strong>，选择矢量 OSM 或栅格瓦片。
              </li>
              <li>
                矢量完成后在<strong className="text-slate-800">右栏</strong>点{' '}
                <strong className="text-slate-800">「生成矢量瓦片」</strong>（PMTiles / MBTiles · 标准 /
                自定义）。
              </li>
              <li>
                转换完成后点<strong className="text-slate-800">「打开文件夹」</strong>找到{' '}
                <code className="bg-slate-100 px-1 rounded">.pmtiles</code>，或点{' '}
                <strong className="text-slate-800">「预览」</strong>在应用内用 MapLibre 验证。
              </li>
              <li>
                可在<strong className="text-slate-800">⚙ 设置</strong>中修改输出目录、MapTiler Key、Java 内存等。
              </li>
            </ol>
          </Section>

          <Section title="下载源说明">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3 text-xs text-slate-600">
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2">
                <div className="font-medium text-slate-800">默认下载源：Overpass</div>
                <div className="mt-1 leading-relaxed">
                  适合按当前框选区域下载。应用会把 bbox 切成小块，从 Overpass 镜像抓取 OSM XML，
                  最终得到 <code className="bg-white px-1 rounded">.osm</code> 文件。
                </div>
              </div>

              <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2">
                <div className="font-medium text-slate-800">备选下载源：Geofabrik</div>
                <div className="mt-1 leading-relaxed">
                  适合你已经有一个明确的区域数据包链接时直接下载，例如国家、省、州等现成提取包。
                  下载结果通常是 <code className="bg-white px-1 rounded">.osm.pbf</code>，
                  不需要先走 Overpass 的分块抓取。
                </div>
              </div>

              <ul className="list-disc list-inside space-y-1">
                <li>想按地图框选任意区域下载：优先用 Overpass。</li>
                <li>想直接下载现成的大区包：用 Geofabrik 直链更合适。</li>
                <li>当前 UI 主路径默认走 Overpass；Geofabrik 属于已支持的备选路径。</li>
              </ul>
            </div>
          </Section>

          {/* Flow diagram */}
          <Section title="数据流程（主路径）">
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 max-w-md mx-auto">
              <FlowBox title="① 选区域 + 在线底图" detail="Photon 搜索 · 需联网" tone="network" />
              <FlowArrow label="下载 OSM（Overpass）" />
              <FlowBox
                title="② Overpass 分块下载"
                detail="国内常用镜像 · 输出 .osm (XML)"
                tone="network"
              />
              <FlowArrow label="写入输出目录" />
              <FlowBox title="③ .osm 文件" detail="与 .osm.pbf 数据等价，体积更大" />
              <FlowArrow label="任务完成 → 生成矢量瓦片（PMTiles / MBTiles）" />
              <FlowBox title="④ 本地转 .osm.pbf" detail="仅当输入为 XML 时" tone="local" />
              <FlowArrow />
              <FlowBox title="⑤ Planetiler (Java)" detail="本地运行 · 不需外网" tone="local" />
              <FlowArrow />
              <FlowBox title="⑥ .pmtiles / .mbtiles" detail="离线矢量瓦片包" tone="output" />
            </div>

            <div className="mt-3 rounded-lg border border-dashed border-slate-300 p-3 text-[11px] text-slate-600 space-y-2">
              <div className="font-medium text-slate-700">备选路径（代码已支持，适合明确下载链接时使用）</div>
              <div className="flex flex-wrap gap-2 items-center">
                <span className="px-2 py-1 rounded bg-white border text-[10px]">
                  Geofabrik 直链 → .osm.pbf
                </span>
                <span className="text-slate-400">适合现成区域包 · 需稳定国际 HTTPS</span>
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <span className="px-2 py-1 rounded bg-white border text-[10px]">
                  XYZ 栅格瓦片 → PNG 目录
                </span>
                <span className="text-slate-400">Phase 2 · 与 PMTiles 流程独立</span>
              </div>
            </div>
          </Section>

          {/* Network & format */}
          <Section title="网络与格式说明">
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-left">
                    <th className="border border-slate-200 px-2 py-1.5 font-medium">场景</th>
                    <th className="border border-slate-200 px-2 py-1.5 font-medium">下载来源</th>
                    <th className="border border-slate-200 px-2 py-1.5 font-medium">得到格式</th>
                  </tr>
                </thead>
                <tbody className="text-slate-600">
                  <tr>
                    <td className="border border-slate-200 px-2 py-1.5">国内 / 不稳定网络（默认）</td>
                    <td className="border border-slate-200 px-2 py-1.5">
                      Overpass 镜像
                      <span className="block text-[10px] text-slate-400">
                        api.openstreetmap.org 常不可用
                      </span>
                    </td>
                    <td className="border border-slate-200 px-2 py-1.5 font-mono">.osm</td>
                  </tr>
                  <tr>
                    <td className="border border-slate-200 px-2 py-1.5">稳定国际连接</td>
                    <td className="border border-slate-200 px-2 py-1.5">Geofabrik 等国家/区域包</td>
                    <td className="border border-slate-200 px-2 py-1.5 font-mono">.osm.pbf</td>
                  </tr>
                  <tr>
                    <td className="border border-slate-200 px-2 py-1.5">生成矢量瓦片</td>
                    <td className="border border-slate-200 px-2 py-1.5">本机 Planetiler</td>
                    <td className="border border-slate-200 px-2 py-1.5 font-mono">.pmtiles / .mbtiles</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-500 mt-2">
              <code className="bg-slate-100 px-1 rounded">.osm</code> 与{' '}
              <code className="bg-slate-100 px-1 rounded">.osm.pbf</code>{' '}
              包含相同的 OSM 要素；PBF 是压缩二进制，更小更快。本应用在生成矢量瓦片前会自动把 XML 转为 PBF。
            </p>
          </Section>

          {/* Prerequisites */}
          <Section title="运行依赖">
            <ul className="text-xs space-y-1.5 text-slate-600 list-disc list-inside">
              <li>
                顶栏 <strong>Java ✓</strong>：需安装 JDK 21+，且 <code className="bg-slate-100 px-1 rounded">java</code>{' '}
                在 PATH 中。
              </li>
              <li>
                顶栏 <strong>Planetiler ✓</strong>：将 <code className="bg-slate-100 px-1 rounded">planetiler.jar</code>{' '}
                放在项目 <code className="bg-slate-100 px-1 rounded">tools/</code> 目录。
              </li>
              <li>
                小区域建议 Java heap 4g；大区域（如整省）在设置中选 6g 或 8g。
              </li>
            </ul>
          </Section>

          {/* Map & output */}
          <Section title="底图与输出">
            <ul className="text-xs space-y-1.5 text-slate-600 list-disc list-inside">
              <li>
                中间地图为<strong>在线底图</strong>，仅用于选区预览；左上角可切换<strong>矢量地图</strong>（4 源）或
                <strong>栅格地图</strong>（8 源，含卫星影像与街道栅格，不再按国内/国外筛选）。
              </li>
              <li>
                「输出目录」同时用于 <code className="bg-slate-100 px-1 rounded">.osm</code> 下载与{' '}
                <code className="bg-slate-100 px-1 rounded">.pmtiles</code>；留空则使用{' '}
                <code className="bg-slate-100 px-1 rounded text-[10px]">userData/output/</code>。
              </li>
              <li>下载进行中，地图上会显示分块网格：红色待下、绿色完成、橙色失败。</li>
            </ul>
          </Section>

          {/* FAQ */}
          <Section title="常见问题">
            <dl className="text-xs space-y-3">
              <div>
                <dt className="font-medium text-slate-800">下载失败 / fetch failed？</dt>
                <dd className="text-slate-600 mt-0.5">
                  多为网络问题。国内环境已改用 Overpass 镜像；若仍失败，可缩小区域或稍后重试。查看任务卡片「日志」了解详情。
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-800">为什么按钮写的是「下载 OSM」而不是 PBF？</dt>
                <dd className="text-slate-600 mt-0.5">
                  当前默认路径通过 Overpass 得到 XML 格式的 .osm 文件；生成 PMTiles 时会在本地自动转为 PBF。
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-800">PMTiles 生成很慢？</dt>
                <dd className="text-slate-600 mt-0.5">
                  Planetiler 是 CPU/内存密集型本地任务，区域越大、zoom 越高耗时越长。可在图层设置中适当降低 max zoom。
                </dd>
              </div>
            </dl>
          </Section>
        </div>

        <div className="p-4 border-t sticky bottom-0 bg-white">
          <button
            onClick={onClose}
            className="w-full px-4 py-2.5 bg-slate-100 hover:bg-slate-200 rounded font-medium text-sm"
          >
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}
