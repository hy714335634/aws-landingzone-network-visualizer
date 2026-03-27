import type { Node, Edge } from '@xyflow/react';
import type { NetworkConfig, VpcConfig, TgwConfig, SubnetMapEntry, SubnetsConfig } from '../types/network';

// 保留的子网名称及其显示标签
const RESERVED_SUBNET_NAMES: Record<string, string> = {
  'intra': '内部',
  'public': '公有',
  'private': '私有',
};

// 旧数组格式的固定索引映射
const LEGACY_SUBNET_TYPES = ['intra', 'public', 'private'];

// 非区域的根级别属性名
const ROOT_LEVEL_KEYS = ['vpcs', 'tgw', 'resolver', 'dx', 'variables'];

// 布局常量
const LAYOUT = {
  VPC_MIN_WIDTH: 500,
  AZ_WIDTH: 230,
  AZ_GAP: 12,
  VPC_GAP: 40,
  VPC_MIN_HEIGHT: 200,
  REGION_PADDING: 30,
  REGION_HEADER_HEIGHT: 55,
  REGION_BOTTOM_PADDING: 40,
  REGION_GAP: 230,
  TGW_WIDTH: 320,
  TGW_MIN_HEIGHT: 150,
  TGW_MARGIN: 40,
  TGW_TOP_MARGIN: 10,
  ROW_GAP: 40,
  VPC_VERTICAL_GAP: 20,
  TGW_VERTICAL_PADDING: 40,
  SUBNET_HEIGHT: 28,
  AZ_HEADER_HEIGHT: 32,
  AZ_PADDING: 8,
};

function calculateSubnetCidr(vpcCidr: string, subnetDef: number[]): string {
  const [offset, index] = subnetDef;
  const [baseIp, vpcMaskStr] = vpcCidr.split('/');
  const vpcMask = parseInt(vpcMaskStr);
  const subnetMask = vpcMask + offset;
  const subnetSize = Math.pow(2, 32 - subnetMask);
  const ipParts = baseIp.split('.').map(Number);
  const baseIpNum = (ipParts[0] << 24) >>> 0 | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
  const subnetIpNum = (baseIpNum + (index * subnetSize)) >>> 0;
  const newIp = [
    (subnetIpNum >>> 24) & 255,
    (subnetIpNum >>> 16) & 255,
    (subnetIpNum >>> 8) & 255,
    subnetIpNum & 255
  ].join('.');
  return `${newIp}/${subnetMask}`;
}

// ============================================
// 子网格式标准化
// ============================================

// 统一的内部子网表示
interface NormalizedSubnetType {
  name: string;       // 子网名称 (intra, public, private, app, db, ...)
  label: string;      // 显示标签
  cidrs: number[][];  // 每个 AZ 的 [newbits, netnum]
  isReserved: boolean; // 是否为保留名称
}

/**
 * 判断 subnets 是数组格式还是 map 格式
 */
function isSubnetsArray(subnets: SubnetsConfig): subnets is number[][][] {
  return Array.isArray(subnets);
}

/**
 * 将两种子网格式标准化为统一的内部表示
 */
function normalizeSubnets(subnets: SubnetsConfig, subnetNames?: string[]): NormalizedSubnetType[] {
  if (!subnets) return [];

  if (isSubnetsArray(subnets)) {
    // 旧数组格式: [[intra cidrs], [public cidrs], [private-1 cidrs], ...]
    return subnets.map((cidrs, index) => {
      if (!cidrs || cidrs.length === 0) return null;

      let name: string;
      if (subnetNames && subnetNames[index]) {
        name = subnetNames[index];
      } else if (index < LEGACY_SUBNET_TYPES.length) {
        name = LEGACY_SUBNET_TYPES[index];
      } else {
        name = `private-${index - 2}`;
      }

      const label = RESERVED_SUBNET_NAMES[name] || name;
      return {
        name,
        label,
        cidrs,
        isReserved: name in RESERVED_SUBNET_NAMES,
      };
    }).filter((s): s is NormalizedSubnetType => s !== null);
  } else {
    // Map 格式: { "intra": { "cidrs": [...] }, "public": { "cidrs": [...] }, ... }
    const result: NormalizedSubnetType[] = [];
    // 保留名称优先排序: intra → public → private → 其他
    const orderedKeys = Object.keys(subnets).sort((a, b) => {
      const order = ['intra', 'public', 'private'];
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });

    orderedKeys.forEach(name => {
      const entry = (subnets as Record<string, SubnetMapEntry>)[name];
      if (!entry || !entry.cidrs || entry.cidrs.length === 0) return;
      const label = RESERVED_SUBNET_NAMES[name] || name;
      result.push({
        name,
        label,
        cidrs: entry.cidrs,
        isReserved: name in RESERVED_SUBNET_NAMES,
      });
    });

    return result;
  }
}

/**
 * 检查 VPC 是否有 intra 子网（用于 TGW 连接判断）
 */
function hasIntraSubnet(subnets: SubnetsConfig): boolean {
  if (!subnets) return false;
  if (isSubnetsArray(subnets)) {
    // 数组格式: index 0 是 intra
    return subnets[0]?.length > 0 && subnets[0].some(s => s?.length === 2);
  } else {
    // Map 格式: 检查 'intra' key
    const intra = (subnets as Record<string, SubnetMapEntry>).intra;
    return !!intra?.cidrs?.length;
  }
}

/**
 * 计算资源的 JSON 路径
 */
function vpcJsonPath(regionId: string, vpcName: string): string {
  return regionId === 'main' ? `vpcs.${vpcName}` : `${regionId}.vpcs.${vpcName}`;
}

