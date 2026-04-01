export interface Subnet {
  size: number;
  index: number;
}

export interface NatConfig {
  enabled: boolean;
}

export interface IgwTableConfig {
  enabled?: boolean;
  subnets?: number[];
}

export interface IgwConfig {
  enabled: boolean;
  table?: IgwTableConfig;
}

export interface NfwConfig {
  enabled: boolean;
  in_public?: boolean;
  policy?: Record<string, unknown>;
  protects?: string[];
}

export interface GwlbTargetHealth {
  enabled?: boolean;
  path?: string;
  port?: number;
  protocol?: string;
}

export interface GwlbTargetGroup {
  type?: string;
  health?: GwlbTargetHealth;
}

export interface GwlbConfig {
  enabled: boolean;
  cross_zone?: boolean;
  groups?: Record<string, GwlbTargetGroup>;
  in_public?: boolean;
  same_ns_ew?: boolean;
  same_subnet?: boolean;
  two_arm?: boolean;
}

export interface FlowLogConfig {
  enabled?: boolean;
  attaches?: boolean;
  subnets?: boolean;
  format?: string;
  traffic?: string;
  types?: string[];
}

// Map 格式的子网定义: { "intra": { "cidrs": [[4,0],[4,1]], "tags": {} } }
export interface SubnetMapEntry {
  cidrs: number[][];
  tags?: Record<string, string>;
}

// subnets 可以是数组格式 (旧) 或 map 格式 (新)
export type SubnetsConfig = number[][][] | Record<string, SubnetMapEntry>;

export interface VpcConfig {
  enabled?: boolean;
  is_hub?: boolean;
  is_endpoint?: boolean;
  cidr: string;
  az_count?: number;
  nat?: NatConfig;
  igw?: IgwConfig;
  nfw?: NfwConfig;
  gwlb?: GwlbConfig;
  log?: FlowLogConfig;
  accounts?: string[];
  subnets: SubnetsConfig;
  subnet_names?: string[];
  peers?: string[];
  endpoints?: string[];
  gw_endpoints?: string[];
  dns?: { hostnames?: boolean; support?: boolean };
  map_public?: boolean;
  metrics?: boolean;
  group?: Record<string, unknown>;
  groups?: Record<string, unknown>;
  tags?: Record<string, string>;
}

export interface RouteTableConfig {
  associations?: string[];
  propagations?: string[];
  routes?: Record<string, string>;
}

export interface TgwConnectPeer {
  asn?: number;
  enabled?: boolean;
  address?: string;
}

export interface TgwConnectConfig {
  attachment?: string;
  address?: string;
  cidrs?: string[];
  peer?: TgwConnectPeer;
}

export interface TgwConfig {
  enabled: boolean;
  name?: string;
  asn?: number;
  cidr: string;
  cidrs?: string[];
  description?: string;
  peer?: boolean;
  tables?: Record<string, RouteTableConfig>;
  connects?: Record<string, TgwConnectConfig>;
  log?: FlowLogConfig;
}

export interface ResolverEndpointConfig {
  vpc?: string;
  groups?: string[];
}

export interface ResolverRuleConfig {
  domain?: string;
  ips?: string[];
  type?: string;
  vpcs?: string[];
}

export interface ResolverConfig {
  in?: ResolverEndpointConfig;
  out?: ResolverEndpointConfig;
  rules?: Record<string, ResolverRuleConfig>;
}

export interface DxConfig {
  asn?: number;
  enabled?: boolean;
  prefixes?: string[];
}

export interface RegionConfig {
  vpcs: Record<string, VpcConfig>;
  tgw?: TgwConfig;
  resolver?: ResolverConfig;
}

export interface NetworkConfig {
  vpcs?: Record<string, VpcConfig>;
  tgw?: TgwConfig;
  resolver?: ResolverConfig;
  dx?: DxConfig;
  [region: string]: RegionConfig | Record<string, VpcConfig> | TgwConfig | ResolverConfig | DxConfig | undefined;
}
