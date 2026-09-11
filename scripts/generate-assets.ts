import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetRoot = resolve(projectRoot, "public/assets");
const ink = "#131820";
const paper = "#edf0e9";
const lime = "#d9f15c";
const cyan = "#80d5e7";
const amber = "#ffc765";
const muted = "#899397";
const red = "#f06877";

interface IconDefinition {
  id: string;
  purpose: string;
  referenceId: string;
  paths: string;
  representative?: boolean;
  firstProfile?: "M1" | "M2" | "M3" | "M4";
}

const check = `<path d="m46 67 12 12 26-29" fill="none" stroke="${ink}" stroke-width="8" stroke-linecap="square" stroke-linejoin="miter"/>`;
const face = (expression: "idle" | "move" | "hurt") => `
  <path d="M33 53V25c0-9 15-9 16 0l3 23m24 0 3-27c1-9 16-8 16 1v35" fill="${paper}" stroke="${ink}" stroke-width="6" stroke-linejoin="round"/>
  <path d="M40 25v19m47-20-2 20" stroke="${muted}" stroke-width="5"/>
  <path d="M38 50Q64 42 90 50l11 43-15 12H42L27 92Z" fill="${paper}" stroke="${ink}" stroke-width="6" stroke-linejoin="round"/>
  <rect x="36" y="61" width="56" height="28" rx="13" fill="${ink}"/>
  ${expression === "hurt" ? `<path d="m45 68 12 12m0-12L45 80m26-12 12 12m0-12L71 80" stroke="${red}" stroke-width="4"/>` : `<rect x="47" y="67" width="8" height="16" rx="4" fill="${paper}"/><rect x="73" y="67" width="8" height="16" rx="4" fill="${paper}"/>`}
  <path d="M55 96h18" stroke="${ink}" stroke-width="4"/>
  ${expression === "move" ? `<path d="m11 68 9 7-9 7m95-7h11" fill="none" stroke="${amber}" stroke-width="5" stroke-linecap="round"/>` : ""}`;

