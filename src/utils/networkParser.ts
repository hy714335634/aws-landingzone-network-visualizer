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
  VPC_GAP: 80,
  VPC_MIN_HEIGHT: 200,
  REGION_PADDING: 50,
  REGION_HEADER_HEIGHT: 55,
  REGION_BOTTOM_PADDING: 50,
  REGION_GAP: 120,
  TGW_WIDTH: 320,
  TGW_MIN_HEIGHT: 150,
  TGW_MARGIN: 60,
  TGW_TOP_MARGIN: 10,
  VPCS_PER_ROW: 1,
  ROW_GAP: 60,
  SUBNET_HEIGHT: 28,
  AZ_HEADER_HEIGHT: 32,
  AZ_PADDING: 8,
  PEER_COLS: 2,
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

// 计算 VPC 网格布局
function calculateVpcGridLayout(vpcEntries: [string, VpcConfig][]): {
  positions: { x: number; y: number; width: number; height: number }[];
  totalWidth: number;
  totalHeight: number;
  maxContentHeight: number;
} {
  const positions: { x: number; y: number; width: number; height: number }[] = [];
  const rows: { vpcs: number[]; maxHeight: number; totalWidth: number }[] = [];

  const vpcDimensions = vpcEntries.map(([, config]) => calculateVpcDimensions(config));

  let currentRow: number[] = [];
  let currentRowWidth = 0;

  vpcEntries.forEach((_, index) => {
    const dim = vpcDimensions[index];
    currentRow.push(index);
    currentRowWidth += dim.width + (currentRow.length > 1 ? LAYOUT.VPC_GAP : 0);

    if (currentRow.length >= LAYOUT.VPCS_PER_ROW || index === vpcEntries.length - 1) {
      const maxHeight = Math.max(...currentRow.map(i => vpcDimensions[i].height));
      rows.push({ vpcs: [...currentRow], maxHeight, totalWidth: currentRowWidth });
      currentRow = [];
      currentRowWidth = 0;
    }
  });

  let currentY = LAYOUT.REGION_HEADER_HEIGHT;
  let maxRowWidth = 0;

  rows.forEach(row => {
    let currentX = LAYOUT.REGION_PADDING;
    row.vpcs.forEach((vpcIndex) => {
      const dim = vpcDimensions[vpcIndex];
      positions[vpcIndex] = {
        x: currentX,
        y: currentY,
        width: dim.width,
        height: dim.height,
      };
      currentX += dim.width + LAYOUT.VPC_GAP;
    });
    maxRowWidth = Math.max(maxRowWidth, row.totalWidth);
    currentY += row.maxHeight + LAYOUT.ROW_GAP;
  });

  const totalWidth = maxRowWidth + LAYOUT.REGION_PADDING * 2;
  const maxContentHeight = currentY - LAYOUT.ROW_GAP + LAYOUT.REGION_BOTTOM_PADDING;

  return { positions, totalWidth, totalHeight: currentY, maxContentHeight };
}

// 检测主区域名称 - 尝试从 TGW 路由表中推断
function detectMainRegionName(config: NetworkConfig): string {
  // 从对等区域的路由表里查找 "main" 路由指向的区域
  // 或者从主区域 TGW 路由表里查找对等区域名称来推断
  const peerRegions: string[] = [];
  Object.entries(config).forEach(([key, value]) => {
    if (ROOT_LEVEL_KEYS.includes(key) || !value || typeof value !== 'object') return;
    if ('vpcs' in value) {
      peerRegions.push(key);
    }
  });

  // 如果有对等区域，主区域名可以从上下文推断
  // 但 JSON 配置中没有显式指定主区域名称
  // 使用 "main" 作为标识，同时在显示上标记为 PRIMARY
  return 'main';
}

