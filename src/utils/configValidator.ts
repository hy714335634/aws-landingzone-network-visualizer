import type { NetworkConfig, VpcConfig, TgwConfig, SubnetMapEntry, SubnetsConfig } from '../types/network';
import type { Lang } from '../i18n/LanguageContext';
import { tl } from '../i18n/LanguageContext';

export interface ValidationMessage {
  level: 'error' | 'warning' | 'info';
  path: string;       // e.g. "vpcs.security.nat"
  message: string;
}

const ROOT_LEVEL_KEYS = ['vpcs', 'tgw', 'resolver', 'dx', 'variables'];

function isSubnetsArray(subnets: SubnetsConfig): subnets is number[][][] {
  return Array.isArray(subnets);
}

type TFn = (zh: string, en: string) => string;

export function validateNetworkConfig(config: NetworkConfig, lang: Lang = 'zh'): ValidationMessage[] {
  const T: TFn = (zh, en) => tl(lang, zh, en);
  const messages: ValidationMessage[] = [];

  const regions: { id: string; path: string; vpcs?: Record<string, VpcConfig>; tgw?: TgwConfig }[] = [];

  if (config.vpcs) {
    regions.push({ id: 'main', path: '', vpcs: config.vpcs, tgw: config.tgw });
  }
  Object.entries(config).forEach(([key, value]) => {
    if (ROOT_LEVEL_KEYS.includes(key) || !value || typeof value !== 'object') return;
    if ('vpcs' in value) {
      const rc = value as { vpcs: Record<string, VpcConfig>; tgw?: TgwConfig };
      regions.push({ id: key, path: key, vpcs: rc.vpcs, tgw: rc.tgw });
    }
  });

  regions.forEach(region => {
    const prefix = region.path ? `${region.path}.` : '';

    if (region.vpcs) {
      Object.entries(region.vpcs).forEach(([vpcName, vpcConfig]) => {
        validateVpc(vpcName, vpcConfig, `${prefix}vpcs.${vpcName}`, messages, region.tgw, T);
      });
    }

    if (region.tgw) {
      validateTgw(region.tgw, `${prefix}tgw`, messages, region.vpcs || {}, region.id, T);
    }
  });

  if (config.resolver) {
    validateResolver(config.resolver, 'resolver', messages, config.vpcs || {}, T);
  }
  regions.forEach(region => {
    if (region.path) {
      const regionConfig = config[region.path] as { resolver?: unknown };
      if (regionConfig?.resolver) {
        validateResolver(regionConfig.resolver, `${region.path}.resolver`, messages, region.vpcs || {}, T);
      }
    }
  });

  if (config.dx?.enabled) {
    if (!config.tgw?.enabled) {
      messages.push({ level: 'warning', path: 'dx', message: T('Direct Connect 网关已启用，但主区域未启用 TGW', 'Direct Connect gateway enabled but TGW is not enabled in main region') });
    }
  }

  validateMultiRegion(regions, messages, T);

  return messages;
}