const icons: IconDefinition[] = [
  {
    id: "player-idle",
    purpose: "玩家：静止；以双耳与双眼识别当前格",
    referenceId: "AR-A-MAZE",
    representative: true,
    paths: face("idle"),
  },
  {
    id: "player-move",
    purpose: "玩家：有效移动的短反馈",
    referenceId: "AR-A-MAZE",
    paths: face("move"),
  },
  {
    id: "player-hurt",
    purpose: "玩家：受损的短反馈",
    referenceId: "AR-A-MAZE",
    paths: face("hurt"),
  },
  {
    id: "unknown",
    purpose: "未知电视格；未显露前不泄露机关类型",
    referenceId: "AR-CENTER",
    representative: true,
    paths: `<path d="M32 42c0-14 12-23 30-23 21 0 34 10 34 25 0 11-5 18-18 25-8 4-11 9-11 15H51c0-13 4-20 15-27 9-5 12-8 12-13 0-6-6-10-15-10-10 0-16 5-16 13Z" fill="${muted}"/><path d="M50 94h19v17H50Z" fill="${muted}"/>`,
  },
  {
    id: "enrichment-ready",
    purpose: "富集节点：可用增幅仪",
    referenceId: "AR-A-EXPLORATION",
    representative: true,
    paths: `<circle cx="64" cy="64" r="43" fill="none" stroke="${paper}" stroke-width="5"/><circle cx="64" cy="64" r="30" fill="none" stroke="${paper}" stroke-width="3"/><path d="m64 21 10 28 30 15-30 10-10 33-10-32-31-11 30-15Z" fill="${amber}" stroke="${ink}" stroke-width="5"/><circle cx="64" cy="64" r="8" fill="${paper}"/>`,
  },
  {
    id: "enrichment-used",
    purpose: "富集节点：已清除，保留空环与勾",
    referenceId: "AR-A-EXPLORATION",
    paths: `<circle cx="64" cy="64" r="40" fill="none" stroke="${muted}" stroke-width="5"/>${check.replace(ink, muted)}`,
  },
  {
    id: "data-ready",
    purpose: "必需数据：可取得；三格电路芯片",
    referenceId: "AR-CENTER",
    representative: true,
    paths: `<path d="M33 25h47l18 18v60H33Z" fill="${cyan}" stroke="${ink}" stroke-width="6" stroke-linejoin="round"/><path d="M79 25v20h19" fill="none" stroke="${ink}" stroke-width="5"/><path d="M46 53h22v22H46Zm0 32h39M77 58h8m-8 13h8" fill="none" stroke="${ink}" stroke-width="5"/>`,
  },
  {
    id: "data-collected",
    purpose: "必需数据：已取得；保留轮廓与勾",
    referenceId: "AR-CENTER",
    paths: `<path d="M33 25h47l18 18v60H33Z" fill="none" stroke="${muted}" stroke-width="6" stroke-linejoin="round"/>${check.replace(ink, muted)}`,
  },
  {
    id: "supply-ready",
    purpose: "物资箱：可领取；箱体与锁扣",
    referenceId: "AR-A-EXPLORATION",
    representative: true,
    paths: `<path d="M45 37V26h38v11" fill="none" stroke="${paper}" stroke-width="7" stroke-linejoin="round"/><path d="M23 37h82v66H23Z" fill="${amber}" stroke="${ink}" stroke-width="6" stroke-linejoin="round"/><path d="M23 61h82M40 38v64m48-64v64" stroke="${ink}" stroke-width="5"/><path d="M55 53h18v19H55Z" fill="${paper}" stroke="${ink}" stroke-width="4"/>`,
  },
  {
    id: "supply-collected",
    purpose: "物资箱：已领取；空箱与勾",
    referenceId: "AR-A-EXPLORATION",
    paths: `<path d="m24 48 13-20h55l13 20-13 11H37Zm0 12v43h81V60" fill="none" stroke="${muted}" stroke-width="5"/>${check.replace(ink, muted)}`,
  },
  {
    id: "portal-ready",
    purpose: "区域传送：已开放；双向箭头与圆环",
    referenceId: "AR-CENTER",
    representative: true,
    paths: `<circle cx="64" cy="64" r="42" fill="none" stroke="${paper}" stroke-width="6"/><path d="M36 51h51L73 37m14 14L73 65M92 79H41l14 14M41 79l14-14" fill="none" stroke="${cyan}" stroke-width="8" stroke-linejoin="miter"/>`,
  },
  {
    id: "portal-locked",
    purpose: "区域传送：尚未开放；圆环与锁",
    referenceId: "AR-CENTER",
    paths: `<circle cx="64" cy="64" r="42" fill="none" stroke="${muted}" stroke-width="5" stroke-dasharray="8 6"/><path d="M50 59V47a14 14 0 0 1 28 0v12" fill="none" stroke="${muted}" stroke-width="6"/><rect x="43" y="58" width="42" height="32" rx="4" fill="${muted}"/><path d="M64 66v15" stroke="${ink}" stroke-width="5"/>`,
  },
  {
    id: "terminal-ready",
    purpose: "主路径终端：可交互；键盘与大箭头",
    referenceId: "AR-CENTER",
    representative: true,
    paths: `<rect x="25" y="24" width="78" height="58" rx="5" fill="${lime}" stroke="${ink}" stroke-width="6"/><path d="m39 41 12 10-12 10m23 0h22" fill="none" stroke="${ink}" stroke-width="6"/><path d="m25 84-9 21h96l-9-21" fill="${paper}" stroke="${ink}" stroke-width="6" stroke-linejoin="round"/><path d="M47 95h34" stroke="${ink}" stroke-width="4"/>`,
  },
  {
    id: "terminal-complete",
    purpose: "主路径终端：已完成；同轮廓与勾",
    referenceId: "AR-CENTER",
    paths: `<rect x="25" y="24" width="78" height="70" rx="5" fill="none" stroke="${muted}" stroke-width="6"/><path d="M16 105h96" stroke="${muted}" stroke-width="6"/>${check.replace(ink, muted)}`,
  },
  {
    id: "hazard-safe",
    purpose: "危险格：观察期或当前安全；斜条轮廓",
    referenceId: "AR-A-MAZE",
    paths: `<path d="M24 32h80v65H24Z" fill="none" stroke="${muted}" stroke-width="5"/><path d="m27 74 43-39m-3 59 34-31" stroke="${muted}" stroke-width="6"/>`,
  },
  {
    id: "hazard-active",
    purpose: "危险格：生效；三角警号与斜条",
    referenceId: "AR-A-MAZE",
    paths: `<path d="m64 18 48 89H16Z" fill="${red}" stroke="${ink}" stroke-width="6" stroke-linejoin="round"/><path d="M60 44h8l-1 31h-6Z" fill="${ink}"/><circle cx="64" cy="88" r="5" fill="${ink}"/>`,
  },
  {
    id: "observation",
    purpose: "观察：放大镜与圆点；可见状态提示",
    referenceId: "AR-A-MAZE",
    paths: `<circle cx="57" cy="55" r="31" fill="none" stroke="${paper}" stroke-width="8"/><path d="m80 79 27 27" stroke="${paper}" stroke-width="12"/><path d="M35 55q22-27 44 0-22 27-44 0" fill="${cyan}"/><circle cx="57" cy="55" r="8" fill="${ink}"/>`,
  },
  {
    id: "door-closed",
    purpose: "门：关闭；横杠与锁孔",
    referenceId: "AR-A-EXPLORATION",
    paths: `<path d="M29 18h70v94H29Z" fill="${muted}" stroke="${ink}" stroke-width="6"/><path d="M64 18v94M19 59h90" stroke="${ink}" stroke-width="7"/><rect x="53" y="49" width="22" height="25" rx="4" fill="${amber}"/><path d="M64 55v13" stroke="${ink}" stroke-width="4"/>`,
  },
  {
    id: "door-open",
    purpose: "门：开放；外框与通行箭头",
    referenceId: "AR-A-EXPLORATION",
    paths: `<path d="M29 112V18h70v94M29 19l-14 9v73l14 11m70-93 14 9v73l-14 11" fill="none" stroke="${muted}" stroke-width="5"/><path d="M42 66h44L72 52m14 14L72 80" fill="none" stroke="${lime}" stroke-width="7"/>`,
  },
  {
    id: "checkpoint",
    purpose: "安全检查点；旗杆与菱形",
    referenceId: "AR-A-EXPLORATION",
    paths: `<path d="M34 110V21h60l-9 19 9 20H34" fill="${cyan}" stroke="${ink}" stroke-width="6" stroke-linejoin="round"/><path d="m59 30 10 10-10 10-10-10Z" fill="${ink}"/><path d="M20 109h30" stroke="${paper}" stroke-width="6"/>`,
  },
  {
    id: "firewall",
    purpose: "防火墙挑战：音符与方形节拍边框",
    referenceId: "AR-A-FIREWALL",
    paths: `<path d="M18 38V21h17m58 0h17v17m0 52v17H93m-58 0H18V90" fill="none" stroke="${paper}" stroke-width="6"/><path d="M56 83V37l39-8v45" fill="none" stroke="${amber}" stroke-width="8"/><ellipse cx="44" cy="85" rx="16" ry="12" fill="${amber}"/><ellipse cx="83" cy="76" rx="16" ry="12" fill="${amber}"/>`,
  },
  {
    id: "antivirus",
    purpose: "杀毒挑战入口：盾牌与像素十字",
    referenceId: "AR-B-ANTIVIRUS",
    firstProfile: "M2",
    paths: `<path d="m64 18 39 16v30c0 21-18 37-39 47-21-10-39-26-39-47V34Z" fill="${cyan}" stroke="${ink}" stroke-width="6"/><path d="M57 41h14v15h15v14H71v15H57V70H42V56h15Z" fill="${ink}"/><path d="M16 25h-5v16m101 44h5v17" fill="none" stroke="${paper}" stroke-width="5"/>`,
  },
  {
    id: "target-blue",
    purpose: "蓝色侵蚀目标：四方像素十字；与紫色双菱形区分",
    referenceId: "AR-B-ANTIVIRUS",
    firstProfile: "M2",
    paths: `<path d="m64 19 45 45-45 45-45-45Z" fill="${cyan}" stroke="${paper}" stroke-width="5"/><path d="M55 35h18v20h20v18H73v20H55V73H35V55h20Z" fill="${ink}"/><path d="M19 23h-7v7m91 72h11v-11" fill="none" stroke="${cyan}" stroke-width="4"/>`,
  },
  {
    id: "target-purple",
    purpose: "紫色逃逸目标：双菱形与速度短线；不只用颜色表达",
    referenceId: "AR-B-ANTIVIRUS",
    firstProfile: "M2",
    paths: `<path d="m78 19 35 36-35 36-35-36Z" fill="#c59ae9" stroke="${paper}" stroke-width="5"/><path d="m53 42 35 36-35 36-35-36Z" fill="#c59ae9" stroke="${ink}" stroke-width="6"/><path d="m53 62 15 16-15 16-15-16Z" fill="${ink}"/><path d="M18 30h19M11 41h15m63 56h24" stroke="${paper}" stroke-width="4"/>`,
  },
  {
    id: "target-star",
    purpose: "星星目标：五角星与全清扫光；区别普通数据目标",
    referenceId: "AR-B-ANTIVIRUS",
    firstProfile: "M2",
    paths: `<path d="m64 14 15 32 35 5-25 25 6 36-31-17-31 17 6-36L14 51l35-5Z" fill="${amber}" stroke="${ink}" stroke-width="6"/><path d="m64 40 7 16 17 3-12 12 3 17-15-8-15 8 3-17-12-12 17-3Z" fill="${paper}"/>`,
  },
  {
    id: "station",
    purpose: "信号基站：同心靶环与固定底座；编号由界面叠加",
    referenceId: "AR-C-COMBINED",
    firstProfile: "M3",
    paths: `<ellipse cx="64" cy="96" rx="43" ry="13" fill="${ink}" stroke="${paper}" stroke-width="5"/><path d="M64 51v44M38 65l-8 28m60-28 8 28" stroke="${paper}" stroke-width="6"/><circle cx="64" cy="49" r="28" fill="${cyan}" stroke="${ink}" stroke-width="6"/><circle cx="64" cy="49" r="15" fill="none" stroke="${paper}" stroke-width="5"/><circle cx="64" cy="49" r="5" fill="${ink}"/><path d="M17 30q-9 20 0 39m94-39q9 20 0 39" fill="none" stroke="${cyan}" stroke-width="4"/>`,
  },
  {
    id: "signal-ball",
    purpose: "信号球：圆球与弧形经线；区别逐格推车",
    referenceId: "AR-C-COMBINED",
    firstProfile: "M3",
    paths: `<circle cx="64" cy="64" r="41" fill="${cyan}" stroke="${ink}" stroke-width="6"/><ellipse cx="64" cy="64" rx="22" ry="41" fill="none" stroke="${paper}" stroke-width="5"/><path d="M25 64h78M37 37q27 18 54 0m-54 54q27-18 54 0" fill="none" stroke="${paper}" stroke-width="4"/><circle cx="50" cy="43" r="7" fill="${paper}"/>`,
  },
  {
    id: "cart",
    purpose: "推车：方形车箱与双轮；表达逐格推动对象",
    referenceId: "AR-C-COMBINED",
    firstProfile: "M3",
    paths: `<path d="M16 24h13l12 66h59" fill="none" stroke="${paper}" stroke-width="6"/><path d="M34 38h77l-13 39H41Z" fill="${muted}" stroke="${ink}" stroke-width="6"/><path d="M60 40v36m23-36v36" stroke="${paper}" stroke-width="4"/><circle cx="48" cy="103" r="10" fill="${ink}" stroke="${paper}" stroke-width="5"/><circle cx="92" cy="103" r="10" fill="${ink}" stroke="${paper}" stroke-width="5"/>`,
  },
  {
    id: "data-object",
    purpose: "盗取数据对象：实体八边形芯片；颜色与字母由格子叠加",
    referenceId: "AR-C-THEFT",
    firstProfile: "M3",
    paths: `<path d="M43 20h42l23 23v42l-23 23H43L20 85V43Z" fill="${paper}" stroke="${ink}" stroke-width="6"/><path d="M46 36h36l10 10v36L82 92H46L36 82V46Z" fill="none" stroke="${ink}" stroke-width="5"/><circle cx="64" cy="64" r="15" fill="${ink}"/>`,
  },
  {
    id: "socket",
    purpose: "盗取接收槽：空心括角与八边形孔；区别实体对象",
    referenceId: "AR-C-THEFT",
    firstProfile: "M3",
    paths: `<path d="M18 44V18h26m40 0h26v26m0 40v26H84m-40 0H18V84" fill="none" stroke="${paper}" stroke-width="7"/><path d="M48 33h32l15 15v32L80 95H48L33 80V48Z" fill="none" stroke="${paper}" stroke-width="4" stroke-dasharray="7 5"/>`,
  },
  {
    id: "lamp-lit",
    purpose: "灯：已点亮；灯泡、实心光源与放射短线",
    referenceId: "AR-D-GHOST",
    firstProfile: "M4",
    paths: `<path d="M43 79c-3-10-13-14-13-31a34 34 0 0 1 68 0c0 17-10 21-13 31Z" fill="${amber}" stroke="${ink}" stroke-width="6"/><path d="M43 80h42v15H43Zm6 17h30v11H49Z" fill="${paper}" stroke="${ink}" stroke-width="4"/><path d="M64 77V58m-11-9 11 9 11-9M64 6V1M15 22l-8-7m4 39H2m111-32 8-7m-4 39h9" fill="none" stroke="${paper}" stroke-width="5"/>`,
  },
  {
    id: "lamp-unlit",
    purpose: "灯：未点亮；空心灯泡与斜杠，无放射线",
    referenceId: "AR-D-GHOST",
    firstProfile: "M4",
    paths: `<path d="M43 79c-3-10-13-14-13-31a34 34 0 0 1 68 0c0 17-10 21-13 31Zm0 1h42v15H43Zm6 17h30v11H49Z" fill="none" stroke="${muted}" stroke-width="5"/><path d="m27 101 73-79" stroke="${paper}" stroke-width="6"/>`,
  },
  {
    id: "ghost",
    purpose: "幽灵：深色悬浮轮廓、粉红圆眼与底部静态杂讯",
    referenceId: "AR-D-GHOST",
    firstProfile: "M4",
    paths: `<path d="M25 91V57c0-25 15-40 39-40s39 15 39 40v36l-13-8-13 13-13-11-13 11-13-13Z" fill="${ink}" stroke="#4c3f58" stroke-width="4"/><circle cx="47" cy="58" r="10" fill="${red}"/><circle cx="81" cy="58" r="10" fill="${red}"/><circle cx="47" cy="58" r="4" fill="#ffdbe8"/><circle cx="81" cy="58" r="4" fill="#ffdbe8"/><path d="M28 99v9m10-11v15m10-9v8m10-7v13m12-16v13m10-16v12m11-12v15m10-16v10" stroke="${red}" stroke-width="3"/><path d="M32 78v8m65-11v11" stroke="#8b536f" stroke-width="3"/>`,
  },
];