function tgwJsonPath(regionId: string): string {
  return regionId === 'main' ? 'tgw' : `${regionId}.tgw`;
}

function tgwTableJsonPath(regionId: string, tableName: string): string {
  return regionId === 'main' ? `tgw.tables.${tableName}` : `${regionId}.tgw.tables.${tableName}`;
}

/**
 * 过滤掉 enabled: false 的 VPC
 */
function filterEnabledVpcs(vpcs: Record<string, VpcConfig>): Record<string, VpcConfig> {
  const result: Record<string, VpcConfig> = {};
  Object.entries(vpcs).forEach(([name, config]) => {
    if (config.enabled !== false) {
      result[name] = config;
    }
  });
  return result;
}
function calculateIpCount(cidr: string): number {
  const mask = parseInt(cidr.split('/')[1]);
  const total = Math.pow(2, 32 - mask);
  return Math.max(0, total - 5);
}

// 计算 TGW 节点的预估高度
function estimateTgwHeight(tgw: TgwConfig): number {
  let height = 90; // 基础高度（header + meta）

  // connects 部分
  if (tgw.connects) {
    const connectCount = Object.keys(tgw.connects).length;
    if (connectCount > 0) {
      height += 28; // header
      height += connectCount * 70; // 每个 connect
    }
  }

  // tables 部分
  if (tgw.tables) {
    Object.values(tgw.tables).forEach(table => {
      height += 28; // table header
      if (table.associations?.length) height += 32;
      if (table.propagations?.length) height += 32;
      if (table.routes) {
        height += 22 + Object.keys(table.routes).length * 24;
      }
    });
  }

  return Math.max(LAYOUT.TGW_MIN_HEIGHT, height);
}

// 分析 VPC 子网结构
interface SubnetInfo {
  typeIndex: number;
  typeName: string;
  typeLabel: string;
  cidr: string;
  ipCount: number;
  def: number[];
}

interface AzInfo {
  az: string;
  azLabel: string;
  subnets: SubnetInfo[];
  hasPublic: boolean;
}

function analyzeVpcSubnets(vpcConfig: VpcConfig): AzInfo[] {
  if (!vpcConfig.cidr || !vpcConfig.subnets) return [];

  const normalized = normalizeSubnets(vpcConfig.subnets, vpcConfig.subnet_names);
  const azMap = new Map<number, SubnetInfo[]>();

  normalized.forEach((subnetType, typeIndex) => {
    subnetType.cidrs.forEach((subnetDef, azIndex) => {
      if (!subnetDef || subnetDef.length !== 2) return;

      const cidr = calculateSubnetCidr(vpcConfig.cidr, subnetDef);
      const ipCount = calculateIpCount(cidr);

      if (!azMap.has(azIndex)) {
        azMap.set(azIndex, []);
      }
      azMap.get(azIndex)!.push({
        typeIndex,
        typeName: subnetType.name,
        typeLabel: subnetType.label,
        cidr,
        ipCount,
        def: subnetDef,
      });
    });
  });

  const azInfos: AzInfo[] = [];
  azMap.forEach((subnets, azIndex) => {
    const hasPublic = subnets.some(s => s.typeName === 'public');
    azInfos.push({
      az: String.fromCharCode(97 + azIndex),
      azLabel: String.fromCharCode(97 + azIndex).toUpperCase(),
      subnets: subnets.sort((a, b) => a.typeIndex - b.typeIndex),
      hasPublic,
    });
  });

  return azInfos.sort((a, b) => a.az.localeCompare(b.az));
}

function calculateVpcDimensions(vpcConfig: VpcConfig): { width: number; height: number } {
  const azInfos = analyzeVpcSubnets(vpcConfig);
  const azCount = azInfos.length;

  if (azCount === 0) {
    return { width: LAYOUT.VPC_MIN_WIDTH, height: LAYOUT.VPC_MIN_HEIGHT };
  }

  const maxSubnets = Math.max(...azInfos.map(az => az.subnets.length));

  const width = Math.max(
    LAYOUT.VPC_MIN_WIDTH,
    azCount * LAYOUT.AZ_WIDTH + (azCount - 1) * LAYOUT.AZ_GAP + 24
  );

  const accountsHeight = vpcConfig.accounts?.length ? 30 : 0;
  const componentsHeight = (vpcConfig.igw?.enabled || vpcConfig.nfw?.enabled || vpcConfig.gwlb?.enabled) ? 28 : 0;
  const azHeight = LAYOUT.AZ_HEADER_HEIGHT + maxSubnets * LAYOUT.SUBNET_HEIGHT + LAYOUT.AZ_PADDING * 2;
  const height = Math.max(LAYOUT.VPC_MIN_HEIGHT, 60 + accountsHeight + componentsHeight + azHeight + 20);

  return { width, height };
}

// Hub VPC 排在最前面（稳定排序）
function sortVpcsByHub(vpcEntries: [string, VpcConfig][]): void {
  vpcEntries.sort(([, a], [, b]) => {
    if (a.is_hub && !b.is_hub) return -1;
    if (!a.is_hub && b.is_hub) return 1;
    return 0;
  });
}

// 计算 VPC 纵向排列的尺寸指标
function calculateVpcColumnMetrics(vpcEntries: [string, VpcConfig][]) {
  const dims = vpcEntries.map(([, cfg]) => calculateVpcDimensions(cfg));
  const maxWidth = Math.max(LAYOUT.VPC_MIN_WIDTH, ...dims.map(d => d.width));
  let totalHeight = LAYOUT.REGION_HEADER_HEIGHT;
  dims.forEach(d => { totalHeight += d.height + LAYOUT.VPC_VERTICAL_GAP; });
  totalHeight += LAYOUT.REGION_BOTTOM_PADDING - LAYOUT.VPC_VERTICAL_GAP;
  return { dims, maxWidth, totalHeight };
}

