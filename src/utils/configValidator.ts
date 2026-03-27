import type { NetworkConfig, VpcConfig, TgwConfig, SubnetMapEntry, SubnetsConfig } from '../types/network';

export interface ValidationMessage {
  level: 'error' | 'warning' | 'info';
  path: string;       // e.g. "vpcs.security.nat"
  message: string;
}

const ROOT_LEVEL_KEYS = ['vpcs', 'tgw', 'resolver', 'dx', 'variables'];

function isSubnetsArray(subnets: SubnetsConfig): subnets is number[][][] {
  return Array.isArray(subnets);
}

/**
 * 校验整个网络配置，返回所有问题
 */
export function validateNetworkConfig(config: NetworkConfig): ValidationMessage[] {
  const messages: ValidationMessage[] = [];

  // 收集所有区域
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

  // 校验每个区域
  regions.forEach(region => {
    const prefix = region.path ? `${region.path}.` : '';

    // 校验 VPCs
    if (region.vpcs) {
      Object.entries(region.vpcs).forEach(([vpcName, vpcConfig]) => {
        validateVpc(vpcName, vpcConfig, `${prefix}vpcs.${vpcName}`, messages, region.tgw);
      });
    }

    // 校验 TGW
    if (region.tgw) {
      validateTgw(region.tgw, `${prefix}tgw`, messages, region.vpcs || {}, region.id);
    }
  });

  // 校验 Resolver
  if (config.resolver) {
    validateResolver(config.resolver, 'resolver', messages, config.vpcs || {});
  }
  regions.forEach(region => {
    if (region.path) {
      const regionConfig = config[region.path] as { resolver?: unknown };
      if (regionConfig?.resolver) {
        validateResolver(regionConfig.resolver, `${region.path}.resolver`, messages, region.vpcs || {});
      }
    }
  });

  // 校验 DX
  if (config.dx?.enabled) {
    if (!config.tgw?.enabled) {
      messages.push({ level: 'warning', path: 'dx', message: 'Direct Connect 网关已启用，但主区域未启用 TGW' });
    }
  }

  // 多区域约束校验
  validateMultiRegion(regions, messages);

  return messages;
}