function validateVpc(
  name: string,
  vpc: VpcConfig,
  path: string,
  messages: ValidationMessage[],
  tgw: TgwConfig | undefined,
  T: TFn
): void {
  if (vpc.enabled === false) {
    if (!vpc.accounts?.length) {
      messages.push({ level: 'info', path, message: T(`VPC "${name}" 已禁用且未指定 accounts`, `VPC "${name}" is disabled and has no accounts`) });
    }
    return;
  }

  if (!vpc.cidr) {
    messages.push({ level: 'error', path: `${path}.cidr`, message: T(`VPC "${name}" 缺少 CIDR 定义`, `VPC "${name}" is missing CIDR`) });
    return;
  }

  if (!isValidCidr(vpc.cidr)) {
    messages.push({ level: 'error', path: `${path}.cidr`, message: T(`VPC "${name}" 的 CIDR "${vpc.cidr}" 格式无效`, `VPC "${name}" CIDR "${vpc.cidr}" is invalid`) });
  }

  if (!vpc.subnets) {
    messages.push({ level: 'warning', path: `${path}.subnets`, message: T(`VPC "${name}" 未定义子网`, `VPC "${name}" has no subnets defined`) });
  } else {
    validateSubnets(vpc.subnets, path, name, vpc.az_count, messages, T);
  }

  if (vpc.nat?.enabled) {
    if (!vpc.igw?.enabled) {
      messages.push({ level: 'error', path: `${path}.nat`, message: T(`VPC "${name}" 启用了 NAT 但未启用 IGW`, `VPC "${name}" has NAT enabled but no IGW`) });
    }
    if (!hasSubnetType(vpc.subnets, 'public')) {
      messages.push({ level: 'error', path: `${path}.nat`, message: T(`VPC "${name}" 启用了 NAT 但缺少 public 子网`, `VPC "${name}" has NAT enabled but no public subnet`) });
    }
  }

  if (vpc.igw?.enabled) {
    if (!hasSubnetType(vpc.subnets, 'public')) {
      messages.push({ level: 'warning', path: `${path}.igw`, message: T(`VPC "${name}" 启用了 IGW 但缺少 public 子网`, `VPC "${name}" has IGW enabled but no public subnet`) });
    }
  }

  if (vpc.nfw?.enabled) {
    if (!hasSubnetType(vpc.subnets, 'private')) {
      messages.push({ level: 'error', path: `${path}.nfw`, message: T(`VPC "${name}" 启用了 NFW 但缺少 private 子网`, `VPC "${name}" has NFW enabled but no private subnet`) });
    }
  }
  if (vpc.gwlb?.enabled) {
    if (!hasSubnetType(vpc.subnets, 'private')) {
      messages.push({ level: 'error', path: `${path}.gwlb`, message: T(`VPC "${name}" 启用了 GWLB 但缺少 private 子网`, `VPC "${name}" has GWLB enabled but no private subnet`) });
    }
    if (vpc.gwlb.same_subnet === false && !hasSubnetType(vpc.subnets, 'gwlb')) {
      messages.push({ level: 'warning', path: `${path}.gwlb`, message: T(`VPC "${name}" GWLB same_subnet=false 但缺少 gwlb 子网`, `VPC "${name}" GWLB same_subnet=false but no gwlb subnet`) });
    }
  }

  if (tgw?.enabled) {
    if (!hasSubnetType(vpc.subnets, 'intra')) {
      messages.push({ level: 'warning', path: `${path}.subnets`, message: T(`VPC "${name}" 缺少 intra 子网，无法连接 TGW`, `VPC "${name}" has no intra subnet for TGW attachment`) });
    }
  }

  if (vpc.accounts && vpc.accounts.length > 1) {
    messages.push({ level: 'warning', path: `${path}.accounts`, message: T(`VPC "${name}" 指定了多个账户，TGW 共享模式下可能导致 CIDR 重叠`, `VPC "${name}" has multiple accounts, may cause CIDR overlap in TGW sharing mode`) });
  }

  if ((vpc.is_hub || vpc.is_endpoint) && vpc.accounts?.length) {
    messages.push({ level: 'warning', path: `${path}.accounts`, message: T(`VPC "${name}" 是 ${vpc.is_hub ? 'Hub' : 'Endpoint'} VPC，不应设置 accounts`, `VPC "${name}" is a ${vpc.is_hub ? 'Hub' : 'Endpoint'} VPC and should not have accounts`) });
  }
}

