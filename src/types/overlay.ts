// Non-JSON overlay resources — rendered on canvas but not saved to config JSON

export type OverlayResourceType = 'vpn' | 'cgw' | 'vgw' | 'privatelink' | 'cloudwan';

export interface VpnConfig {
  name: string;
  tunnels: 1 | 2;
  routingType: 'static' | 'bgp';
  localAsn?: number;
  remoteAsn?: number;
  customerGatewayIp: string;
  insideCidrs?: string[];
  staticRoutes?: string[];
}

export interface CgwConfig {
  name: string;
  bgpAsn: number;
  ipAddress: string;
  type: 'ipsec.1';
}

export interface VgwConfig {
  name: string;
  asn?: number;
  vpcId: string;   // which VPC it attaches to
}

export interface PrivateLinkConfig {
  name: string;
  serviceName: string;
  sourceVpc: string;
  targetVpc: string;
}

export interface CloudWanConfig {
  name: string;
  segments: string[];
}

export interface OverlayResource {
  id: string;
  type: OverlayResourceType;
  attachedTo: string;     // e.g. "main-tgw" or "vpc-hub"
  regionId: string;
  config: VpnConfig | CgwConfig | VgwConfig | PrivateLinkConfig | CloudWanConfig;
}

export interface RouteSimulation {
  from: string;
  to: string;
  via: string[];
  label: string;
  cidr?: string;
}
