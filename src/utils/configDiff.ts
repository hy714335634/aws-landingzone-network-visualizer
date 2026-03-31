/**
 * Deep config diff engine.
 * Compares two NetworkConfig objects and produces field-level diffs.
 */
import type { NetworkConfig, VpcConfig, TgwConfig, RegionConfig, RouteTableConfig } from '../types/network';

// ========== Types ==========

export interface FieldDiff {
  path: string;                          // e.g. "tgw.tables.post.associations"
  type: 'added' | 'removed' | 'changed';
  oldValue?: unknown;
  newValue?: unknown;
  displayOld?: string;
  displayNew?: string;
}

export interface ResourceDiff {
  kind: 'VPC' | 'TGW' | 'Route Table' | 'Region' | 'Resolver' | 'DX';
  name: string;
  regionId: string;
  changeType: 'added' | 'removed' | 'modified';
  fields: FieldDiff[];
  nodeId: string;
  jsonPath: string;
}

export interface DiffSummary {
  added: number;
  removed: number;
  modified: number;
  resources: ResourceDiff[];
  /** Edge diffs: edges present in one config but not the other */
  edgeChanges: { id: string; type: 'added' | 'removed' }[];
}

// ========== Helpers ==========

const ROOT_LEVEL_KEYS = ['vpcs', 'tgw', 'resolver', 'dx', 'variables'];

function fmt(v: unknown): string {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.length === 0 ? '[]' : v.join(', ');
  return JSON.stringify(v);
}

/** Compare two arrays as sets (order-insensitive) */
function arraySetDiff(oldArr: string[] | undefined, newArr: string[] | undefined, path: string): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const oldSet = new Set(oldArr || []);
  const newSet = new Set(newArr || []);
  const added = [...newSet].filter(x => !oldSet.has(x));
  const removed = [...oldSet].filter(x => !newSet.has(x));
  if (added.length > 0) {
    diffs.push({ path, type: 'added', newValue: added, displayNew: `+ ${added.join(', ')}` });
  }
  if (removed.length > 0) {
    diffs.push({ path, type: 'removed', oldValue: removed, displayOld: `- ${removed.join(', ')}` });
  }
  return diffs;
}

/** Compare two route maps */
function routesDiff(oldRoutes: Record<string, string> | undefined, newRoutes: Record<string, string> | undefined, basePath: string): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const allKeys = new Set([...Object.keys(oldRoutes || {}), ...Object.keys(newRoutes || {})]);
  for (const key of allKeys) {
    const ov = oldRoutes?.[key];
    const nv = newRoutes?.[key];
    const p = `${basePath}.${key}`;
    if (ov === undefined && nv !== undefined) {
      diffs.push({ path: p, type: 'added', newValue: `${key}: ${nv}`, displayNew: `${key} → ${nv}` });
    } else if (ov !== undefined && nv === undefined) {
      diffs.push({ path: p, type: 'removed', oldValue: `${key}: ${ov}`, displayOld: `${key} → ${ov}` });
    } else if (ov !== nv) {
      diffs.push({ path: p, type: 'changed', oldValue: ov, newValue: nv, displayOld: `${key} → ${ov}`, displayNew: `${key} → ${nv}` });
    }
  }
  return diffs;
}

/** Compare a single route table */
function diffRouteTable(oldT: RouteTableConfig | undefined, newT: RouteTableConfig | undefined, basePath: string): FieldDiff[] {
  if (!oldT && !newT) return [];
  if (!oldT) return [{ path: basePath, type: 'added', newValue: newT, displayNew: 'new table' }];
  if (!newT) return [{ path: basePath, type: 'removed', oldValue: oldT, displayOld: 'removed' }];
  const diffs: FieldDiff[] = [];
  diffs.push(...arraySetDiff(oldT.associations, newT.associations, `${basePath}.associations`));
  diffs.push(...arraySetDiff(oldT.propagations, newT.propagations, `${basePath}.propagations`));
  diffs.push(...routesDiff(oldT.routes, newT.routes, `${basePath}.routes`));
  return diffs;
}