// ============================================
// 详细视图解析
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

  let currentY = 0;
  let mainRegionWidth = 0;

  // 主区域
  const mainRegion = regions.find(r => r.isMain);
  if (mainRegion) {
    const vpcEntries = Object.entries(mainRegion.vpcs);
    const hasTgw = mainRegion.tgw?.enabled;
    const tgwHeight = hasTgw ? estimateTgwHeight(mainRegion.tgw!) : 0;
    const tgwWidth = hasTgw ? LAYOUT.TGW_WIDTH + LAYOUT.TGW_MARGIN : 0;

    // 使用网格布局计算 VPC 位置
    const { positions, totalWidth, maxContentHeight } = calculateVpcGridLayout(vpcEntries);

    // 区域高度取 VPC 内容高度和 TGW 高度的最大值
    const tgwTotalHeight = tgwHeight + LAYOUT.REGION_HEADER_HEIGHT + LAYOUT.TGW_TOP_MARGIN + LAYOUT.REGION_BOTTOM_PADDING;
    const regionContentHeight = Math.max(maxContentHeight, tgwTotalHeight);
    const regionWidth = totalWidth + tgwWidth;
    mainRegionWidth = regionWidth;

    nodes.push({
      id: `region-${mainRegion.id}`,
      type: 'region',
      position: { x: 0, y: currentY },
      data: { label: mainRegion.name.toUpperCase(), isMain: true },
      style: { width: regionWidth, height: regionContentHeight },
    });

    vpcEntries.forEach(([vpcName, vpcConfig], index) => {
      const pos = positions[index];
      const vpcNodes = createVpcWithAzLayout(
        vpcName, vpcConfig, mainRegion.id,
        pos.x, pos.y, pos.width, pos.height
      );
      nodes.push(...vpcNodes);

      // TGW 连接：需要 intra 子网
      if (hasTgw && hasIntraSubnet(vpcConfig.subnets)) {
        edges.push({
          id: `${mainRegion.id}-tgw-${vpcName}`,
          source: `${mainRegion.id}-tgw`,
          target: `${mainRegion.id}-${vpcName}`,
          sourceHandle: 'source-left',
          targetHandle: 'right',
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#F59E0B', strokeWidth: 2 },
          zIndex: 100,
        });
      }
    });

    if (hasTgw) {
      // 将 TGW 垂直居中于 VPC 列
      const vpcColumnTop = LAYOUT.REGION_HEADER_HEIGHT;
      const vpcColumnBottom = maxContentHeight - LAYOUT.REGION_BOTTOM_PADDING;
      const vpcColumnMidY = (vpcColumnTop + vpcColumnBottom) / 2;
      const tgwY = Math.max(
        LAYOUT.REGION_HEADER_HEIGHT + LAYOUT.TGW_TOP_MARGIN,
        vpcColumnMidY - tgwHeight / 2
      );
      nodes.push(createTgwNode(mainRegion.tgw!, mainRegion.id, totalWidth + LAYOUT.TGW_MARGIN, tgwY, tgwHeight));
    }
    currentY += regionContentHeight + LAYOUT.REGION_GAP;
  }

  // 其他区域 - 2 列网格排列，减少 peering 连线交叉
  const otherRegions = regions.filter(r => !r.isMain);
  if (otherRegions.length > 0) {
    // 预计算每个对等区域的尺寸
    const peerDims = otherRegions.map(region => {
      const vpcEntries = Object.entries(region.vpcs);
      const hasTgw = region.tgw?.enabled;
      const tgwHeight = hasTgw ? estimateTgwHeight(region.tgw!) : 0;
      const tgwWidth = hasTgw ? LAYOUT.TGW_WIDTH + LAYOUT.TGW_MARGIN : 0;
      let maxVpcWidth = LAYOUT.VPC_MIN_WIDTH;
      let totalVpcHeight = LAYOUT.REGION_HEADER_HEIGHT;
      const vpcDimensions = vpcEntries.map(([, vpcConfig]) => {
        const dim = calculateVpcDimensions(vpcConfig);
        maxVpcWidth = Math.max(maxVpcWidth, dim.width);
        totalVpcHeight += dim.height + 20;
        return dim;
      });
      totalVpcHeight += LAYOUT.REGION_BOTTOM_PADDING - 20;
      const tgwTotalHeight = tgwHeight + LAYOUT.REGION_HEADER_HEIGHT + LAYOUT.TGW_TOP_MARGIN + LAYOUT.REGION_BOTTOM_PADDING;
      const height = Math.max(totalVpcHeight, tgwTotalHeight);
      const width = maxVpcWidth + LAYOUT.REGION_PADDING * 2 + tgwWidth;
      return { width, height, maxVpcWidth, tgwHeight, vpcDimensions, vpcEntries };
    });

    // 按 2 列分行排列，居中于主区域下方
    for (let i = 0; i < otherRegions.length; i += LAYOUT.PEER_COLS) {
      const rowRegions = otherRegions.slice(i, i + LAYOUT.PEER_COLS);
      const rowDims = peerDims.slice(i, i + LAYOUT.PEER_COLS);
      const rowTotalWidth = rowDims.reduce((s, d) => s + d.width, 0) + (rowDims.length - 1) * LAYOUT.REGION_GAP;
      const rowMaxHeight = Math.max(...rowDims.map(d => d.height));
      const startX = Math.max(0, (mainRegionWidth - rowTotalWidth) / 2);
      let regionX = startX;

      rowRegions.forEach((region, ri) => {
        const dim = rowDims[ri];
        const actualDim = peerDims[i + ri];
        const vpcEntries = actualDim.vpcEntries;
        const hasTgw = region.tgw?.enabled;

        nodes.push({
          id: `region-${region.id}`,
          type: 'region',
          position: { x: regionX, y: currentY },
          data: { label: region.name.toUpperCase(), isMain: false, isPeer: region.tgw?.peer },
          style: { width: dim.width, height: dim.height },
        });

        let vpcY = LAYOUT.REGION_HEADER_HEIGHT;
        vpcEntries.forEach(([vpcName, vpcConfig], index) => {
          const vpcDim = actualDim.vpcDimensions[index];
          const vpcNodes = createVpcWithAzLayout(
            vpcName, vpcConfig, region.id,
            LAYOUT.REGION_PADDING, vpcY, vpcDim.width, vpcDim.height
          );
          nodes.push(...vpcNodes);

          if (hasTgw && hasIntraSubnet(vpcConfig.subnets)) {
            edges.push({
              id: `${region.id}-tgw-${vpcName}`,
              source: `${region.id}-tgw`,
              target: `${region.id}-${vpcName}`,
              sourceHandle: 'source-left',
              targetHandle: 'right',
              type: 'smoothstep',
              animated: true,
              style: { stroke: '#F59E0B', strokeWidth: 2 },
              zIndex: 100,
            });
          }
          vpcY += vpcDim.height + 20;
        });

        if (hasTgw) {
          const tgwY = LAYOUT.REGION_HEADER_HEIGHT + LAYOUT.TGW_TOP_MARGIN;
          nodes.push(createTgwNode(region.tgw!, region.id, actualDim.maxVpcWidth + LAYOUT.REGION_PADDING + LAYOUT.TGW_MARGIN, tgwY, actualDim.tgwHeight));

          if (region.tgw!.peer && mainRegion?.tgw?.enabled) {
            // 根据列位置选择不同的 source handle，避免 peering 线交叉
            const col = ri;
            const sourceHandle = col === 0 ? 'bottom-left' : 'bottom-right';

            edges.push({
              id: `tgw-peer-${region.id}`,
              source: `${mainRegionId}-tgw`,
              target: `${region.id}-tgw`,
              sourceHandle,
              targetHandle: 'top',
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
        regionX += dim.width + LAYOUT.REGION_GAP;
      });

      currentY += rowMaxHeight + LAYOUT.REGION_GAP;
    }
  }

  // VPC 对等连线（跨所有区域）
  addVpcPeeringEdges(regions, edges);

  return { nodes, edges };
}

// ============================================
// 拓扑视图解析 - 纯平面图，无嵌套容器
// 节点：Region标签、VPC、TGW、Account、Component(IGW/NAT/NFW/GWLB)
// 边：TGW↔VPC、TGW↔TGW对等、VPC→Account、VPC→Component
// ============================================

const TOPO = {
  VPC_W: 150, VPC_H: 52,
  TGW_W: 160, TGW_H: 78,
  ACC_W: 120, ACC_H: 30,
  COMP_W: 68, COMP_H: 28,
  EP_W: 140, EP_H: 24, EP_TAG_H: 18,  // Endpoint 节点尺寸
  REGION_LABEL_W: 160, REGION_LABEL_H: 28,
  VPC_GAP_X: 340,            // VPCs 水平间距（需容纳右侧账号节点 150+16+120+54=340）
  COMP_ROW_Y: -65,           // 组件行相对 VPC 的 Y 偏移（上方，留出呼吸空间）
  TGW_GAP_BELOW: 80,         // TGW 在最低元素下方的间距
  PEER_COLS: 2,              // 对等区域列数
  PEER_GAP_X: 380,           // 对等区域列间距（宽裕排布）
  PEER_Y_GAP: 120,           // TGW 到对等区域的垂直间距
  PEER_ROW_GAP: 300,         // 对等区域行间距（含 label+TGW+VPC+comp ≈ 230px + 缓冲）
  COMP_GAP: 78,              // 组件之间的水平间距
};

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

  // 区域标签
  nodes.push({
    id: `topo-label-${mainRegion.id}`,
    type: 'topoRegionLabel',
    position: { x: mainCenterX - TOPO.REGION_LABEL_W / 2, y: -110 },
    data: { label: 'MAIN REGION', isMain: true },
    style: { width: TOPO.REGION_LABEL_W },
  });

  // VPC 行 (y=0)，组件在上方，账号在下方
  const vpcY = 0;
  let maxBottomY = vpcY + TOPO.VPC_H; // 跟踪主区域最低元素的 Y

  mainVpcs.forEach(([vpcName, vpcConfig], i) => {
    const vpcId = `${mainRegion.id}-${vpcName}`;
    const vpcX = i * TOPO.VPC_GAP_X;

    // VPC 节点
    nodes.push({
      id: vpcId,
      type: 'topoVpc',
      position: { x: vpcX, y: vpcY },
      data: { label: vpcName, cidr: vpcConfig.cidr, isHub: vpcConfig.is_hub, isEndpoint: vpcConfig.is_endpoint },
      style: { width: TOPO.VPC_W, height: TOPO.VPC_H },
    });

    // 组件节点 (IGW/NAT/NFW/GWLB) 在 VPC 上方
    const comps: string[] = [];
    if (vpcConfig.igw?.enabled) comps.push('igw');
    if (vpcConfig.nat?.enabled) comps.push('nat');
    if (vpcConfig.nfw?.enabled) comps.push('nfw');
    if (vpcConfig.gwlb?.enabled) comps.push('gwlb');

    const compsStartX = vpcX + (TOPO.VPC_W - comps.length * TOPO.COMP_GAP + (TOPO.COMP_GAP - TOPO.COMP_W)) / 2;
    comps.forEach((comp, ci) => {
      const compId = `${vpcId}-comp-${comp}`;
      nodes.push({
        id: compId,
        type: 'topoComponent',
        position: { x: compsStartX + ci * TOPO.COMP_GAP, y: vpcY + TOPO.COMP_ROW_Y },
        data: { compType: comp },
        style: { width: TOPO.COMP_W, height: TOPO.COMP_H },
      });
      edges.push({
        id: `edge-comp-${compId}`,
        source: compId,
        target: vpcId,
        sourceHandle: 'source-bottom',
        targetHandle: 'top',
        type: 'bezier',
        style: { stroke: '#475569', strokeWidth: 1.5 },
      });
    });

    // 账号节点在 VPC 右侧（避免和 TGW 连线交叉）
    if (vpcConfig.accounts?.length) {
      vpcConfig.accounts.forEach((acc, ai) => {
        const accId = `${vpcId}-acc-${ai}`;
        const accX = vpcX + TOPO.VPC_W + 16;
        const accY = vpcY + 10 + ai * (TOPO.ACC_H + 8);
        nodes.push({
          id: accId,
          type: 'topoAccount',
          position: { x: accX, y: accY },
          data: { accountId: acc },
          style: { width: TOPO.ACC_W, height: TOPO.ACC_H },
        });
        edges.push({
          id: `edge-acc-${accId}`,
          source: vpcId,
          target: accId,
          sourceHandle: 'source-right',
          targetHandle: 'left',
          type: 'bezier',
          style: { stroke: '#3b82f6', strokeWidth: 1.5, strokeDasharray: '4,3' },
        });
        maxBottomY = Math.max(maxBottomY, accY + TOPO.ACC_H);
      });
    }

    // Endpoint 节点在 VPC 右侧（账号节点下方）
    let epOffsetY = vpcY + 10 + (vpcConfig.accounts?.length || 0) * (TOPO.ACC_H + 8);
    if (vpcConfig.endpoints?.length) {
      const epId = `${vpcId}-ep-iface`;
      const epH = TOPO.EP_H + Math.ceil(vpcConfig.endpoints.length / 3) * TOPO.EP_TAG_H + 4;
      nodes.push({
        id: epId,
        type: 'topoEndpoint',
        position: { x: vpcX + TOPO.VPC_W + 16, y: epOffsetY },
        data: { endpoints: vpcConfig.endpoints, isGateway: false },
        style: { width: TOPO.EP_W, height: epH },
      });
      edges.push({
        id: `edge-ep-${epId}`,
        source: vpcId,
        target: epId,
        sourceHandle: 'source-right',
        targetHandle: 'left',
        type: 'bezier',
        style: { stroke: '#8b5cf6', strokeWidth: 1.5, strokeDasharray: '4,3' },
      });
      epOffsetY += epH + 8;
      maxBottomY = Math.max(maxBottomY, epOffsetY);
    }
    if (vpcConfig.gw_endpoints?.length) {
      const epId = `${vpcId}-ep-gw`;
      const epH = TOPO.EP_H + Math.ceil(vpcConfig.gw_endpoints.length / 3) * TOPO.EP_TAG_H + 4;
      nodes.push({
        id: epId,
        type: 'topoEndpoint',
        position: { x: vpcX + TOPO.VPC_W + 16, y: epOffsetY },
        data: { endpoints: vpcConfig.gw_endpoints, isGateway: true },
        style: { width: TOPO.EP_W, height: epH },
      });
      edges.push({
        id: `edge-ep-${epId}`,
        source: vpcId,
        target: epId,
        sourceHandle: 'source-right',
        targetHandle: 'left',
        type: 'bezier',
        style: { stroke: '#8b5cf6', strokeWidth: 1.5, strokeDasharray: '4,3' },
      });
      maxBottomY = Math.max(maxBottomY, epOffsetY + epH);
    }

    // TGW ↔ VPC 连线：从 VPC 底部到 TGW 顶部（TGW 在下方）
    if (hasTgw && hasIntraSubnet(vpcConfig.subnets)) {
      edges.push({
        id: `${mainRegion.id}-tgw-${vpcName}`,
        source: vpcId,
        target: `${mainRegion.id}-tgw`,
        sourceHandle: 'source-bottom',
        targetHandle: 'top',
        type: 'bezier',
        animated: true,
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
      data: { label: 'TGW', asn: mainRegion.tgw!.asn, cidr: mainRegion.tgw!.cidr, peer: false },
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

  // ---------- 对等区域（2 列网格，居中在 TGW 下方） ----------
  const otherRegions = regions.filter(r => !r.isMain);
  if (otherRegions.length > 0) {
    const peerBaseY = tgwBottomY + TOPO.PEER_Y_GAP;

    for (let rowStart = 0; rowStart < otherRegions.length; rowStart += TOPO.PEER_COLS) {
      const rowRegions = otherRegions.slice(rowStart, rowStart + TOPO.PEER_COLS);
      const row = Math.floor(rowStart / TOPO.PEER_COLS);
      const rowY = peerBaseY + row * TOPO.PEER_ROW_GAP;

      // 居中该行
      const rowWidth = rowRegions.length * TOPO.PEER_GAP_X;
      const rowStartX = mainCenterX - rowWidth / 2;

      rowRegions.forEach((region, ri) => {
        const regionCenterX = rowStartX + ri * TOPO.PEER_GAP_X + TOPO.PEER_GAP_X / 2;
        const peerVpcs = Object.entries(region.vpcs);
        const peerHasTgw = region.tgw?.enabled;
        const globalIdx = rowStart + ri;

        // 区域标签
        nodes.push({
          id: `topo-label-${region.id}`,
          type: 'topoRegionLabel',
          position: { x: regionCenterX - TOPO.REGION_LABEL_W / 2, y: rowY },
          data: { label: region.name.toUpperCase(), isMain: false },
          style: { width: TOPO.REGION_LABEL_W },
        });

        // TGW（标签下方留出间距）
        if (peerHasTgw) {
          const tgwX = regionCenterX - TOPO.TGW_W / 2;
          const tgwY = rowY + TOPO.REGION_LABEL_H + 16;
          nodes.push({
            id: `${region.id}-tgw`,
            type: 'topoTgw',
            position: { x: tgwX, y: tgwY },
            data: { label: 'TGW', asn: region.tgw!.asn, cidr: region.tgw!.cidr, peer: region.tgw!.peer },
            style: { width: TOPO.TGW_W, height: TOPO.TGW_H },
          });

          // TGW 对等连线到主区域 TGW（使用 bezier 避免交叉）
          if (region.tgw!.peer && mainRegion.tgw?.enabled) {
            // 根据对等区域位置选择不同的 source handle
            const col = globalIdx % TOPO.PEER_COLS;
            const sourceHandle = otherRegions.length <= 1 ? 'source-bottom'
              : col === 0 ? 'source-left' : 'source-right';

            edges.push({
              id: `tgw-peer-${region.id}`,
              source: `${mainRegionId}-tgw`,
              target: `${region.id}-tgw`,
              sourceHandle,
              targetHandle: 'top',
              type: 'bezier',
              animated: true,
              label: 'Peering',
              labelStyle: { fill: '#F59E0B', fontWeight: 600, fontSize: 10 },
              labelBgStyle: { fill: '#1e293b', fillOpacity: 0.9 },
              labelBgPadding: [4, 3] as [number, number],
              labelBgBorderRadius: 4,
              style: { stroke: '#F59E0B', strokeWidth: 2, strokeDasharray: '8,4' },
            });
          }
        }

        // VPCs（TGW 下方，留出足够间距）
        const vpcStartX = regionCenterX - (peerVpcs.length * TOPO.VPC_GAP_X) / 2 + (TOPO.VPC_GAP_X - TOPO.VPC_W) / 2;
        const peerVpcY = rowY + TOPO.REGION_LABEL_H + 16 + TOPO.TGW_H + 30;

        peerVpcs.forEach(([vpcName, vpcConfig], vi) => {
          const vpcId = `${region.id}-${vpcName}`;
          const vpcX = vpcStartX + vi * TOPO.VPC_GAP_X;

          nodes.push({
            id: vpcId,
            type: 'topoVpc',
            position: { x: vpcX, y: peerVpcY },
            data: { label: vpcName, cidr: vpcConfig.cidr, isHub: vpcConfig.is_hub, isEndpoint: vpcConfig.is_endpoint },
            style: { width: TOPO.VPC_W, height: TOPO.VPC_H },
          });

          // TGW → VPC
          if (peerHasTgw && hasIntraSubnet(vpcConfig.subnets)) {
            edges.push({
              id: `${region.id}-tgw-${vpcName}`,
              source: `${region.id}-tgw`,
              target: vpcId,
              sourceHandle: 'source-bottom',
              targetHandle: 'top',
              type: 'bezier',
              animated: true,
              style: { stroke: '#F59E0B', strokeWidth: 2 },
            });
          }

          // 组件 (below VPC in peer region)
          const comps: string[] = [];
          if (vpcConfig.igw?.enabled) comps.push('igw');
          if (vpcConfig.nat?.enabled) comps.push('nat');
          if (vpcConfig.nfw?.enabled) comps.push('nfw');
          if (vpcConfig.gwlb?.enabled) comps.push('gwlb');

          const compsStartX = vpcX + (TOPO.VPC_W - comps.length * TOPO.COMP_GAP + (TOPO.COMP_GAP - TOPO.COMP_W)) / 2;
          comps.forEach((comp, ci) => {
            const compId = `${vpcId}-comp-${comp}`;
            nodes.push({
              id: compId,
              type: 'topoComponent',
              position: { x: compsStartX + ci * TOPO.COMP_GAP, y: peerVpcY + TOPO.VPC_H + 20 },
              data: { compType: comp },
              style: { width: TOPO.COMP_W, height: TOPO.COMP_H },
            });
            edges.push({
              id: `edge-comp-${compId}`,
              source: vpcId,
              target: compId,
              sourceHandle: 'source-bottom',
              targetHandle: 'target-top',
              type: 'bezier',
              style: { stroke: '#475569', strokeWidth: 1.5 },
            });
          });
        });
      });
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
  height: number
): Node[] {
  const nodes: Node[] = [];
  const vpcId = `${regionId}-${vpcName}`;

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
