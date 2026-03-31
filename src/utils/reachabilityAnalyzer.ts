/**
 * VPC Reachability Analyzer
 * Traces network paths through TGW route tables to determine connectivity.
 */
import type { NetworkConfig, TgwConfig, VpcConfig, RegionConfig, RouteTableConfig } from '../types/network';

// ========== Types ==========

export interface Endpoint {
  type: 'vpc' | 'tgw' | 'ip';
  regionId: string;
  name: string;       // VPC name or 'tgw'
  cidr?: string;      // resolved CIDR for matching
}

export interface PathHop {
  type: 'vpc' | 'tgw' | 'tgw-peering';
  regionId: string;
  name: string;
  nodeId: string;
  routeTable?: {
    tableName: string;
    matchedRoute?: { key: string; target: string; displayKey: string; displayTarget: string };
    matchType?: 'static' | 'propagation' | 'default';
  };
}

export interface ReachabilityResult {
  reachable: boolean;
  path: PathHop[];
  errors: string[];
  nodeIds: string[];
  edgeIds: string[];
  sourceId: string;
  destId: string;
}

type TFn = (zh: string, en: string) => string;

// ========== CIDR Helpers ==========

function parseCidr(cidr: string): { ip: number; mask: number; prefix: number } | null {
  const m = cidr.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/);
  if (!m) return null;
  const [, a, b, c, d, p] = m.map(Number);
  const ip = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
  const prefix = p;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return { ip: (ip & mask) >>> 0, mask, prefix };
}

function cidrContains(outer: string, inner: string): boolean {
  const o = parseCidr(outer);
  const i = parseCidr(inner);
  if (!o || !i) return false;
  return (i.ip & o.mask) >>> 0 === o.ip && i.prefix >= o.prefix;
}

// ========== Region/Config Helpers ==========

const ROOT_LEVEL_KEYS = ['vpcs', 'tgw', 'resolver', 'dx', 'variables'];

interface RegionInfo {
  id: string;
  vpcs: Record<string, VpcConfig>;
  tgw?: TgwConfig;
  isMain: boolean;
}

function getRegions(config: NetworkConfig): RegionInfo[] {
  const regions: RegionInfo[] = [];
  if (config.vpcs) {
    regions.push({ id: 'main', vpcs: config.vpcs, tgw: config.tgw, isMain: true });
  }
  Object.entries(config).forEach(([key, value]) => {
    if (ROOT_LEVEL_KEYS.includes(key) || !value || typeof value !== 'object') return;
    if (!('vpcs' in value)) return;
    const rc = value as RegionConfig;
    regions.push({ id: key, vpcs: rc.vpcs || {}, tgw: rc.tgw, isMain: false });
  });
  return regions;
}

function findRegionForVpc(regions: RegionInfo[], vpcName: string, regionHint?: string): RegionInfo | undefined {
  if (regionHint) {
    return regions.find(r => r.id === regionHint && r.vpcs[vpcName]);
  }
  return regions.find(r => r.vpcs[vpcName]);
}

function findAssociatedTable(tgw: TgwConfig, attachment: string): { tableName: string; table: RouteTableConfig } | null {
  if (!tgw.tables) return null;
  for (const [tableName, table] of Object.entries(tgw.tables)) {
    if (table.associations?.includes(attachment)) {
      return { tableName, table };
    }
  }
  return null;
}

/** Check if VPC has intra/TGW subnet */
function hasIntraSubnet(vpc: VpcConfig): boolean {
  const subnets = vpc.subnets;
  if (!subnets) return false;
  if (Array.isArray(subnets)) {
    return subnets.length > 0 && subnets[0]?.length > 0;
  }
  return 'intra' in subnets || 'tgw' in subnets;
}

// ========== Route Matching ==========