/** Compare two scalar/boolean/string fields */
function scalarDiff(oldV: unknown, newV: unknown, path: string): FieldDiff[] {
  if (oldV === newV) return [];
  if (oldV === undefined && newV !== undefined) return [{ path, type: 'added', newValue: newV, displayNew: fmt(newV) }];
  if (oldV !== undefined && newV === undefined) return [{ path, type: 'removed', oldValue: oldV, displayOld: fmt(oldV) }];
  return [{ path, type: 'changed', oldValue: oldV, newValue: newV, displayOld: fmt(oldV), displayNew: fmt(newV) }];
}

// ========== VPC Diff ==========

function diffVpc(oldVpc: VpcConfig | undefined, newVpc: VpcConfig | undefined, basePath: string): FieldDiff[] {
  if (!oldVpc && !newVpc) return [];
  if (!oldVpc) return [{ path: basePath, type: 'added', displayNew: `CIDR: ${newVpc!.cidr}` }];
  if (!newVpc) return [{ path: basePath, type: 'removed', displayOld: `CIDR: ${oldVpc.cidr}` }];
  const diffs: FieldDiff[] = [];
  diffs.push(...scalarDiff(oldVpc.cidr, newVpc.cidr, `${basePath}.cidr`));
  diffs.push(...scalarDiff(oldVpc.is_hub, newVpc.is_hub, `${basePath}.is_hub`));
  diffs.push(...scalarDiff(oldVpc.is_endpoint, newVpc.is_endpoint, `${basePath}.is_endpoint`));
  diffs.push(...scalarDiff(oldVpc.enabled, newVpc.enabled, `${basePath}.enabled`));
  diffs.push(...scalarDiff(oldVpc.igw?.enabled, newVpc.igw?.enabled, `${basePath}.igw.enabled`));
  diffs.push(...scalarDiff(oldVpc.nat?.enabled, newVpc.nat?.enabled, `${basePath}.nat.enabled`));
  diffs.push(...scalarDiff(oldVpc.nfw?.enabled, newVpc.nfw?.enabled, `${basePath}.nfw.enabled`));
  diffs.push(...scalarDiff(oldVpc.gwlb?.enabled, newVpc.gwlb?.enabled, `${basePath}.gwlb.enabled`));
  diffs.push(...arraySetDiff(oldVpc.accounts, newVpc.accounts, `${basePath}.accounts`));
  diffs.push(...arraySetDiff(oldVpc.peers, newVpc.peers, `${basePath}.peers`));
  diffs.push(...arraySetDiff(oldVpc.endpoints, newVpc.endpoints, `${basePath}.endpoints`));
  diffs.push(...arraySetDiff(oldVpc.gw_endpoints, newVpc.gw_endpoints, `${basePath}.gw_endpoints`));
  // Subnets: deep compare as JSON (too complex for field-level)
  if (JSON.stringify(oldVpc.subnets) !== JSON.stringify(newVpc.subnets)) {
    diffs.push({ path: `${basePath}.subnets`, type: 'changed', displayOld: 'changed', displayNew: 'changed' });
  }
  return diffs;
}

// ========== TGW Diff ==========

function diffTgw(oldTgw: TgwConfig | undefined, newTgw: TgwConfig | undefined, basePath: string): FieldDiff[] {
  if (!oldTgw && !newTgw) return [];
  if (!oldTgw) return [{ path: basePath, type: 'added', displayNew: `ASN: ${newTgw!.asn}, CIDR: ${newTgw!.cidr}` }];
  if (!newTgw) return [{ path: basePath, type: 'removed', displayOld: `ASN: ${oldTgw.asn}` }];
  const diffs: FieldDiff[] = [];
  diffs.push(...scalarDiff(oldTgw.enabled, newTgw.enabled, `${basePath}.enabled`));
  diffs.push(...scalarDiff(oldTgw.asn, newTgw.asn, `${basePath}.asn`));
  diffs.push(...scalarDiff(oldTgw.cidr, newTgw.cidr, `${basePath}.cidr`));
  diffs.push(...scalarDiff(oldTgw.peer, newTgw.peer, `${basePath}.peer`));
  return diffs;
}

// ========== Main Diff ==========

interface RegionPair {
  id: string;
  isMain: boolean;
  prefix: string;
  oldVpcs: Record<string, VpcConfig>;
  newVpcs: Record<string, VpcConfig>;
  oldTgw?: TgwConfig;
  newTgw?: TgwConfig;
}