function validateSubnets(
  subnets: SubnetsConfig,
  path: string,
  vpcName: string,
  azCount: number | undefined,
  messages: ValidationMessage[],
  T: TFn
): void {
  if (isSubnetsArray(subnets)) {
    subnets.forEach((cidrs, index) => {
      if (!cidrs || cidrs.length === 0) return;
      cidrs.forEach((def, azIdx) => {
        if (def && def.length !== 2) {
          messages.push({
            level: 'error',
            path: `${path}.subnets[${index}][${azIdx}]`,
            message: T(`VPC "${vpcName}" 子网定义格式错误，应为 [newbits, netnum]`, `VPC "${vpcName}" subnet definition invalid, expected [newbits, netnum]`),
          });
        }
      });
      if (azCount && cidrs.length !== azCount) {
        messages.push({
          level: 'warning',
          path: `${path}.subnets[${index}]`,
          message: T(`VPC "${vpcName}" 子网 AZ 数量 (${cidrs.length}) 与 az_count (${azCount}) 不一致`, `VPC "${vpcName}" subnet AZ count (${cidrs.length}) doesn't match az_count (${azCount})`),
        });
      }
    });
  } else {
    Object.entries(subnets).forEach(([subnetName, entry]) => {
      const se = entry as SubnetMapEntry;
      if (!se.cidrs || !Array.isArray(se.cidrs)) {
        messages.push({
          level: 'error',
          path: `${path}.subnets.${subnetName}`,
          message: T(`VPC "${vpcName}" 子网 "${subnetName}" 缺少 cidrs 数组`, `VPC "${vpcName}" subnet "${subnetName}" missing cidrs array`),
        });
        return;
      }
      se.cidrs.forEach((def, azIdx) => {
        if (def && def.length !== 2) {
          messages.push({
            level: 'error',
            path: `${path}.subnets.${subnetName}.cidrs[${azIdx}]`,
            message: T(`VPC "${vpcName}" 子网 "${subnetName}" CIDR 定义格式错误，应为 [newbits, netnum]`, `VPC "${vpcName}" subnet "${subnetName}" CIDR definition invalid, expected [newbits, netnum]`),
          });
        }
      });
      if (azCount && se.cidrs.length !== azCount) {
        messages.push({
          level: 'warning',
          path: `${path}.subnets.${subnetName}`,
          message: T(`VPC "${vpcName}" 子网 "${subnetName}" AZ 数量 (${se.cidrs.length}) 与 az_count (${azCount}) 不一致`, `VPC "${vpcName}" subnet "${subnetName}" AZ count (${se.cidrs.length}) doesn't match az_count (${azCount})`),
        });
      }
    });
  }
}