const references = {
  "AR-CENTER": "https://i.17173cdn.com/2fhnvk/YWxqaGBf/cms3/zbYtPAbsfCnFwns.jpg!a-3-854x.jpg",
  "AR-A-EXPLORATION":
    "https://i.17173cdn.com/2fhnvk/YWxqaGBf/cms3/WBRhEPbsfCnFwmw.jpg!a-3-854x.jpg",
  "AR-A-MAZE": "https://img.game8.jp/10416118/7024cc093a8e3f064101bf37e09703db.jpeg/original",
  "AR-A-FIREWALL": "https://img.game8.jp/10416126/90d0be6152e66b41e8d600a6033fe4ae.jpeg/original",
  "AR-B-ANTIVIRUS": "https://img.game8.jp/10419120/602cc237bdd8cf72a9ee0dcaa63dc430.jpeg/original",
  "AR-C-COMBINED": "https://img1.ali213.net/glpic/2024/08/23/584_2024082342229370.png",
  "AR-C-THEFT": "https://img.game8.jp/10422394/1517f985085bd4dd2888455995c57349.jpeg/original",
  "AR-D-GHOST": "https://img.game8.jp/10425919/85aab7d6be2de4425b7488e92ef92fd5.jpeg/original",
};

function describeIconDifferences(id: string): string {
  if (id.startsWith("player"))
    return "参考中为白底牌上的深色双耳头像与白色圆眼；本版为透明底、白色外壳与黑色面板，眼形及耳部比例有差异；移动及受损帧是新绘状态";
  if (id.startsWith("enrichment"))
    return "保留圆形富集指示的视觉职责，改用四角星与双环；已用状态加勾；未匹配原图的涡旋纹样";
  if (id.startsWith("supply"))
    return "原画面为橙色斜置物资箱；本版使用正立箱体、提手及锁扣；领取后使用空箱轮廓";
  if (id === "data-object" || id === "socket")
    return "原盗取画面中数据对象为圆形核与多边形外框；本版以实体八边芯片/虚线空心槽明确区分，颜色和字母由游戏格子提供，不依赖单一颜色";
  if (id.startsWith("data"))
    return "对应本版必需数据账本，采用芯片文档符号；原参考只用于构图与屏幕尺度，未证实原版数据节点的单项图标映射";
  if (id.startsWith("portal"))
    return "本版用双向箭头/锁区分可用与未开；原作区域标牌及返回花形图标未逐像素复现";
  if (id.startsWith("terminal"))
    return "主路径终端替代被移除的剧情/战斗节点；设备形状为本版新增，不声称是原作节点图标";
  if (id.startsWith("hazard"))
    return "原作危险主要是整屏粉红亮屏；本版另加三角警号及斜线辅助辨认，屏幕底色由渲染层控制";
  if (id === "unknown")
    return "原参考存在暗屏和反光纹样；本版以问号明确未知，隐藏机关类型，属于可读性差异";
  if (id === "ghost")
    return "匹配原参考的深色本体、粉红双圆眼与下沿杂讯职责；轮廓和静态杂讯为独立补制，未复制原版噪声纹理或动画；不把粉红砖墙当幽灵图形";
  if (id.startsWith("lamp"))
    return "使用灯泡轮廓，已亮为实心光源和光线，未亮为空心与斜杠；未匹配原作灯的完整状态帧；静态差别在减少动态/闪烁时仍存在";
  if (id === "station" || id === "signal-ball" || id === "cart")
    return "原C参考可见圆形球和车体相关格；本版用经线圆球、双轮方车和同心基站独立补制，强调滑行球/逐格车/固定接收点三者差别";
  if (id.startsWith("target"))
    return "蓝色目标参考为倾斜像素团；本版蓝目标为单菱形像素十字、紫目标为双菱形与速度线、星为五角星，确保非颜色编码；没有声称紫/星的原版帧已逐项核对";
  if (id === "antivirus")
    return "本版盾牌与像素十字表示杀毒入口，原参考只支持局部目标与屏幕风格，未匹配原作入口图标";
  return "独立矢量补制与状态辅助符号；未复现原作逐像素图形或原始动画帧";
}