/**
 * Route key types and matching strategy:
 * - Region name (e.g. "us-west-1", "main"): matches if destination BELONGS to that region
 * - "*": default route, matches everything (lowest priority)
 * - "tgw": matches current region TGW CIDR
 * - CIDR (e.g. "179.179.179.0/24"): standard CIDR containment
 * - VPC name: matches that VPC's CIDR in the current region
 *
 * Priority: propagation/CIDR (longest prefix) > region-name match > default "*"
 */

const REGION_NAME_RE = /^[a-z]{2}-[a-z]+-\d+$/;

/** Check if a CIDR belongs to a region (any VPC or TGW CIDR contains it) */
function cidrBelongsToRegion(destCidr: string, region: RegionInfo): boolean {
  if (region.tgw?.cidr && cidrContains(region.tgw.cidr, destCidr)) return true;
  for (const vpc of Object.values(region.vpcs)) {
    if (vpc.cidr && cidrContains(vpc.cidr, destCidr)) return true;
  }
  return false;
}

function getRouteKeyDisplay(key: string): string {
  if (key === '*') return '0.0.0.0/0';
  if (key === 'tgw') return 'TGW CIDR';
  if (key === 'main') return 'Main Region';
  if (REGION_NAME_RE.test(key)) return key;
  return key;
}

function getRouteTargetDisplay(key: string, target: string): string {
  if (target === 'blackhole') return 'Blackhole';
  if (target === 'peer') {
    if (key === 'main') return 'Main TGW (Peering)';
    if (REGION_NAME_RE.test(key)) return `${key} TGW (Peering)`;
    return 'Peer TGW';
  }
  return target;
}

// Match priority levels (higher = more specific = preferred)
const PRIO_DEFAULT   = 0;   // "*"
const PRIO_REGION    = 100; // region-name match (e.g. "us-west-1": "peer")
const PRIO_CIDR_BASE = 200; // CIDR-based: 200 + prefix length

interface MatchedRoute {
  key: string;
  target: string;
  priority: number;
  type: 'static' | 'propagation';
  displayKey: string;
  displayTarget: string;
}

function findBestRoute(
  table: RouteTableConfig,
  destCidr: string,
  _config: NetworkConfig,
  regions: RegionInfo[],
  regionId: string,
  destRegionId?: string,
): MatchedRoute | null {
  const candidates: MatchedRoute[] = [];

  // --- Static routes ---
  if (table.routes) {
    for (const [key, target] of Object.entries(table.routes)) {
      let matched = false;
      let priority = 0;

      if (key === '*') {
        // Default route — matches everything, lowest priority
        matched = true;
        priority = PRIO_DEFAULT;

      } else if (key === 'main' || REGION_NAME_RE.test(key)) {
        // Region-name key: match by region membership, NOT CIDR containment
        const targetRegionId = key === 'main' ? 'main' : key;
        if (destRegionId && destRegionId === targetRegionId) {
          matched = true;
        } else {
          // Fallback: check if destCidr belongs to the target region's address space
          const targetRegion = regions.find(r => r.id === targetRegionId);
          if (targetRegion && cidrBelongsToRegion(destCidr, targetRegion)) {
            matched = true;
          }
        }
        if (matched) priority = PRIO_REGION;

      } else if (key === 'tgw') {
        // TGW CIDR of the current region
        const region = regions.find(r => r.id === regionId);
        const tgwCidr = region?.tgw?.cidr;
        if (tgwCidr && cidrContains(tgwCidr, destCidr)) {
          matched = true;
          priority = PRIO_CIDR_BASE + (parseCidr(tgwCidr)?.prefix || 0);
        }

      } else if (parseCidr(key)) {
        // Explicit CIDR key
        if (cidrContains(key, destCidr)) {
          matched = true;
          priority = PRIO_CIDR_BASE + (parseCidr(key)?.prefix || 0);
        }

      } else {
        // VPC name in current region
        const region = regions.find(r => r.id === regionId);
        const vpc = region?.vpcs[key];
        if (vpc?.cidr && cidrContains(vpc.cidr, destCidr)) {
          matched = true;
          priority = PRIO_CIDR_BASE + (parseCidr(vpc.cidr)?.prefix || 0);
        }
      }

      if (matched) {
        candidates.push({
          key, target, priority,
          type: 'static',
          displayKey: getRouteKeyDisplay(key),
          displayTarget: getRouteTargetDisplay(key, target),
        });
      }
    }
  }

  // --- Propagated routes (VPC CIDRs — always CIDR-level matching) ---
  if (table.propagations) {
    const region = regions.find(r => r.id === regionId);
    for (const vpcName of table.propagations) {
      if (vpcName === 'peer') continue;
      // Allow vpn-* / dx-* propagations — skip CIDR check (they propagate dynamically)
      if (/^(vpn|dx|dxgw|connect)-/.test(vpcName)) continue;
      const vpc = region?.vpcs[vpcName];
      if (!vpc?.cidr) continue;
      const p = parseCidr(vpc.cidr);
      if (!p) continue;
      if (cidrContains(vpc.cidr, destCidr)) {
        candidates.push({
          key: vpc.cidr, target: vpcName,
          priority: PRIO_CIDR_BASE + p.prefix,
          type: 'propagation',
          displayKey: `${vpc.cidr} (${vpcName})`,
          displayTarget: `${vpcName} (propagated)`,
        });
      }
    }
  }

  if (candidates.length === 0) return null;

  // Higher priority wins; at same priority, static > propagation
  candidates.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (a.type === 'static' && b.type === 'propagation') return -1;
    if (a.type === 'propagation' && b.type === 'static') return 1;
    return 0;
  });
  return candidates[0];
}