function getRegionPairs(oldCfg: NetworkConfig, newCfg: NetworkConfig): RegionPair[] {
  const pairs: RegionPair[] = [];
  // Main region
  pairs.push({
    id: 'main', isMain: true, prefix: '',
    oldVpcs: oldCfg.vpcs || {}, newVpcs: newCfg.vpcs || {},
    oldTgw: oldCfg.tgw, newTgw: newCfg.tgw,
  });
  // Peer regions
  const allKeys = new Set([...Object.keys(oldCfg), ...Object.keys(newCfg)]);
  for (const key of allKeys) {
    if (ROOT_LEVEL_KEYS.includes(key)) continue;
    const ov = oldCfg[key] as RegionConfig | undefined;
    const nv = newCfg[key] as RegionConfig | undefined;
    if ((ov && typeof ov === 'object' && 'vpcs' in ov) || (nv && typeof nv === 'object' && 'vpcs' in nv)) {
      pairs.push({
        id: key, isMain: false, prefix: `${key}.`,
        oldVpcs: (ov as RegionConfig)?.vpcs || {},
        newVpcs: (nv as RegionConfig)?.vpcs || {},
        oldTgw: (ov as RegionConfig)?.tgw,
        newTgw: (nv as RegionConfig)?.tgw,
      });
    }
  }
  return pairs;
}