function validateVpc(
  name: string,
  vpc: VpcConfig,
  path: string,
  messages: ValidationMessage[],
  tgw?: TgwConfig
): void {
  // enabled: false 的 VPC 只需要 accounts
  if (vpc.enabled === false) {
    if (!vpc.accounts?.length) {
      messages.push({ level: 'info', path, message: `VPC "${name}" 已禁用且未指定 accounts` });
    }
    return;
  }

  // CIDR 必须存在
  if (!vpc.cidr) {
    messages.push({ level: 'error', path: `${path}.cidr`, message: `VPC "${name}" 缺少 CIDR 定义` });
    return;
  }

  // CIDR 格式校验
  if (!isValidCidr(vpc.cidr)) {
    messages.push({ level: 'error', path: `${path}.cidr`, message: `VPC "${name}" 的 CIDR "${vpc.cidr}" 格式无效` });
  }

  // subnets 校验
  if (!vpc.subnets) {
    messages.push({ level: 'warning', path: `${path}.subnets`, message: `VPC "${name}" 未定义子网` });
  } else {
    validateSubnets(vpc.subnets, path, name, vpc.az_count, messages);
  }

  // NAT 需要 IGW + public 子网
  if (vpc.nat?.enabled) {
    if (!vpc.igw?.enabled) {
      messages.push({ level: 'error', path: `${path}.nat`, message: `VPC "${name}" 启用了 NAT 但未启用 IGW` });
    }
    if (!hasSubnetType(vpc.subnets, 'public')) {
      messages.push({ level: 'error', path: `${path}.nat`, message: `VPC "${name}" 启用了 NAT 但缺少 public 子网` });
    }
  }

  // IGW 需要 public 子网
  if (vpc.igw?.enabled) {
    if (!hasSubnetType(vpc.subnets, 'public')) {
      messages.push({ level: 'warning', path: `${path}.igw`, message: `VPC "${name}" 启用了 IGW 但缺少 public 子网` });
    }
  }

  // NFW/GWLB 需要 private 子网
  if (vpc.nfw?.enabled) {
    if (!hasSubnetType(vpc.subnets, 'private')) {
      messages.push({ level: 'error', path: `${path}.nfw`, message: `VPC "${name}" 启用了 NFW 但缺少 private 子网` });
    }
  }
  if (vpc.gwlb?.enabled) {
    if (!hasSubnetType(vpc.subnets, 'private')) {
      messages.push({ level: 'error', path: `${path}.gwlb`, message: `VPC "${name}" 启用了 GWLB 但缺少 private 子网` });
    }
    // same_subnet=false 时需要 gwlb 子网或至少两个私有子网
    if (vpc.gwlb.same_subnet === false && !hasSubnetType(vpc.subnets, 'gwlb')) {
      messages.push({ level: 'warning', path: `${path}.gwlb`, message: `VPC "${name}" GWLB same_subnet=false 但缺少 gwlb 子网` });
    }
  }

  // TGW 连接需要 intra 子网
  if (tgw?.enabled) {
    if (!hasSubnetType(vpc.subnets, 'intra')) {
      messages.push({ level: 'warning', path: `${path}.subnets`, message: `VPC "${name}" 缺少 intra 子网，无法连接 TGW` });
    }
  }

  // accounts 校验（TGW 共享模式下每个 VPC 最多一个账户）
  if (vpc.accounts && vpc.accounts.length > 1) {
    messages.push({ level: 'warning', path: `${path}.accounts`, message: `VPC "${name}" 指定了多个账户，TGW 共享模式下可能导致 CIDR 重叠` });
  }

  // Hub/Endpoint VPC 不应设置 accounts
  if ((vpc.is_hub || vpc.is_endpoint) && vpc.accounts?.length) {
    messages.push({ level: 'warning', path: `${path}.accounts`, message: `VPC "${name}" 是 ${vpc.is_hub ? 'Hub' : 'Endpoint'} VPC，不应设置 accounts` });
  }

  // peers 引用校验（延迟到外部做，因为需要全局 VPC 列表）
}