// 计算思维导图布局中区域的整体尺寸
function calculateMindMapRegionSize(maxVpcWidth: number, vpcTotalHeight: number, hasTgw: boolean, tgwHeight: number) {
  const tgwColumnWidth = hasTgw ? LAYOUT.TGW_WIDTH + LAYOUT.TGW_MARGIN * 2 : 0;
  const regionWidth = maxVpcWidth + LAYOUT.REGION_PADDING * 2 + tgwColumnWidth;
  const regionHeight = Math.max(
    vpcTotalHeight,
    hasTgw ? tgwHeight + LAYOUT.REGION_HEADER_HEIGHT + LAYOUT.TGW_VERTICAL_PADDING + LAYOUT.REGION_BOTTOM_PADDING : vpcTotalHeight
  );
  return { tgwColumnWidth, regionWidth, regionHeight };
}

// 检测主区域名称 - 从对等区域的路由表推断
function detectMainRegionName(config: NetworkConfig): string {
  return 'main';
}

/**
 * 推断主区域的 AWS 区域名称（用于显示）
 * 从对等区域的 TGW 路由表中查找 peer 路由指向的区域名
 */
function inferMainRegionDisplayName(config: NetworkConfig): string {
  // 策略：从主区域 TGW 路由表中查找 peer 路由的 key
  // 这些 key 是对等区域名称（如 us-west-1, ap-east-1）
  // 排除这些已知的对等区域后，剩余的 AWS 区域格式的 key 可能就是主区域
  // 但更可靠的方法：查看主区域 TGW 路由表中所有 peer 路由的 key，
  // 这些是对等区域名称。主区域名称不会出现在自己的路由表中。
  // 所以我们从对等区域的路由表中查找 "main" → "peer" 的路由，
  // 然后看主区域路由表中哪些区域名被引用为 peer 目标。

  const peerRegionNames: string[] = [];
  Object.entries(config).forEach(([key, value]) => {
    if (ROOT_LEVEL_KEYS.includes(key) || !value || typeof value !== 'object') return;
    if ('vpcs' in value) peerRegionNames.push(key);
  });

  if (peerRegionNames.length === 0) return 'MAIN REGION';

  // 从主区域 TGW 路由表中收集所有 peer 路由的 key（这些是对等区域名称）
  const peerRouteKeys = new Set<string>();
  if (config.tgw?.tables) {
    Object.values(config.tgw.tables).forEach(table => {
      if (table.routes) {
        Object.entries(table.routes).forEach(([key, target]) => {
          if (target === 'peer' && key !== '*' && key !== 'tgw' && key !== 'main') {
            peerRouteKeys.add(key);
          }
        });
      }
    });
  }

  // 如果主区域路由表中引用了所有对等区域，说明我们知道了所有对等区域
  // 主区域就是不在对等区域列表中的那个 AWS 区域
  // 但 JSON 中主区域没有显式名称，所以我们用排除法：
  // 如果对等区域有 us-west-1, ap-east-1, eu-central-1, eu-west-2
  // 且主区域路由表引用了这些，那主区域可能是 us-east-1（最常见的主区域）

  // 更精确的推断：查看对等区域中是否有 us-east-1
  // 如果没有，且有其他 us-* 区域，主区域很可能是 us-east-1
  const allRegionCodes = new Set([...peerRegionNames, ...peerRouteKeys]);
  
  // 常见主区域候选
  const candidates = ['us-east-1', 'cn-northwest-1', 'cn-north-1', 'eu-west-1', 'ap-southeast-1'];
  for (const candidate of candidates) {
    if (!allRegionCodes.has(candidate)) {
      // 检查是否与已知对等区域在同一地理区域
      const candidateGeo = candidate.split('-')[0];
      const hasMatchingGeo = peerRegionNames.some(r => r.startsWith(candidateGeo + '-'));
      if (hasMatchingGeo || peerRegionNames.length > 0) {
        return `PRIMARY (${candidate})`;
      }
    }
  }

  return 'PRIMARY';
}