const fullM1 = process.argv.includes("--m1");
const allProfiles = process.argv.includes("--all-profiles");
const profileOrder = ["M1", "M2", "M3", "M4", "M5"] as const;
const profilesStartingAt = (firstProfile: "M1" | "M2" | "M3" | "M4") =>
  profileOrder.slice(profileOrder.indexOf(firstProfile));
const selectedIcons = icons.filter(
  (icon) => allProfiles || (fullM1 && (icon.firstProfile ?? "M1") === "M1") || icon.representative,
);
const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const generatorHash = sha256(readFileSync(fileURLToPath(import.meta.url)));
if (process.argv.includes("--check")) {
  const manifest = JSON.parse(readFileSync(resolve(assetRoot, "manifest.json"), "utf8")) as {
    phase: string;
    assets: Record<string, unknown>[];
  };
  const ids = new Set<string>();
  for (const asset of manifest.assets) {
    assert.equal(typeof asset.id, "string");
    const id = asset.id as string;
    assert(!ids.has(id), `Duplicate asset ID: ${id}`);
    ids.add(id);
    assert(Array.isArray(asset.profiles), `${id}: release profiles`);
    const profiles = asset.profiles as string[];
    assert(profiles.length > 0);
    assert(profiles.every((profile) => profileOrder.some((candidate) => candidate === profile)));
    assert.equal(new Set(profiles).size, profiles.length);
    assert.equal(typeof asset.localPath, "string");
    const localPath = asset.localPath as string;
    assert(localPath.startsWith("/assets/"));
    assert(!localPath.includes(".."));
    const bytes = readFileSync(resolve(projectRoot, "public", localPath.slice(1)));
    assert.equal(sha256(bytes), asset.sha256, `${id}: file checksum`);
    if (asset.kind === "icon") {
      const svg = bytes.toString("utf8");
      assert.match(svg, /^<svg[^>]+width="128" height="128"/);
      assert.doesNotMatch(svg, /<script|(?:href|src)=/);
      assert.equal(asset.sourceSha256, generatorHash, `${id}: regenerate after source changes`);
      if (asset.raster) {
        const raster = asset.raster as { localPath: string; sha256: string; sourceSha256: string };
        assert(raster.localPath.startsWith("/assets/") && !raster.localPath.includes(".."));
        const png = readFileSync(resolve(projectRoot, "public", raster.localPath.slice(1)));
        assert.equal(sha256(png), raster.sha256, `${id}: PNG checksum`);
        assert.equal(raster.sourceSha256, asset.sha256, `${id}: PNG source checksum`);
        assert.equal(png.readUInt32BE(16), 256);
        assert.equal(png.readUInt32BE(20), 256);
        assert.equal(png[25], 6, `${id}: RGBA PNG`);
      }
    } else if (asset.kind === "audio") {
      assert.equal(asset.sourceSha256, generatorHash, `${id}: regenerate after source changes`);
      assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
      assert.equal(bytes.toString("ascii", 8, 12), "WAVE");
      assert.equal(bytes.readUInt16LE(20), 1);
      assert.equal(bytes.readUInt16LE(22), 1);
      assert.equal(bytes.readUInt32LE(24), 44100);
      assert.equal(bytes.readUInt16LE(34), 16);
      assert.equal(bytes.length, bytes.readUInt32LE(4) + 8);
      assert.equal(bytes.length - 44, bytes.readUInt32LE(40));
      assert.equal(bytes.readInt16LE(44), 0);
      assert.equal(bytes.readInt16LE(bytes.length - 2), 0);
      let peak = 0;
      for (let offset = 44; offset < bytes.length; offset += 2) {
        peak = Math.max(peak, Math.abs(bytes.readInt16LE(offset)));
      }
      assert(peak > 0 && peak < 32767, `${id}: audible and unclipped`);
    } else if (asset.kind === "font") {
      assert.equal(bytes.toString("ascii", 0, 4), "wOF2");
      assert.equal(typeof asset.licenseLocalPath, "string");
      const license = readFileSync(
        resolve(projectRoot, "public", (asset.licenseLocalPath as string).slice(1)),
        "utf8",
      );
      assert.match(license, /SIL OPEN FONT LICENSE/);
    } else {
      throw new Error(`Unsupported asset kind: ${String(asset.kind)}`);
    }
  }
  process.stdout.write(
    `Asset check passed: ${manifest.assets.length} records (${manifest.phase}).\n`,
  );
  process.exit(0);
}
interface Rasterizer {
  (
    input: Buffer,
    options: { density: number },
  ): {
    resize(width: number, height: number): { png(): { toBuffer(): Promise<Buffer> } };
  };
  versions: { sharp: string; rsvg: string };
}
const sharpModule = process.env.CAMELLIA_ASSET_SHARP_MODULE ?? "sharp";
const rasterizer = process.argv.includes("--png")
  ? ((await import(sharpModule)) as { default: Rasterizer }).default
  : undefined;