function validateTgw(
  tgw: TgwConfig,
  path: string,
  messages: ValidationMessage[],
  vpcs: Record<string, VpcConfig>,
  regionId: string,
  T: TFn
): void {
  if (!tgw.enabled) return;

  if (!tgw.cidr) {
    messages.push({ level: 'error', path: `${path}.cidr`, message: T(`区域 "${regionId}" TGW 缺少 CIDR 定义`, `Region "${regionId}" TGW is missing CIDR`) });
  }

  // Build set of known TGW attachment names (VPN, DX, connect, peer — not just VPCs)
  const knownAttachments = new Set<string>(Object.keys(vpcs).filter(k => vpcs[k]?.enabled !== false));
  knownAttachments.add('peer');
  if (tgw.connects) {
    Object.keys(tgw.connects).forEach(k => knownAttachments.add(k));
  }

  if (tgw.tables) {
    Object.entries(tgw.tables).forEach(([tableName, table]) => {
      table.associations?.forEach(assoc => {
        if (knownAttachments.has(assoc)) return;
        // Also allow vpn-*, dx-*, dxgw-* prefixed attachment names
        if (/^(vpn|dx|dxgw|connect)-/.test(assoc)) return;
        messages.push({
          level: 'warning',
          path: `${path}.tables.${tableName}.associations`,
          message: T(`路由表 "${tableName}" 关联的 "${assoc}" 在区域 "${regionId}" 中不存在或已禁用`, `Route table "${tableName}" association "${assoc}" not found or disabled in region "${regionId}"`),
        });
      });

      table.propagations?.forEach(prop => {
        if (knownAttachments.has(prop)) return;
        if (/^(vpn|dx|dxgw|connect)-/.test(prop)) return;
        messages.push({
          level: 'warning',
          path: `${path}.tables.${tableName}.propagations`,
          message: T(`路由表 "${tableName}" 传播的 "${prop}" 在区域 "${regionId}" 中不存在或已禁用`, `Route table "${tableName}" propagation "${prop}" not found or disabled in region "${regionId}"`),
        });
      });

      if (table.routes) {
        Object.entries(table.routes).forEach(([key, target]) => {
          if (target === 'blackhole' || target === 'peer') return;
          if (knownAttachments.has(target)) return;
          if (/^(vpn|dx|dxgw|connect)-/.test(target)) return;
          messages.push({
            level: 'warning',
            path: `${path}.tables.${tableName}.routes.${key}`,
            message: T(`路由表 "${tableName}" 路由目标 "${target}" 在区域 "${regionId}" 中不存在或已禁用`, `Route table "${tableName}" route target "${target}" not found or disabled in region "${regionId}"`),
          });
        });
      }
    });
  }

  if (regionId !== 'main' && !tgw.peer) {
    messages.push({ level: 'info', path: `${path}.peer`, message: T(`区域 "${regionId}" TGW 未设置 peer=true`, `Region "${regionId}" TGW does not have peer=true`) });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function validateResolver(resolver: any, path: string, messages: ValidationMessage[], vpcs: Record<string, VpcConfig>, T: TFn): void {
  if (resolver.in?.vpc && !(resolver.in.vpc in vpcs)) {
    messages.push({ level: 'warning', path: `${path}.in.vpc`, message: T(`Resolver 入站端点引用的 VPC "${resolver.in.vpc}" 不存在`, `Resolver inbound endpoint VPC "${resolver.in.vpc}" not found`) });
  }
  if (resolver.out?.vpc && !(resolver.out.vpc in vpcs)) {
    messages.push({ level: 'warning', path: `${path}.out.vpc`, message: T(`Resolver 出站端点引用的 VPC "${resolver.out.vpc}" 不存在`, `Resolver outbound endpoint VPC "${resolver.out.vpc}" not found`) });
  }
  if (resolver.rules) {
    Object.entries(resolver.rules).forEach(([ruleName, rule]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = rule as any;
      if (!r.domain) {
        messages.push({ level: 'warning', path: `${path}.rules.${ruleName}`, message: T(`Resolver 规则 "${ruleName}" 缺少 domain`, `Resolver rule "${ruleName}" missing domain`) });
      }
      r.vpcs?.forEach((vpcRef: string) => {
        if (!(vpcRef in vpcs)) {
          messages.push({ level: 'warning', path: `${path}.rules.${ruleName}.vpcs`, message: T(`Resolver 规则 "${ruleName}" 引用的 VPC "${vpcRef}" 不存在`, `Resolver rule "${ruleName}" referenced VPC "${vpcRef}" not found`) });
        }
      });
    });
  }
}

function validateMultiRegion(
  regions: { id: string; tgw?: TgwConfig }[],
  messages: ValidationMessage[],
  T: TFn
): void {
  if (regions.length <= 1) return;

  const asnMap = new Map<number, string[]>();
  regions.forEach(r => {
    if (r.tgw?.enabled && r.tgw.asn != null) {
      const list = asnMap.get(r.tgw.asn) || [];
      list.push(r.id);
      asnMap.set(r.tgw.asn, list);
    }
  });
  asnMap.forEach((regionIds, asn) => {
    if (regionIds.length > 1) {
      messages.push({
        level: 'error',
        path: 'tgw.asn',
        message: T(`TGW ASN ${asn} 在多个区域中重复使用: ${regionIds.join(', ')}`, `TGW ASN ${asn} is duplicated across regions: ${regionIds.join(', ')}`),
      });
    }
  });

  const cidrMap = new Map<string, string[]>();
  regions.forEach(r => {
    if (r.tgw?.enabled && r.tgw.cidr) {
      const list = cidrMap.get(r.tgw.cidr) || [];
      list.push(r.id);
      cidrMap.set(r.tgw.cidr, list);
    }
  });
  cidrMap.forEach((regionIds, cidr) => {
    if (regionIds.length > 1) {
      messages.push({
        level: 'error',
        path: 'tgw.cidr',
        message: T(`TGW CIDR ${cidr} 在多个区域中重复使用: ${regionIds.join(', ')}`, `TGW CIDR ${cidr} is duplicated across regions: ${regionIds.join(', ')}`),
      });
    }
  });

  const mainRegion = regions.find(r => r.id === 'main');
  if (mainRegion?.tgw?.peer) {
    messages.push({ level: 'error', path: 'tgw.peer', message: T('主区域 TGW 不应设置 peer=true', 'Main region TGW should not have peer=true') });
  }
}

function hasSubnetType(subnets: SubnetsConfig | undefined, typeName: string): boolean {
  if (!subnets) return false;
  if (isSubnetsArray(subnets)) {
    const typeMap: Record<string, number> = { 'intra': 0, 'public': 1, 'private': 2 };
    const idx = typeMap[typeName];
    if (idx === undefined) return false;
    return subnets[idx]?.length > 0;
  } else {
    return typeName in subnets && !!(subnets as Record<string, SubnetMapEntry>)[typeName]?.cidrs?.length;
  }
}

function isValidCidr(cidr: string): boolean {
  const match = cidr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
  if (!match) return false;
  const parts = [match[1], match[2], match[3], match[4]].map(Number);
  if (parts.some(p => p < 0 || p > 255)) return false;
  const mask = Number(match[5]);
  return mask >= 0 && mask <= 32;
}