// ============================================
// 详细视图解析 — 思维导图布局
// 主区域在左侧：VPC 纵向排列(左) + TGW(右)
// 对等区域在右侧：TGW(左) + VPC 纵向排列(右)
// ============================================
export function parseNetworkConfig(config: NetworkConfig): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const regions: { id: string; name: string; vpcs: Record<string, VpcConfig>; tgw?: TgwConfig; isMain: boolean }[] = [];
  const mainRegionId = detectMainRegionName(config);

  if (config.vpcs) {
    regions.push({ id: mainRegionId, name: mainRegionId.toUpperCase(), vpcs: filterEnabledVpcs(config.vpcs), tgw: config.tgw, isMain: true });
  }
  Object.entries(config).forEach(([key, value]) => {
    if (ROOT_LEVEL_KEYS.includes(key) || !value || typeof value !== 'object') return;
    if (!('vpcs' in value)) return;
    const regionConfig = value as { vpcs: Record<string, VpcConfig>; tgw?: TgwConfig };
    regions.push({ id: key, name: key, vpcs: filterEnabledVpcs(regionConfig.vpcs), tgw: regionConfig.tgw, isMain: false });
  });

  const mainRegion = regions.find(r => r.isMain);
  if (!mainRegion) return { nodes, edges };

  // ---- 主区域（左侧）：VPC 左列 + TGW 右侧 ----
  const mainVpcEntries = Object.entries(mainRegion.vpcs);
  sortVpcsByHub(mainVpcEntries);

  const hasTgw = mainRegion.tgw?.enabled;
  const tgwHeight = hasTgw ? estimateTgwHeight(mainRegion.tgw!) : 0;

  const { dims: vpcDims, maxWidth: maxVpcWidth, totalHeight: vpcTotalHeight } = calculateVpcColumnMetrics(mainVpcEntries);
  const { regionWidth: mainRegionWidth, regionHeight: mainRegionHeight } = calculateMindMapRegionSize(maxVpcWidth, vpcTotalHeight, !!hasTgw, tgwHeight);

  nodes.push({
    id: `region-${mainRegion.id}`,
    type: 'region',
    position: { x: 0, y: 0 },
    data: { label: mainRegion.name.toUpperCase(), isMain: true, jsonPath: 'vpcs' },
    style: { width: mainRegionWidth, height: mainRegionHeight },
  });

  let vpcY = LAYOUT.REGION_HEADER_HEIGHT;
  mainVpcEntries.forEach(([vpcName, vpcConfig], index) => {
    const dim = vpcDims[index];
    const jp = vpcJsonPath(mainRegion.id, vpcName);
    const vpcNodes = createVpcWithAzLayout(
      vpcName, vpcConfig, mainRegion.id,
      LAYOUT.REGION_PADDING, vpcY, dim.width, dim.height, jp
    );
    nodes.push(...vpcNodes);

    if (hasTgw && hasIntraSubnet(vpcConfig.subnets)) {
      edges.push({
        id: `${mainRegion.id}-tgw-${vpcName}`,
        source: `${mainRegion.id}-${vpcName}`,
        target: `${mainRegion.id}-tgw`,
        sourceHandle: 'source-right',
        targetHandle: 'left',
        type: 'smoothstep',
        animated: true,
        style: { stroke: '#F59E0B', strokeWidth: 2 },
        zIndex: 100,
      });
    }
    vpcY += dim.height + LAYOUT.VPC_VERTICAL_GAP;
  });

  if (hasTgw) {
    const tgwX = maxVpcWidth + LAYOUT.REGION_PADDING + LAYOUT.TGW_MARGIN;
    const tgwY = Math.max(
      LAYOUT.REGION_HEADER_HEIGHT + LAYOUT.VPC_VERTICAL_GAP,
      (mainRegionHeight - tgwHeight) / 2
    );
    nodes.push(createTgwNode(mainRegion.tgw!, mainRegion.id, tgwX, tgwY, tgwHeight));
  }

  // ---- 对等区域（右侧）：TGW 左侧 + VPC 右列 ----
  const otherRegions = regions.filter(r => !r.isMain);
  const peerStartX = mainRegionWidth + LAYOUT.REGION_GAP;
  let peerCurrentY = 0;

  otherRegions.forEach((region) => {
    const peerVpcEntries = Object.entries(region.vpcs);
    sortVpcsByHub(peerVpcEntries);

    const peerHasTgw = region.tgw?.enabled;
    const peerTgwHeight = peerHasTgw ? estimateTgwHeight(region.tgw!) : 0;

    const { dims: peerVpcDims, maxWidth: peerMaxVpcWidth, totalHeight: peerVpcTotalHeight } = calculateVpcColumnMetrics(peerVpcEntries);
    const { tgwColumnWidth: peerTgwColWidth, regionWidth: peerRegionWidth, regionHeight: peerRegionHeight } = calculateMindMapRegionSize(peerMaxVpcWidth, peerVpcTotalHeight, !!peerHasTgw, peerTgwHeight);

    nodes.push({
      id: `region-${region.id}`,
      type: 'region',
      position: { x: peerStartX, y: peerCurrentY },
      data: { label: region.name.toUpperCase(), isMain: false, isPeer: region.tgw?.peer, jsonPath: region.id },
      style: { width: peerRegionWidth, height: peerRegionHeight },
    });

    if (peerHasTgw) {
      const tgwX = LAYOUT.TGW_MARGIN;
      const tgwY = Math.max(
        LAYOUT.REGION_HEADER_HEIGHT + LAYOUT.VPC_VERTICAL_GAP,
        (peerRegionHeight - peerTgwHeight) / 2
      );
      nodes.push(createTgwNode(region.tgw!, region.id, tgwX, tgwY, peerTgwHeight));

      if (region.tgw!.peer && mainRegion.tgw?.enabled) {
        edges.push({
          id: `tgw-peer-${region.id}`,
          source: `${mainRegionId}-tgw`,
          target: `${region.id}-tgw`,
          sourceHandle: 'right',
          targetHandle: 'left',
          type: 'smoothstep',
          animated: true,
          label: 'Peering',
          labelStyle: { fill: '#F59E0B', fontWeight: 600, fontSize: 12 },
          labelBgStyle: { fill: '#1e293b', fillOpacity: 0.9 },
          labelBgPadding: [6, 4] as [number, number],
          labelBgBorderRadius: 4,
          style: { stroke: '#F59E0B', strokeWidth: 2, strokeDasharray: '8,4' },
          zIndex: 100,
        });
      }
    }

    let peerVpcY = LAYOUT.REGION_HEADER_HEIGHT;
    peerVpcEntries.forEach(([vpcName, vpcConfig], index) => {
      const dim = peerVpcDims[index];
      const vpcX = peerTgwColWidth + LAYOUT.REGION_PADDING;
      const jp = vpcJsonPath(region.id, vpcName);
      const vpcNodes = createVpcWithAzLayout(
        vpcName, vpcConfig, region.id,
        vpcX, peerVpcY, dim.width, dim.height, jp
      );
      nodes.push(...vpcNodes);

      if (peerHasTgw && hasIntraSubnet(vpcConfig.subnets)) {
        edges.push({
          id: `${region.id}-tgw-${vpcName}`,
          source: `${region.id}-tgw`,
          target: `${region.id}-${vpcName}`,
          sourceHandle: 'right',
          targetHandle: 'left',
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#F59E0B', strokeWidth: 2 },
          zIndex: 100,
        });
      }
      peerVpcY += dim.height + LAYOUT.VPC_VERTICAL_GAP;
    });

    peerCurrentY += peerRegionHeight + LAYOUT.REGION_GAP;
  });

  // VPC 对等连线
  addVpcPeeringEdges(regions, edges);

  return { nodes, edges };
}