// ========== Main Analysis ==========

export function analyzeReachability(
  config: NetworkConfig,
  source: Endpoint,
  dest: Endpoint,
  tFn: TFn,
): ReachabilityResult {
  const regions = getRegions(config);
  const path: PathHop[] = [];
  const errors: string[] = [];
  const nodeIds: string[] = [];
  const edgeIds: string[] = [];
  const visited = new Set<string>(); // prevent infinite loops

  // Resolve source
  let srcRegion: RegionInfo | undefined;
  let srcVpcName: string | undefined;
  let srcCidr: string | undefined;

  if (source.type === 'vpc') {
    srcRegion = findRegionForVpc(regions, source.name, source.regionId);
    if (!srcRegion) {
      return { reachable: false, path, errors: [tFn(`源 VPC "${source.name}" 未找到`, `Source VPC "${source.name}" not found`)], nodeIds, edgeIds, sourceId: '', destId: '' };
    }
    srcVpcName = source.name;
    srcCidr = srcRegion.vpcs[source.name]?.cidr;
    if (!hasIntraSubnet(srcRegion.vpcs[source.name])) {
      errors.push(tFn(`源 VPC "${source.name}" 没有 Intra/TGW 子网，无法连接 TGW`, `Source VPC "${source.name}" has no intra/TGW subnet for TGW attachment`));
    }
  } else if (source.type === 'tgw') {
    srcRegion = regions.find(r => r.id === source.regionId);
    if (!srcRegion?.tgw?.enabled) {
      return { reachable: false, path, errors: [tFn(`源区域 "${source.regionId}" 没有启用 TGW`, `Source region "${source.regionId}" has no enabled TGW`)], nodeIds, edgeIds, sourceId: '', destId: '' };
    }
    srcCidr = srcRegion.tgw.cidr;
  } else {
    // IP address
    srcCidr = source.cidr || source.name;
    // Find which region/VPC contains this IP
    for (const r of regions) {
      for (const [vn, vc] of Object.entries(r.vpcs)) {
        if (vc.cidr && cidrContains(vc.cidr, srcCidr!)) {
          srcRegion = r;
          srcVpcName = vn;
          break;
        }
      }
      if (srcRegion) break;
    }
    if (!srcRegion) {
      return { reachable: false, path, errors: [tFn(`源 IP "${srcCidr}" 不属于任何已知 VPC`, `Source IP "${srcCidr}" does not belong to any known VPC`)], nodeIds, edgeIds, sourceId: '', destId: '' };
    }
  }

  // Resolve destination CIDR
  let destCidr: string;
  let destRegion: RegionInfo | undefined;
  let destVpcName: string | undefined;
  let destNodeId = '';

  if (dest.type === 'vpc') {
    destRegion = findRegionForVpc(regions, dest.name, dest.regionId);
    if (!destRegion) {
      return { reachable: false, path, errors: [tFn(`目标 VPC "${dest.name}" 未找到`, `Destination VPC "${dest.name}" not found`)], nodeIds, edgeIds, sourceId: '', destId: '' };
    }
    destVpcName = dest.name;
    destCidr = destRegion.vpcs[dest.name]?.cidr || '';
    destNodeId = `${destRegion.id}-${dest.name}`;
  } else if (dest.type === 'tgw') {
    destRegion = regions.find(r => r.id === dest.regionId);
    if (!destRegion?.tgw) {
      return { reachable: false, path, errors: [tFn(`目标区域 "${dest.regionId}" 没有 TGW`, `Destination region "${dest.regionId}" has no TGW`)], nodeIds, edgeIds, sourceId: '', destId: '' };
    }
    destCidr = destRegion.tgw.cidr;
    destNodeId = `${dest.regionId}-tgw`;
  } else {
    destCidr = dest.cidr || dest.name;
    // Try to find matching VPC
    for (const r of regions) {
      for (const [vn, vc] of Object.entries(r.vpcs)) {
        if (vc.cidr && cidrContains(vc.cidr, destCidr)) {
          destRegion = r;
          destVpcName = vn;
          destNodeId = `${r.id}-${vn}`;
          break;
        }
      }
      if (destRegion) break;
    }
  }

  // Source node
  const sourceNodeId = source.type === 'tgw'
    ? `${srcRegion!.id}-tgw`
    : srcVpcName ? `${srcRegion!.id}-${srcVpcName}` : '';

  // Add source VPC hop
  if (srcVpcName) {
    path.push({
      type: 'vpc', regionId: srcRegion!.id, name: srcVpcName,
      nodeId: `${srcRegion!.id}-${srcVpcName}`,
    });
    nodeIds.push(`${srcRegion!.id}-${srcVpcName}`);
  }

  // === Same VPC check ===
  if (srcRegion && destRegion && srcRegion.id === destRegion?.id && srcVpcName && destVpcName && srcVpcName === destVpcName) {
    path.push({
      type: 'vpc', regionId: destRegion.id, name: destVpcName,
      nodeId: destNodeId,
    });
    return { reachable: true, path, errors: [], nodeIds: [sourceNodeId], edgeIds: [], sourceId: sourceNodeId, destId: destNodeId };
  }

  // === Trace through TGW ===
  let currentRegion = srcRegion!;
  let currentAttachment = srcVpcName || 'tgw'; // what enters the TGW

  // Iterative path tracing (max 10 hops to avoid infinite loops)
  for (let hop = 0; hop < 10; hop++) {
    const hopKey = `${currentRegion.id}:${currentAttachment}`;
    if (visited.has(hopKey)) {
      errors.push(tFn('检测到路由环路', 'Routing loop detected'));
      return { reachable: false, path, errors, nodeIds, edgeIds, sourceId: sourceNodeId, destId: destNodeId };
    }
    visited.add(hopKey);

    if (!currentRegion.tgw?.enabled) {
      errors.push(tFn(`区域 "${currentRegion.id}" 没有启用 TGW`, `Region "${currentRegion.id}" has no enabled TGW`));
      return { reachable: false, path, errors, nodeIds, edgeIds, sourceId: sourceNodeId, destId: destNodeId };
    }

    // Find which route table the attachment is associated with
    const tableResult = findAssociatedTable(currentRegion.tgw, currentAttachment);
    if (!tableResult) {
      errors.push(tFn(
        `"${currentAttachment}" 在区域 "${currentRegion.id}" 的 TGW 中未关联任何路由表`,
        `"${currentAttachment}" is not associated with any route table in region "${currentRegion.id}" TGW`,
      ));
      // Add TGW hop without route info
      path.push({
        type: 'tgw', regionId: currentRegion.id, name: 'TGW',
        nodeId: `${currentRegion.id}-tgw`,
      });
      nodeIds.push(`${currentRegion.id}-tgw`);
      if (srcVpcName && hop === 0) edgeIds.push(`${currentRegion.id}-tgw-${srcVpcName}`);
      return { reachable: false, path, errors, nodeIds, edgeIds, sourceId: sourceNodeId, destId: destNodeId };
    }

    // Find matching route
    const match = findBestRoute(tableResult.table, destCidr, config, regions, currentRegion.id, destRegion?.id);

    // Add TGW hop
    const tgwHop: PathHop = {
      type: 'tgw', regionId: currentRegion.id, name: 'TGW',
      nodeId: `${currentRegion.id}-tgw`,
      routeTable: {
        tableName: tableResult.tableName,
        matchedRoute: match ? {
          key: match.key,
          target: match.target,
          displayKey: match.displayKey,
          displayTarget: match.displayTarget,
        } : undefined,
        matchType: match?.type,
      },
    };
    path.push(tgwHop);
    nodeIds.push(`${currentRegion.id}-tgw`);

    // Add edge from source VPC to TGW (first hop only)
    if (hop === 0 && srcVpcName) {
      edgeIds.push(`${currentRegion.id}-tgw-${srcVpcName}`);
    }
    // If coming from peering, the edge was already added
    if (hop > 0 && currentAttachment === 'peer') {
      // peering edge was added by the previous hop
    }

    if (!match) {
      errors.push(tFn(
        `在区域 "${currentRegion.id}" 路由表 "${tableResult.tableName}" 中未找到匹配 "${destCidr}" 的路由`,
        `No route matching "${destCidr}" found in route table "${tableResult.tableName}" in region "${currentRegion.id}"`,
      ));
      return { reachable: false, path, errors, nodeIds, edgeIds, sourceId: sourceNodeId, destId: destNodeId };
    }

    // Follow the route target
    if (match.target === 'blackhole') {
      errors.push(tFn(
        `路由表 "${tableResult.tableName}" 中 "${match.displayKey}" 的目标是黑洞，流量被丢弃`,
        `Route "${match.displayKey}" in table "${tableResult.tableName}" targets blackhole — traffic dropped`,
      ));
      return { reachable: false, path, errors, nodeIds, edgeIds, sourceId: sourceNodeId, destId: destNodeId };
    }

    if (match.target === 'peer') {
      // Cross-region peering
      let peerRegionId: string;
      if (match.key === 'main') {
        peerRegionId = 'main';
      } else if (match.key.match(/^[a-z]{2}-[a-z]+-\d+$/)) {
        peerRegionId = match.key;
      } else {
        // CIDR-based peer route — try to find the peer region
        const mainRegion = regions.find(r => r.isMain);
        if (currentRegion.isMain) {
          // Find which peer region matches
          const pr = regions.find(r => !r.isMain && r.tgw?.cidr && cidrContains(r.tgw.cidr, destCidr));
          peerRegionId = pr?.id || '';
        } else {
          peerRegionId = mainRegion?.id || 'main';
        }
      }

      const peerRegion = regions.find(r => r.id === peerRegionId);
      if (!peerRegion?.tgw?.enabled) {
        errors.push(tFn(
          `对等区域 "${peerRegionId}" 没有启用 TGW`,
          `Peer region "${peerRegionId}" has no enabled TGW`,
        ));
        return { reachable: false, path, errors, nodeIds, edgeIds, sourceId: sourceNodeId, destId: destNodeId };
      }

      // Add peering hop
      path.push({
        type: 'tgw-peering',
        regionId: `${currentRegion.id} → ${peerRegionId}`,
        name: 'TGW Peering',
        nodeId: `tgw-peer-${currentRegion.isMain ? peerRegionId : 'main'}`,
      });

      // Add peering edge
      if (currentRegion.isMain) {
        edgeIds.push(`tgw-peer-${peerRegionId}`);
      } else {
        edgeIds.push(`tgw-peer-${currentRegion.id}`);
      }

      // Continue tracing in the peer region
      currentRegion = peerRegion;
      currentAttachment = 'peer';
      continue;
    }

    // Target is a VPC or attachment name
    const targetVpc = currentRegion.vpcs[match.target];
    if (targetVpc) {
      // Reached a VPC
      const targetNodeId = `${currentRegion.id}-${match.target}`;
      edgeIds.push(`${currentRegion.id}-tgw-${match.target}`);
      path.push({
        type: 'vpc', regionId: currentRegion.id, name: match.target,
        nodeId: targetNodeId,
      });
      nodeIds.push(targetNodeId);

      // Check if this is the destination
      const isDestination = (destVpcName && match.target === destVpcName && currentRegion.id === destRegion?.id)
        || (targetVpc.cidr && cidrContains(targetVpc.cidr, destCidr));

      if (isDestination) {
        return {
          reachable: true, path, errors: [],
          nodeIds, edgeIds,
          sourceId: sourceNodeId, destId: destNodeId || targetNodeId,
        };
      }

      // VPC is NOT the destination — in hub-and-spoke, the VPC (typically hub)
      // routes traffic back to TGW via its TGW attachment, entering a different
      // route table (the one this VPC is associated with). Continue tracing.
      if (hasIntraSubnet(targetVpc)) {
        currentAttachment = match.target;
        continue;
      }

      // VPC has no TGW attachment — cannot continue
      errors.push(tFn(
        `流量到达 VPC "${match.target}"，但该 VPC 没有 TGW 子网，无法继续转发`,
        `Traffic reached VPC "${match.target}" but it has no TGW subnet to forward traffic`,
      ));
      return { reachable: false, path, errors, nodeIds, edgeIds, sourceId: sourceNodeId, destId: destNodeId || targetNodeId };
    }

    // Unknown attachment target (VPN, DX, connect, etc.)
    errors.push(tFn(
      `路由目标 "${match.target}" 是非 VPC 附件（可能是 VPN/DX/Connect），路径分析到此结束`,
      `Route target "${match.target}" is a non-VPC attachment (possibly VPN/DX/Connect), path analysis ends here`,
    ));
    return { reachable: false, path, errors, nodeIds, edgeIds, sourceId: sourceNodeId, destId: destNodeId };
  }

  errors.push(tFn('路径跟踪超过最大跳数限制 (10)', 'Path tracing exceeded maximum hop count (10)'));
  return { reachable: false, path, errors, nodeIds, edgeIds, sourceId: sourceNodeId, destId: destNodeId };
}

/** Get all available endpoints from config for UI dropdowns */
export function getAvailableEndpoints(config: NetworkConfig): { vpcs: { regionId: string; name: string; cidr: string }[]; tgws: { regionId: string; cidr: string }[] } {
  const regions = getRegions(config);
  const vpcs: { regionId: string; name: string; cidr: string }[] = [];
  const tgws: { regionId: string; cidr: string }[] = [];

  regions.forEach(r => {
    Object.entries(r.vpcs).forEach(([name, vpc]) => {
      if (vpc.enabled !== false) {
        vpcs.push({ regionId: r.id, name, cidr: vpc.cidr });
      }
    });
    if (r.tgw?.enabled) {
      tgws.push({ regionId: r.id, cidr: r.tgw.cidr });
    }
  });

  return { vpcs, tgws };
}