export function diffConfigs(oldCfg: NetworkConfig, newCfg: NetworkConfig): DiffSummary {
  const resources: ResourceDiff[] = [];
  const regionPairs = getRegionPairs(oldCfg, newCfg);

  for (const rp of regionPairs) {
    // Check region-level add/remove (peer regions only)
    if (!rp.isMain) {
      const oldExists = Object.keys(rp.oldVpcs).length > 0 || rp.oldTgw;
      const newExists = Object.keys(rp.newVpcs).length > 0 || rp.newTgw;
      if (!oldExists && newExists) {
        resources.push({
          kind: 'Region', name: rp.id, regionId: rp.id, changeType: 'added',
          fields: [{ path: rp.id, type: 'added', displayNew: 'new region' }],
          nodeId: `region-${rp.id}`, jsonPath: rp.id,
        });
      } else if (oldExists && !newExists) {
        resources.push({
          kind: 'Region', name: rp.id, regionId: rp.id, changeType: 'removed',
          fields: [{ path: rp.id, type: 'removed', displayOld: 'removed' }],
          nodeId: `region-${rp.id}`, jsonPath: rp.id,
        });
        continue;
      }
    }

    // VPC diffs
    const allVpcNames = new Set([...Object.keys(rp.oldVpcs), ...Object.keys(rp.newVpcs)]);
    for (const vpcName of allVpcNames) {
      const oldV = rp.oldVpcs[vpcName];
      const newV = rp.newVpcs[vpcName];
      const jp = `${rp.prefix}vpcs.${vpcName}`;
      const nodeId = `${rp.id}-${vpcName}`;

      if (!oldV && newV) {
        resources.push({
          kind: 'VPC', name: vpcName, regionId: rp.id, changeType: 'added',
          fields: diffVpc(undefined, newV, jp), nodeId, jsonPath: jp,
        });
      } else if (oldV && !newV) {
        resources.push({
          kind: 'VPC', name: vpcName, regionId: rp.id, changeType: 'removed',
          fields: diffVpc(oldV, undefined, jp), nodeId, jsonPath: jp,
        });
      } else if (oldV && newV) {
        const fields = diffVpc(oldV, newV, jp);
        if (fields.length > 0) {
          resources.push({
            kind: 'VPC', name: vpcName, regionId: rp.id, changeType: 'modified',
            fields, nodeId, jsonPath: jp,
          });
        }
      }
    }

    // TGW diff
    const tgwPath = `${rp.prefix}tgw`;
    const tgwNodeId = `${rp.id}-tgw`;
    if (!rp.oldTgw && rp.newTgw) {
      resources.push({
        kind: 'TGW', name: `TGW (${rp.id})`, regionId: rp.id, changeType: 'added',
        fields: diffTgw(undefined, rp.newTgw, tgwPath), nodeId: tgwNodeId, jsonPath: tgwPath,
      });
    } else if (rp.oldTgw && !rp.newTgw) {
      resources.push({
        kind: 'TGW', name: `TGW (${rp.id})`, regionId: rp.id, changeType: 'removed',
        fields: diffTgw(rp.oldTgw, undefined, tgwPath), nodeId: tgwNodeId, jsonPath: tgwPath,
      });
    } else if (rp.oldTgw && rp.newTgw) {
      // TGW scalar fields
      const tgwFields = diffTgw(rp.oldTgw, rp.newTgw, tgwPath);
      if (tgwFields.length > 0) {
        resources.push({
          kind: 'TGW', name: `TGW (${rp.id})`, regionId: rp.id, changeType: 'modified',
          fields: tgwFields, nodeId: tgwNodeId, jsonPath: tgwPath,
        });
      }

      // Route table diffs (separate ResourceDiff per table)
      const allTableNames = new Set([
        ...Object.keys(rp.oldTgw.tables || {}),
        ...Object.keys(rp.newTgw.tables || {}),
      ]);
      for (const tableName of allTableNames) {
        const oldT = rp.oldTgw.tables?.[tableName];
        const newT = rp.newTgw.tables?.[tableName];
        const tp = `${tgwPath}.tables.${tableName}`;

        if (!oldT && newT) {
          resources.push({
            kind: 'Route Table', name: `${tableName} (${rp.id})`, regionId: rp.id, changeType: 'added',
            fields: diffRouteTable(undefined, newT, tp), nodeId: tgwNodeId, jsonPath: tp,
          });
        } else if (oldT && !newT) {
          resources.push({
            kind: 'Route Table', name: `${tableName} (${rp.id})`, regionId: rp.id, changeType: 'removed',
            fields: diffRouteTable(oldT, undefined, tp), nodeId: tgwNodeId, jsonPath: tp,
          });
        } else if (oldT && newT) {
          const fields = diffRouteTable(oldT, newT, tp);
          if (fields.length > 0) {
            resources.push({
              kind: 'Route Table', name: `${tableName} (${rp.id})`, regionId: rp.id, changeType: 'modified',
              fields, nodeId: tgwNodeId, jsonPath: tp,
            });
          }
        }
      }
    }
  }

  // DX / Resolver (simple)
  if (JSON.stringify(oldCfg.dx) !== JSON.stringify(newCfg.dx)) {
    const ct = !oldCfg.dx && newCfg.dx ? 'added' : oldCfg.dx && !newCfg.dx ? 'removed' : 'modified';
    resources.push({
      kind: 'DX', name: 'Direct Connect', regionId: 'main', changeType: ct as ResourceDiff['changeType'],
      fields: scalarDiff(oldCfg.dx?.asn, newCfg.dx?.asn, 'dx.asn')
        .concat(scalarDiff(oldCfg.dx?.enabled, newCfg.dx?.enabled, 'dx.enabled')),
      nodeId: 'main-dx', jsonPath: 'dx',
    });
  }
  if (JSON.stringify(oldCfg.resolver) !== JSON.stringify(newCfg.resolver)) {
    const ct = !oldCfg.resolver && newCfg.resolver ? 'added' : oldCfg.resolver && !newCfg.resolver ? 'removed' : 'modified';
    resources.push({
      kind: 'Resolver', name: 'Route 53 Resolver', regionId: 'main', changeType: ct as ResourceDiff['changeType'],
      fields: [{ path: 'resolver', type: ct as FieldDiff['type'], displayOld: ct === 'removed' ? 'removed' : undefined, displayNew: ct === 'added' ? 'added' : undefined }],
      nodeId: 'main-resolver', jsonPath: 'resolver',
    });
  }

  // Edge changes (simplified: detect TGW peering edge changes)
  const edgeChanges: DiffSummary['edgeChanges'] = [];
  for (const rp of regionPairs) {
    if (rp.isMain) continue;
    const oldPeer = rp.oldTgw?.peer;
    const newPeer = rp.newTgw?.peer;
    const edgeId = `tgw-peer-${rp.id}`;
    if (!oldPeer && newPeer) edgeChanges.push({ id: edgeId, type: 'added' });
    if (oldPeer && !newPeer) edgeChanges.push({ id: edgeId, type: 'removed' });
  }

  const added = resources.filter(r => r.changeType === 'added').length;
  const removed = resources.filter(r => r.changeType === 'removed').length;
  const modified = resources.filter(r => r.changeType === 'modified').length;

  return { added, removed, modified, resources, edgeChanges };
}