// ============================================
// 拓扑视图解析 - 纯平面图，无嵌套容器
// 节点：Region标签、VPC、TGW、Account、Component(IGW/NAT/NFW/GWLB)
// 边：TGW↔VPC、TGW↔TGW对等、VPC→Account、VPC→Component
// ============================================

const TOPO = {
  VPC_W: 160, VPC_H: 60,
  TGW_W: 160, TGW_H: 78,
  ACC_W: 120, ACC_H: 30,
  EP_W: 140, EP_H: 24, EP_TAG_H: 18,
  REGION_LABEL_W: 180, REGION_LABEL_H: 28,
  VPC_GAP_X: 200,
  TGW_GAP_BELOW: 60,
  PEER_Y_GAP: 100,
};

// 地域分类和颜色
type GeoGroup = 'americas' | 'europe' | 'asia_pacific' | 'china' | 'other';

const GEO_COLORS: Record<GeoGroup, { bg: string; border: string; label: string }> = {
  americas:     { bg: 'rgba(59, 130, 246, 0.06)',  border: 'rgba(59, 130, 246, 0.25)',  label: '#60a5fa' },
  europe:       { bg: 'rgba(34, 197, 94, 0.06)',   border: 'rgba(34, 197, 94, 0.25)',   label: '#4ade80' },
  asia_pacific:  { bg: 'rgba(168, 85, 247, 0.06)',  border: 'rgba(168, 85, 247, 0.25)',  label: '#c084fc' },
  china:        { bg: 'rgba(239, 68, 68, 0.06)',   border: 'rgba(239, 68, 68, 0.25)',   label: '#f87171' },
  other:        { bg: 'rgba(148, 163, 184, 0.06)', border: 'rgba(148, 163, 184, 0.25)', label: '#94a3b8' },
};

function classifyRegion(regionId: string): GeoGroup {
  if (regionId === 'main') return 'americas'; // default
  if (regionId.startsWith('us-') || regionId.startsWith('ca-') || regionId.startsWith('sa-')) return 'americas';
  if (regionId.startsWith('eu-') || regionId.startsWith('me-') || regionId.startsWith('af-') || regionId.startsWith('il-')) return 'europe';
  if (regionId.startsWith('ap-')) return 'asia_pacific';
  if (regionId.startsWith('cn-')) return 'china';
  return 'other';
}

/**
 * 计算一个对等区域在拓扑视图中需要的宽度
 */
function estimatePeerRegionWidth(vpcCount: number): number {
  return Math.max(TOPO.VPC_W + 40, vpcCount * TOPO.VPC_GAP_X);
}