function validateSubnets(
  subnets: SubnetsConfig,
  path: string,
  vpcName: string,
  azCount: number | undefined,
  messages: ValidationMessage[]
): void {
  if (isSubnetsArray(subnets)) {
    // 数组格式校验
    subnets.forEach((cidrs, index) => {
      if (!cidrs || cidrs.length === 0) return;
      cidrs.forEach((def, azIdx) => {
        if (def && def.length !== 2) {
          messages.push({
            level: 'error',
            path: `${path}.subnets[${index}][${azIdx}]`,
            message: `VPC "${vpcName}" 子网定义格式错误，应为 [newbits, netnum]`,
          });
        }
      });
      if (azCount && cidrs.length !== azCount) {
        messages.push({
          level: 'warning',
          path: `${path}.subnets[${index}]`,
          message: `VPC "${vpcName}" 子网 AZ 数量 (${cidrs.length}) 与 az_count (${azCount}) 不一致`,
        });
      }
    });
  } else {
    // Map 格式校验
    Object.entries(subnets).forEach(([subnetName, entry]) => {
      const se = entry as SubnetMapEntry;
      if (!se.cidrs || !Array.isArray(se.cidrs)) {
        messages.push({
          level: 'error',
          path: `${path}.subnets.${subnetName}`,
          message: `VPC "${vpcName}" 子网 "${subnetName}" 缺少 cidrs 数组`,
        });
        return;
      }
      se.cidrs.forEach((def, azIdx) => {
        if (def && def.length !== 2) {
          messages.push({
            level: 'error',
            path: `${path}.subnets.${subnetName}.cidrs[${azIdx}]`,
            message: `VPC "${vpcName}" 子网 "${subnetName}" CIDR 定义格式错误，应为 [newbits, netnum]`,
          });
        }
      });
      if (azCount && se.cidrs.length !== azCount) {
        messages.push({
          level: 'warning',
          path: `${path}.subnets.${subnetName}`,
          message: `VPC "${vpcName}" 子网 "${subnetName}" AZ 数量 (${se.cidrs.length}) 与 az_count (${azCount}) 不一致`,
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
  regionId: string
): void {
  if (!tgw.enabled) return;

  if (!tgw.cidr) {
    messages.push({ level: 'error', path: `${path}.cidr`, message: `区域 "${regionId}" TGW 缺少 CIDR 定义` });
  }

  // 路由表校验
  if (tgw.tables) {
    Object.entries(tgw.tables).forEach(([tableName, table]) => {
      // associations 引用的 VPC 必须存在
      table.associations?.forEach(assoc => {
        if (assoc === 'peer') return;
        if (!(assoc in vpcs) || vpcs[assoc]?.enabled === false) {
          messages.push({
            level: 'warning',
            path: `${path}.tables.${tableName}.associations`,
            message: `路由表 "${tableName}" 关联的 VPC "${assoc}" 在区域 "${regionId}" 中不存在或已禁用`,
          });
        }
      });

      // propagations 引用的 VPC 必须存在
      table.propagations?.forEach(prop => {
        if (!(prop in vpcs) || vpcs[prop]?.enabled === false) {
          messages.push({
            level: 'warning',
            path: `${path}.tables.${tableName}.propagations`,
            message: `路由表 "${tableName}" 传播的 VPC "${prop}" 在区域 "${regionId}" 中不存在或已禁用`,
          });
        }
      });

      // routes 目标 VPC 校验
      if (table.routes) {
        Object.entries(table.routes).forEach(([key, target]) => {
          if (target === 'blackhole' || target === 'peer') return;
          if (!(target in vpcs) || vpcs[target]?.enabled === false) {
            messages.push({
              level: 'warning',
              path: `${path}.tables.${tableName}.routes.${key}`,
              message: `路由表 "${tableName}" 路由目标 VPC "${target}" 在区域 "${regionId}" 中不存在或已禁用`,
            });
          }
        });
      }
    });
  }

  // 对等区域必须设置 peer=true
  if (regionId !== 'main' && !tgw.peer) {
    messages.push({ level: 'info', path: `${path}.peer`, message: `区域 "${regionId}" TGW 未设置 peer=true` });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function validateResolver(resolver: any, path: string, messages: ValidationMessage[], vpcs: Record<string, VpcConfig>): void {
  if (resolver.in?.vpc && !(resolver.in.vpc in vpcs)) {
    messages.push({ level: 'warning', path: `${path}.in.vpc`, message: `Resolver 入站端点引用的 VPC "${resolver.in.vpc}" 不存在` });
  }
  if (resolver.out?.vpc && !(resolver.out.vpc in vpcs)) {
    messages.push({ level: 'warning', path: `${path}.out.vpc`, message: `Resolver 出站端点引用的 VPC "${resolver.out.vpc}" 不存在` });
  }
  if (resolver.rules) {
    Object.entries(resolver.rules).forEach(([ruleName, rule]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = rule as any;
      if (!r.domain) {
        messages.push({ level: 'warning', path: `${path}.rules.${ruleName}`, message: `Resolver 规则 "${ruleName}" 缺少 domain` });
      }
      r.vpcs?.forEach((vpcRef: string) => {
        if (!(vpcRef in vpcs)) {
          messages.push({ level: 'warning', path: `${path}.rules.${ruleName}.vpcs`, message: `Resolver 规则 "${ruleName}" 引用的 VPC "${vpcRef}" 不存在` });
        }
      });
    });
  }
}

function validateMultiRegion(
  regions: { id: string; tgw?: TgwConfig }[],
  messages: ValidationMessage[]
): void {
  if (regions.length <= 1) return;

  // TGW ASN 唯一性
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
        message: `TGW ASN ${asn} 在多个区域中重复使用: ${regionIds.join(', ')}`,
      });
    }
  });

  // TGW CIDR 唯一性
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
        message: `TGW CIDR ${cidr} 在多个区域中重复使用: ${regionIds.join(', ')}`,
      });
    }
  });

  // 主区域不应设置 peer
  const mainRegion = regions.find(r => r.id === 'main');
  if (mainRegion?.tgw?.peer) {
    messages.push({ level: 'error', path: 'tgw.peer', message: '主区域 TGW 不应设置 peer=true' });
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