mkdirSync(resolve(assetRoot, "icons"), { recursive: true });
mkdirSync(resolve(assetRoot, "audio"), { recursive: true });

const generatedAssets: Record<string, unknown>[] = [];
for (const icon of selectedIcons) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><g stroke-linecap="round" stroke-linejoin="round">${icon.paths}</g></svg>\n`;
  const path = `icons/${icon.id}.svg`;
  writeFileSync(resolve(assetRoot, path), svg);
  let raster: Record<string, unknown> | undefined;
  if (rasterizer) {
    const png = await rasterizer(Buffer.from(svg), { density: 144 })
      .resize(256, 256)
      .png()
      .toBuffer();
    const pngPath = `icons/${icon.id}.png`;
    writeFileSync(resolve(assetRoot, pngPath), png);
    raster = {
      localPath: `/assets/${pngPath}`,
      sha256: sha256(png),
      sourceSha256: sha256(svg),
      dimensions: [256, 256],
      transform: `SVG rasterized by Sharp ${rasterizer.versions.sharp} / librsvg ${rasterizer.versions.rsvg}; transparent RGBA PNG; 2× logical resolution`,
    };
  }
  generatedAssets.push({
    id: icon.id,
    kind: "icon",
    purpose: icon.purpose,
    profiles: profilesStartingAt(icon.firstProfile ?? "M1"),
    status: "补制",
    localPath: `/assets/${path}`,
    sourcePath: "scripts/generate-assets.ts",
    sourceUrl: null,
    sourceVersion: "camellia-assets-v1",
    sourceSha256: generatorHash,
    sha256: sha256(svg),
    dimensions: [128, 128],
    raster,
    author: "为 camellia-golden-week 制作的项目资源",
    rights: "独立矢量补制；不含候选库提取像素；游戏角色与名称权利仍属原权利人",
    usage: "随本项目本地打包；不是已确认的原版资源",
    transform: "确定性 SVG 几何；128×128 viewBox；透明背景；不裁切原图",
    referenceId: icon.referenceId,
    referenceUrl: references[icon.referenceId as keyof typeof references],
    differences: describeIconDifferences(icon.id),
  });
}

interface ToneDefinition {
  id: string;
  duration: number;
  frequencies: number[];
  purpose: string;
}
const tones: ToneDefinition[] = [
  { id: "move", duration: 0.07, frequencies: [180, 310], purpose: "有效移动的轻短脉冲" },
  { id: "invalid", duration: 0.1, frequencies: [115, 90], purpose: "无效动作；由音频适配器限频" },
  {
    id: "pickup",
    duration: 0.24,
    frequencies: [523.25, 783.99, 1046.5],
    purpose: "物资或数据领取",
  },
  { id: "reveal", duration: 0.18, frequencies: [330, 440, 660], purpose: "隐藏格显露" },
  {
    id: "amplify",
    duration: 0.36,
    frequencies: [164.81, 329.63, 659.25, 987.77],
    purpose: "增幅仪启动",
  },
  { id: "door", duration: 0.19, frequencies: [220, 330], purpose: "门或主路径开放" },
  {
    id: "success",
    duration: 0.52,
    frequencies: [523.25, 659.25, 783.99, 1046.5],
    purpose: "挑战成功或区段完成",
  },
  {
    id: "failure",
    duration: 0.32,
    frequencies: [293.66, 220, 146.83],
    purpose: "挑战失败；可立即重试",
  },
  { id: "portal", duration: 0.34, frequencies: [220, 440, 880], purpose: "区域或房间切换" },
  {
    id: "beat",
    duration: 0.045,
    frequencies: [880],
    purpose: "防火墙有效时间拍点；适配器按时钟调度",
  },
];

for (const tone of tones) {
  const sampleRate = 44100;
  const samples = Math.round(tone.duration * sampleRate);
  const pcm = Buffer.alloc(samples * 2);
  let phase = 0;
  for (let sample = 0; sample < samples; sample += 1) {
    const progress = sample / samples;
    const noteIndex = Math.min(
      tone.frequencies.length - 1,
      Math.floor(progress * tone.frequencies.length),
    );
    const noteProgress = (progress * tone.frequencies.length) % 1;
    const frequency = tone.frequencies[noteIndex] ?? 440;
    phase += (2 * Math.PI * frequency) / sampleRate;
    const envelope =
      Math.min(1, sample / (sampleRate * 0.004)) *
      Math.min(1, (samples - sample - 1) / (sampleRate * 0.012));
    const noteEnvelope = Math.sin(Math.PI * noteProgress) ** 0.45;
    const wave = Math.sin(phase) + 0.22 * Math.sin(phase * 2) + 0.08 * Math.sin(phase * 3);
    const value = Math.round(32767 * 0.24 * wave * envelope * noteEnvelope);
    pcm.writeInt16LE(value, sample * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(pcm.length + 36, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  const wav = Buffer.concat([header, pcm]);
  const path = `audio/${tone.id}.wav`;
  writeFileSync(resolve(assetRoot, path), wav);
  generatedAssets.push({
    id: tone.id,
    kind: "audio",
    purpose: tone.purpose,
    profiles: [...profileOrder],
    status: "补制",
    localPath: `/assets/${path}`,
    sourcePath: "scripts/generate-assets.ts",
    sourceUrl: null,
    sourceVersion: "camellia-assets-v1",
    sourceSha256: generatorHash,
    sha256: sha256(wav),
    durationSeconds: samples / sampleRate,
    sampleRate,
    channels: 1,
    bitDepth: 16,
    author: "为 camellia-golden-week 合成的项目资源",
    rights: "独立加法合成；未采样原游戏录音",
    usage: "随本项目本地打包",
    transform: "确定性正弦基音与两级谐波；4ms 起音及12ms 收尾；约-12dBFS 峰值；16-bit PCM WAV",
    referenceId: null,
    referenceUrl: null,
    differences:
      "未取得且未核对可用原版短音效；仅匹配动作反馈职责，不声称原音色、原节奏或原响度还原",
  });
}

const fontManifestPath = resolve(assetRoot, "font-manifest.json");
const fontAssets = existsSync(fontManifestPath)
  ? (
      JSON.parse(readFileSync(fontManifestPath, "utf8")) as { assets: Record<string, unknown>[] }
    ).assets.map((asset) => ({ ...asset, profiles: [...profileOrder] }))
  : [];
writeFileSync(
  resolve(assetRoot, "manifest.json"),
  `${JSON.stringify({ assetVersion: "camellia-assets-v1", phase: allProfiles ? "prepared-all-profiles" : fullM1 ? "m1" : "representative", assets: [...generatedAssets, ...fontAssets] }, null, 2)}\n`,
);
process.stdout.write(
  `Generated ${selectedIcons.length} SVG icons and ${tones.length} local WAV files.\n`,
);