export function parseNetworkConfigSimplified(config: NetworkConfig): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  type RegionInfo = { id: string; name: string; vpcs: Record<string, VpcConfig>; tgw?: TgwConfig; isMain: boolean };
  const regions: RegionInfo[] = [];
  const mainRegionId = detectMainRegionName(config);

  if (config.vpcs) {
    regions.push({ id: mainRegionId, name: mainRegionId.toUpperCase(), vpcs: filterEnabledVpcs(config.vpcs), tgw: config.tgw, isMain: true });
  }
  Object.entries(config).forEach(([key, value]) => {
    if (ROOT_LEVEL_KEYS.includes(key) || !value || typeof value !== 'object') return;
    if (!('vpcs' in value)) return;
    const rc = value as { vpcs: Record<string, VpcConfig>; tgw?: TgwConfig };
    regions.push({ id: key, name: key, vpcs: filterEnabledVpcs(rc.vpcs), tgw: rc.tgw, isMain: false });
  });

  const mainRegion = regions.find(r => r.isMain);
  if (!mainRegion) return { nodes, edges };

  // ---------- 主区域 ----------
  const mainVpcs = Object.entries(mainRegion.vpcs);
  const hasTgw = mainRegion.tgw?.enabled;

  // 计算主区域中心 X 坐标
  const mainCenterX = (mainVpcs.length - 1) * TOPO.VPC_GAP_X / 2 + TOPO.VPC_W / 2;

  // 区域标签 — 使用推断的区域名称
  const mainDisplayName = inferMainRegionDisplayName(config);
  nodes.push({
    id: `topo-label-${mainRegion.id}`,
    type: 'topoRegionLabel',
    position: { x: mainCenterX - TOPO.REGION_LABEL_W / 2, y: -60 },
    data: { label: mainDisplayName, isMain: true },
    style: { width: TOPO.REGION_LABEL_W },
  });

  // VPC 行 (y=0)，组件内嵌在 VPC 节点中
  const vpcY = 0;
  let maxBottomY = vpcY + TOPO.VPC_H;

  mainVpcs.forEach(([vpcName, vpcConfig], i) => {
    const vpcId = `${mainRegion.id}-${vpcName}`;
    const vpcX = i * TOPO.VPC_GAP_X;

    // 账号标识：有 accounts 显示第一个账号 ID，无则显示 DEFAULT
    const accountLabel = vpcConfig.accounts?.length ? vpcConfig.accounts[0] : 'DEFAULT';

    // VPC 节点（组件和账号内嵌）
    const hasComps = vpcConfig.igw?.enabled || vpcConfig.nat?.enabled || vpcConfig.nfw?.enabled || vpcConfig.gwlb?.enabled;
    const vpcH = TOPO.VPC_H + (hasComps ? 8 : 0) + 16; // 额外高度给账号行
    nodes.push({
      id: vpcId,
      type: 'topoVpc',
      position: { x: vpcX, y: vpcY },
      data: {
        label: vpcName, cidr: vpcConfig.cidr,
        isHub: vpcConfig.is_hub, isEndpoint: vpcConfig.is_endpoint,
        hasIgw: vpcConfig.igw?.enabled, hasNat: vpcConfig.nat?.enabled,
        hasNfw: vpcConfig.nfw?.enabled, hasGwlb: vpcConfig.gwlb?.enabled,
        accountId: accountLabel,
        jsonPath: vpcJsonPath(mainRegion.id, vpcName),
      },
      style: { width: TOPO.VPC_W, height: vpcH },
    });

    // TGW ↔ VPC 连线
    if (hasTgw && hasIntraSubnet(vpcConfig.subnets)) {
      edges.push({
        id: `${mainRegion.id}-tgw-${vpcName}`,
        source: vpcId, target: `${mainRegion.id}-tgw`,
        sourceHandle: 'source-bottom', targetHandle: 'top',
        type: 'bezier', animated: true,
        style: { stroke: '#F59E0B', strokeWidth: 2 },
      });
    }
  });

  // TGW 节点居中在 VPC 行下方
  let tgwBottomY = maxBottomY;
  if (hasTgw) {
    const tgwX = mainCenterX - TOPO.TGW_W / 2;
    const tgwY = maxBottomY + TOPO.TGW_GAP_BELOW;
    tgwBottomY = tgwY + TOPO.TGW_H;
    nodes.push({
      id: `${mainRegion.id}-tgw`,
      type: 'topoTgw',
      position: { x: tgwX, y: tgwY },
      data: { label: 'TGW', asn: mainRegion.tgw!.asn, cidr: mainRegion.tgw!.cidr, peer: false, jsonPath: tgwJsonPath(mainRegion.id) },
      style: { width: TOPO.TGW_W, height: TOPO.TGW_H },
    });
  }

  // DX 节点（仅主区域，在 TGW 右侧）
  if (config.dx?.enabled && hasTgw) {
    const dxX = mainCenterX + TOPO.TGW_W / 2 + 40;
    const dxY = tgwBottomY - TOPO.TGW_H;
    nodes.push({
      id: `${mainRegion.id}-dx`,
      type: 'topoDx',
      position: { x: dxX, y: dxY },
      data: { asn: config.dx.asn, prefixes: config.dx.prefixes },
      style: { width: TOPO.TGW_W, height: 60 },
    });
    edges.push({
      id: `${mainRegion.id}-dx-tgw`,
      source: `${mainRegion.id}-tgw`,
      target: `${mainRegion.id}-dx`,
      sourceHandle: 'source-right',
      targetHandle: 'left',
      type: 'bezier',
      animated: true,
      style: { stroke: '#f97316', strokeWidth: 3 },
    });
  }

  // 主区域背景框（包裹所有主区域节点）
  const mainGeo = classifyRegion(mainRegionId);
  const mainGeoColor = GEO_COLORS[mainGeo];
  const mainBgPad = 30;
  const mainTotalWidth = mainVpcs.length * TOPO.VPC_GAP_X;
  const mainBgLeft = -mainBgPad;
  const mainBgTop = -60 - mainBgPad;
  const mainBgWidth = mainTotalWidth + mainBgPad * 2;
  const mainBgHeight = tgwBottomY + mainBgPad - mainBgTop + 10;
  nodes.push({
    id: `topo-geo-bg-${mainRegion.id}`,
    type: 'topoRegionLabel',
    position: { x: mainBgLeft, y: mainBgTop },
    data: { label: '', isMain: true },
    style: {
      width: mainBgWidth, height: mainBgHeight,
      background: mainGeoColor.bg, border: `1px solid ${mainGeoColor.border}`,
      borderRadius: '16px', opacity: 0.5,
    },
    zIndex: -1,
  });

  // ---------- 对等区域（按地域分组，动态布局） ----------
  const otherRegions = regions.filter(r => !r.isMain);
  if (otherRegions.length > 0) {
    // 按地域分组
    const geoGroups = new Map<GeoGroup, typeof otherRegions>();
    otherRegions.forEach(region => {
      const geo = classifyRegion(region.id);
      if (!geoGroups.has(geo)) geoGroups.set(geo, []);
      geoGroups.get(geo)!.push(region);
    });

    let peerY = tgwBottomY + TOPO.PEER_Y_GAP;

    for (const [geo, groupRegions] of geoGroups) {
      const rowGap = 80;
      const geoColor = GEO_COLORS[geo];
      const widths = groupRegions.map(r => estimatePeerRegionWidth(Object.keys(r.vpcs).length));
      const totalRowWidth = widths.reduce((s, w) => s + w, 0) + (widths.length - 1) * rowGap;
      let regionX = mainCenterX - totalRowWidth / 2;
      let rowMaxHeight = 0;

      groupRegions.forEach((region, ri) => {
        const peerVpcs = Object.entries(region.vpcs);
        const peerHasTgw = region.tgw?.enabled;
        const regionWidth = widths[ri];
        const regionCenterX = regionX + regionWidth / 2;

        // 地域背景框
        const bgPad = 20;
        const bgH = TOPO.REGION_LABEL_H + 16 + TOPO.TGW_H + 30 + TOPO.VPC_H + 20 + bgPad * 2;
        nodes.push({
          id: `topo-geo-bg-${region.id}`,
          type: 'topoRegionLabel',
          position: { x: regionX - bgPad, y: peerY - bgPad },
          data: { label: '', isMain: false },
          style: {
            width: regionWidth + bgPad * 2, height: bgH,
            background: geoColor.bg, border: `1px solid ${geoColor.border}`,
            borderRadius: '12px', opacity: 0.6,
          },
          zIndex: -1,
        });

        // 区域标签
        nodes.push({
          id: `topo-label-${region.id}`,
          type: 'topoRegionLabel',
          position: { x: regionCenterX - TOPO.REGION_LABEL_W / 2, y: peerY },
          data: { label: region.name.toUpperCase(), isMain: false },
          style: { width: TOPO.REGION_LABEL_W },
        });

        // TGW
        if (peerHasTgw) {
          const tgwX = regionCenterX - TOPO.TGW_W / 2;
          const tgwY = peerY + TOPO.REGION_LABEL_H + 16;
          nodes.push({
            id: `${region.id}-tgw`, type: 'topoTgw',
            position: { x: tgwX, y: tgwY },
            data: { label: 'TGW', asn: region.tgw!.asn, cidr: region.tgw!.cidr, peer: region.tgw!.peer, jsonPath: tgwJsonPath(region.id) },
            style: { width: TOPO.TGW_W, height: TOPO.TGW_H },
          });

          if (region.tgw!.peer && mainRegion.tgw?.enabled) {
            edges.push({
              id: `tgw-peer-${region.id}`,
              source: `${mainRegionId}-tgw`, target: `${region.id}-tgw`,
              sourceHandle: 'source-bottom', targetHandle: 'top',
              type: 'bezier', animated: true,
              label: 'Peering',
              labelStyle: { fill: '#F59E0B', fontWeight: 600, fontSize: 10 },
              labelBgStyle: { fill: '#1e293b', fillOpacity: 0.9 },
              labelBgPadding: [4, 3] as [number, number], labelBgBorderRadius: 4,
              style: { stroke: '#F59E0B', strokeWidth: 2, strokeDasharray: '8,4' },
            });
          }
        }

        // VPCs
        const vpcStartX = regionCenterX - (peerVpcs.length * TOPO.VPC_GAP_X) / 2 + (TOPO.VPC_GAP_X - TOPO.VPC_W) / 2;
        const peerVpcY = peerY + TOPO.REGION_LABEL_H + 16 + TOPO.TGW_H + 30;

        peerVpcs.forEach(([vpcName, vpcConfig], vi) => {
          const vpcId = `${region.id}-${vpcName}`;
          const vpcX = vpcStartX + vi * TOPO.VPC_GAP_X;
          const hasComps = vpcConfig.igw?.enabled || vpcConfig.nat?.enabled || vpcConfig.nfw?.enabled || vpcConfig.gwlb?.enabled;
          const accountLabel = vpcConfig.accounts?.length ? vpcConfig.accounts[0] : 'DEFAULT';
          const vpcH = TOPO.VPC_H + (hasComps ? 8 : 0) + 16;

          nodes.push({
            id: vpcId, type: 'topoVpc',
            position: { x: vpcX, y: peerVpcY },
            data: {
              label: vpcName, cidr: vpcConfig.cidr,
              isHub: vpcConfig.is_hub, isEndpoint: vpcConfig.is_endpoint,
              hasIgw: vpcConfig.igw?.enabled, hasNat: vpcConfig.nat?.enabled,
              hasNfw: vpcConfig.nfw?.enabled, hasGwlb: vpcConfig.gwlb?.enabled,
              accountId: accountLabel,
              jsonPath: vpcJsonPath(region.id, vpcName),
            },
            style: { width: TOPO.VPC_W, height: vpcH },
          });

          if (peerHasTgw && hasIntraSubnet(vpcConfig.subnets)) {
            edges.push({
              id: `${region.id}-tgw-${vpcName}`,
              source: `${region.id}-tgw`, target: vpcId,
              sourceHandle: 'source-bottom', targetHandle: 'top',
              type: 'bezier', animated: true,
              style: { stroke: '#F59E0B', strokeWidth: 2 },
            });
          }
        });

        rowMaxHeight = Math.max(rowMaxHeight, bgH);
        regionX += regionWidth + rowGap;
      });

      peerY += rowMaxHeight + 40;
    }
  }

  // VPC 对等连线（跨所有区域）
  addVpcPeeringEdges(regions, edges);

  return { nodes, edges };
}

/**
 * 生成 VPC 对等连线
 * peers 属性定义从当前 VPC 到目标 VPC 的对等连接
 * 连线是双向的，但只在发起方定义
 */
function addVpcPeeringEdges(
  regions: { id: string; vpcs: Record<string, VpcConfig> }[],
  edges: Edge[]
): void {
  regions.forEach(region => {
    Object.entries(region.vpcs).forEach(([vpcName, vpcConfig]) => {
      if (!vpcConfig.peers?.length) return;

      vpcConfig.peers.forEach(peerVpcName => {
        // 在同一区域或其他区域中查找目标 VPC
        let targetRegionId: string | null = null;
        for (const r of regions) {
          if (peerVpcName in r.vpcs) {
            targetRegionId = r.id;
            break;
          }
        }
        if (!targetRegionId) return;

        const sourceId = `${region.id}-${vpcName}`;
        const targetId = `${targetRegionId}-${peerVpcName}`;

        // 避免重复边（双向只画一条）
        const edgeId = `peer-${[sourceId, targetId].sort().join('-')}`;
        if (edges.some(e => e.id === edgeId)) return;

        edges.push({
          id: edgeId,
          source: sourceId,
          target: targetId,
          sourceHandle: 'source-right',
          targetHandle: 'left',
          type: 'smoothstep',
          animated: false,
          label: 'Peering',
          labelStyle: { fill: '#a78bfa', fontWeight: 600, fontSize: 10 },
          labelBgStyle: { fill: '#1e293b', fillOpacity: 0.9 },
          labelBgPadding: [4, 3] as [number, number],
          labelBgBorderRadius: 4,
          style: { stroke: '#a78bfa', strokeWidth: 2, strokeDasharray: '6,4' },
          zIndex: 100,
        });
      });
    });
  });
}

function createTgwNode(tgw: TgwConfig, regionId: string, x: number, y: number, height: number): Node {
  return {
    id: `${regionId}-tgw`,
    type: 'tgw',
    position: { x, y },
    data: {
      label: 'Transit Gateway',
      asn: tgw.asn,
      cidr: tgw.cidr,
      cidrs: tgw.cidrs,
      peer: tgw.peer,
      tables: tgw.tables,
      connects: tgw.connects,
      jsonPath: tgwJsonPath(regionId),
    },
    parentId: `region-${regionId}`,
    extent: 'parent',
    style: { width: LAYOUT.TGW_WIDTH, height },
  };
}

// 新的 VPC 布局：VPC → AZ → 子网
function createVpcWithAzLayout(
  vpcName: string,
  vpcConfig: VpcConfig,
  regionId: string,
  x: number,
  y: number,
  width: number,
  height: number,
  jsonPath?: string
): Node[] {
  const nodes: Node[] = [];
  const vpcId = `${regionId}-${vpcName}`;
  const jp = jsonPath || vpcJsonPath(regionId, vpcName);

  // VPC 主节点
  nodes.push({
    id: vpcId,
    type: 'vpc',
    position: { x, y },
    data: {
      label: vpcName,
      cidr: vpcConfig.cidr,
      isHub: vpcConfig.is_hub,
      isEndpoint: vpcConfig.is_endpoint,
      accounts: vpcConfig.accounts,
      hasIgw: vpcConfig.igw?.enabled,
      hasNat: vpcConfig.nat?.enabled,
      hasNfw: vpcConfig.nfw?.enabled,
      hasGwlb: vpcConfig.gwlb?.enabled,
      jsonPath: jp,
    },
    parentId: `region-${regionId}`,
    extent: 'parent',
    style: { width, height },
    zIndex: 1,
  });

  // 分析子网结构
  const azInfos = analyzeVpcSubnets(vpcConfig);
  if (azInfos.length === 0) return nodes;

  // 计算 AZ 布局
  const accountsHeight = vpcConfig.accounts?.length ? 30 : 0;
  const componentsHeight = (vpcConfig.igw?.enabled || vpcConfig.nfw?.enabled || vpcConfig.gwlb?.enabled) ? 28 : 0;
  const azStartY = 55 + accountsHeight + componentsHeight;
  const maxSubnets = Math.max(...azInfos.map(az => az.subnets.length));
  const azHeight = LAYOUT.AZ_HEADER_HEIGHT + maxSubnets * LAYOUT.SUBNET_HEIGHT + LAYOUT.AZ_PADDING * 2;

  azInfos.forEach((azInfo, azIndex) => {
    const azX = 12 + azIndex * (LAYOUT.AZ_WIDTH + LAYOUT.AZ_GAP);
    const azId = `${vpcId}-az-${azInfo.az}`;

    // AZ 容器节点
    nodes.push({
      id: azId,
      type: 'az',
      position: { x: azX, y: azStartY },
      data: {
        az: azInfo.az,
        azLabel: azInfo.azLabel,
        hasNat: azInfo.hasPublic && vpcConfig.nat?.enabled,
        isPublicAz: azInfo.hasPublic,
      },
      parentId: vpcId,
      extent: 'parent',
      style: { width: LAYOUT.AZ_WIDTH, height: azHeight },
      zIndex: 2,
    });

    // 子网节点
    let subnetY = LAYOUT.AZ_HEADER_HEIGHT + LAYOUT.AZ_PADDING;
    azInfo.subnets.forEach((subnet) => {
      nodes.push({
        id: `${vpcId}-subnet-${azInfo.az}-${subnet.typeIndex}`,
        type: 'subnet',
        position: { x: 6, y: subnetY },
        data: {
          cidr: subnet.cidr,
          ipCount: subnet.ipCount,
          typeName: subnet.typeName,
          typeLabel: subnet.typeLabel,
        },
        parentId: azId,
        extent: 'parent',
        style: { width: LAYOUT.AZ_WIDTH - 12 },
        zIndex: 3,
      });
      subnetY += LAYOUT.SUBNET_HEIGHT;
    });
  });

  return nodes;
}
