// AWS Console operation guide templates
// Each template generates step-by-step instructions based on user's overlay resource config

import type { Lang } from '../i18n/LanguageContext';
import { tl } from '../i18n/LanguageContext';

export interface GuideField {
  name: string;
  value: string;
  description: string;
  required: boolean;
}

export interface GuideStep {
  order: number;
  title: string;
  consolePath: string;
  fields: GuideField[];
  notes?: string[];
  awsCliEquivalent?: string;
}

export interface OperationGuide {
  resourceType: string;
  title: string;
  prerequisites: string[];
  contextValues: Record<string, string>;
  steps: GuideStep[];
}

// ============================================
// Site-to-Site VPN Guide
// ============================================

export function generateVpnGuide(params: {
  vpnName: string;
  tgwAsn?: number;
  cgwIp: string;
  cgwAsn?: number;
  routingType: 'static' | 'bgp';
  tunnels: number;
  insideCidrs?: string[];
  staticRoutes?: string[];
}, lang: Lang = 'zh'): OperationGuide {
  const { vpnName, tgwAsn, cgwIp, cgwAsn, routingType, tunnels, insideCidrs, staticRoutes } = params;
  const T = (zh: string, en: string) => tl(lang, zh, en);
  const steps: GuideStep[] = [];

  // Step 1: Create Customer Gateway
  steps.push({
    order: 1,
    title: T('创建 Customer Gateway', 'Create Customer Gateway'),
    consolePath: 'VPC > Customer gateways > Create customer gateway',
    fields: [
      { name: 'Name tag', value: `cgw-${vpnName}`, description: T('客户网关名称标签', 'Customer gateway name tag'), required: true },
      { name: 'BGP ASN', value: String(cgwAsn || 65001), description: T('远端 BGP ASN 号', 'Remote BGP ASN'), required: true },
      { name: 'IP address', value: cgwIp, description: T('客户侧公网 IP 地址', 'Customer public IP address'), required: true },
      { name: 'Certificate ARN', value: T('(留空)', '(Leave blank)'), description: T('如使用证书认证则填写', 'Fill in if using certificate auth'), required: false },
      { name: 'Device', value: T('(可选)', '(Optional)'), description: T('设备型号信息', 'Device model info'), required: false },
    ],
    notes: [
      T('确保 IP 地址是静态公网 IP', 'Ensure IP address is a static public IP'),
      T('如使用 BGP，ASN 需与对端设备配置一致', 'For BGP, ASN must match the remote device config'),
    ],
    awsCliEquivalent: `aws ec2 create-customer-gateway --type ipsec.1 --bgp-asn ${cgwAsn || 65001} --public-ip ${cgwIp} --tag-specifications 'ResourceType=customer-gateway,Tags=[{Key=Name,Value=cgw-${vpnName}}]'`,
  });

  // Step 2: Create VPN Connection
  steps.push({
    order: 2,
    title: T('创建 Site-to-Site VPN 连接', 'Create Site-to-Site VPN Connection'),
    consolePath: 'VPC > Site-to-Site VPN connections > Create VPN connection',
    fields: [
      { name: 'Name tag', value: `vpn-${vpnName}`, description: T('VPN 连接名称', 'VPN connection name'), required: true },
      { name: 'Target gateway type', value: 'Transit Gateway', description: T('选择 Transit Gateway 类型', 'Select Transit Gateway type'), required: true },
      { name: 'Transit Gateway', value: `tgw-xxx (ASN: ${tgwAsn || 64512})`, description: T('选择目标 TGW', 'Select target TGW'), required: true },
      { name: 'Customer Gateway', value: `cgw-${vpnName}`, description: T('选择上一步创建的 CGW', 'Select CGW created in previous step'), required: true },
      { name: 'Routing options', value: routingType === 'bgp' ? 'Dynamic (requires BGP)' : 'Static', description: T('路由方式', 'Routing type'), required: true },
    ],
    notes: [
      T('创建后 AWS 会自动生成两条 IPSec 隧道', 'AWS automatically creates two IPSec tunnels after creation'),
      T('下载 VPN 配置文件以获取预共享密钥和隧道参数', 'Download VPN config file for pre-shared keys and tunnel parameters'),
    ],
    awsCliEquivalent: `aws ec2 create-vpn-connection --type ipsec.1 --customer-gateway-id cgw-xxx --transit-gateway-id tgw-xxx ${routingType === 'static' ? '--options StaticRoutesOnly=true' : ''}`,
  });

  // Step 2.5: Tunnel options
  if (insideCidrs && insideCidrs.length > 0) {
    steps.push({
      order: 3,
      title: T('配置隧道选项 (Tunnel Options)', 'Configure Tunnel Options'),
      consolePath: T('在创建 VPN 时展开 "Tunnel options" 部分', 'Expand "Tunnel options" section when creating VPN'),
      fields: [
        { name: 'Tunnel 1 inside IPv4 CIDR', value: insideCidrs[0] || '169.254.10.0/30', description: T('隧道 1 内部地址', 'Tunnel 1 inside address'), required: false },
        ...(tunnels === 2 && insideCidrs[1] ? [{ name: 'Tunnel 2 inside IPv4 CIDR', value: insideCidrs[1], description: T('隧道 2 内部地址', 'Tunnel 2 inside address'), required: false }] : []),
        { name: 'Pre-shared key', value: T('(自动生成或自定义)', '(Auto-generated or custom)'), description: T('IKE 预共享密钥', 'IKE pre-shared key'), required: false },
      ],
      notes: [
        T('Inside CIDR 必须在 169.254.0.0/16 范围内且为 /30', 'Inside CIDR must be within 169.254.0.0/16 and /30'),
        T('避免使用 169.254.0.0/30, 169.254.1.0/30, 169.254.2.0/30 等保留地址', 'Avoid reserved addresses: 169.254.0.0/30, 169.254.1.0/30, 169.254.2.0/30'),
      ],
    });
  }

  // Step: Static routes (if applicable)
  if (routingType === 'static' && staticRoutes && staticRoutes.length > 0) {
    steps.push({
      order: steps.length + 1,
      title: T('添加静态路由', 'Add Static Routes'),
      consolePath: T('VPC > Site-to-Site VPN connections > 选择连接 > Static routes > Edit static routes', 'VPC > Site-to-Site VPN connections > Select connection > Static routes > Edit static routes'),
      fields: staticRoutes.map((route, i) => ({
        name: `Route ${i + 1}`,
        value: route,
        description: T(`静态路由 ${i + 1}`, `Static route ${i + 1}`),
        required: true,
      })),
      notes: [T('静态路由将通告给 TGW 路由表', 'Static routes will be advertised to TGW route tables')],
    });
  }

  // Step: TGW route table association
  steps.push({
    order: steps.length + 1,
    title: T('配置 TGW 路由表关联', 'Configure TGW Route Table Association'),
    consolePath: T('VPC > Transit gateway route tables > 选择路由表 > Associations', 'VPC > Transit gateway route tables > Select route table > Associations'),
    fields: [
      { name: 'Association', value: `vpn-${vpnName} (VPN attachment)`, description: T('将 VPN attachment 关联到路由表', 'Associate VPN attachment to route table'), required: true },
    ],
    notes: [
      T('VPN 连接创建后会自动创建 TGW attachment', 'TGW attachment is auto-created after VPN connection'),
      T('需要手动将 attachment 关联到正确的路由表', 'Manually associate attachment to correct route table'),
      T('如使用 BGP，需要同时配置 propagation 以传播路由', 'For BGP, also configure propagation to propagate routes'),
    ],
  });

  // Step: Download configuration
  steps.push({
    order: steps.length + 1,
    title: T('下载 VPN 配置文件', 'Download VPN Configuration'),
    consolePath: T('VPC > Site-to-Site VPN connections > 选择连接 > Download configuration', 'VPC > Site-to-Site VPN connections > Select connection > Download configuration'),
    fields: [
      { name: 'Vendor', value: T('选择设备厂商', 'Select device vendor'), description: T('如 Cisco, Juniper, Palo Alto 等', 'e.g. Cisco, Juniper, Palo Alto'), required: true },
      { name: 'Platform', value: T('选择设备型号', 'Select device model'), description: T('根据实际设备选择', 'Select based on actual device'), required: true },
      { name: 'Software', value: T('选择固件版本', 'Select firmware version'), description: T('根据实际版本选择', 'Select based on actual version'), required: true },
    ],
    notes: [T('配置文件包含预共享密钥、隧道 IP、BGP 参数等所有必要信息', 'Config file contains pre-shared keys, tunnel IPs, BGP parameters, and all necessary info')],
  });

  // Step: Configure on-premises device
  steps.push({
    order: steps.length + 1,
    title: T('配置客户端设备', 'Configure On-Premises Device'),
    consolePath: T('(在客户侧设备上操作)', '(Operate on customer-side device)'),
    fields: [
      { name: 'IKE Version', value: T('IKEv2 (推荐)', 'IKEv2 (recommended)'), description: T('使用 IKEv2 协议', 'Use IKEv2 protocol'), required: true },
      { name: 'Local ID', value: cgwIp, description: T('本地标识 (CGW IP)', 'Local identity (CGW IP)'), required: true },
      { name: 'Remote ID', value: T('(AWS 隧道外部 IP)', '(AWS tunnel outside IP)'), description: T('参考下载的配置文件', 'Refer to downloaded config file'), required: true },
      { name: 'Pre-shared Key', value: T('(参考配置文件)', '(Refer to config file)'), description: T('IKE 预共享密钥', 'IKE pre-shared key'), required: true },
      ...(routingType === 'bgp' ? [
        { name: 'BGP Local ASN', value: String(cgwAsn || 65001), description: T('本地 BGP ASN', 'Local BGP ASN'), required: true },
        { name: 'BGP Remote ASN', value: String(tgwAsn || 64512), description: T('AWS 侧 BGP ASN', 'AWS-side BGP ASN'), required: true },
        { name: 'BGP Neighbor IP', value: insideCidrs?.[0]?.replace('/30', '') || '169.254.x.x', description: T('AWS 隧道内部 IP', 'AWS tunnel inside IP'), required: true },
      ] : []),
    ],
    notes: [
      T('按下载的配置文件中的参数精确配置', 'Configure precisely per downloaded config file parameters'),
      T('确保 Phase 1 和 Phase 2 加密参数一致', 'Ensure Phase 1 and Phase 2 encryption parameters match'),
      tunnels === 2 ? T('两条隧道都需要配置，实现高可用', 'Both tunnels must be configured for high availability') : '',
    ].filter(Boolean),
  });

  // Step: Verify
  steps.push({
    order: steps.length + 1,
    title: T('验证 VPN 隧道状态', 'Verify VPN Tunnel Status'),
    consolePath: T('VPC > Site-to-Site VPN connections > 选择连接 > Tunnel details', 'VPC > Site-to-Site VPN connections > Select connection > Tunnel details'),
    fields: [
      { name: 'Tunnel 1 Status', value: T('UP (期望状态)', 'UP (expected)'), description: T('隧道 1 状态', 'Tunnel 1 status'), required: true },
      ...(tunnels === 2 ? [{ name: 'Tunnel 2 Status', value: T('UP (期望状态)', 'UP (expected)'), description: T('隧道 2 状态', 'Tunnel 2 status'), required: true }] : []),
    ],
    notes: [
      T('隧道建立可能需要几分钟', 'Tunnel establishment may take a few minutes'),
      T('如状态为 DOWN，检查: 1) 安全组/ACL 是否允许 UDP 500/4500  2) CGW IP 是否正确  3) 预共享密钥是否匹配', 'If status is DOWN, check: 1) SG/ACL allows UDP 500/4500  2) CGW IP is correct  3) Pre-shared key matches'),
      T('使用 ping 或 traceroute 测试端到端连通性', 'Use ping or traceroute to test end-to-end connectivity'),
    ],
    awsCliEquivalent: 'aws ec2 describe-vpn-connections --vpn-connection-ids vpn-xxx --query "VpnConnections[].VgwTelemetry"',
  });

  return {
    resourceType: 'Site-to-Site VPN',
    title: `Site-to-Site VPN: ${vpnName}`,
    prerequisites: [
      T('AWS 账号具有 VPC 和 VPN 相关 IAM 权限', 'AWS account has VPC and VPN IAM permissions'),
      `Transit Gateway ${T('已创建', 'created')} (ASN: ${tgwAsn || 64512})`,
      `${T('客户侧公网 IP', 'Customer public IP')}: ${cgwIp}`,
      routingType === 'bgp'
        ? `${T('客户侧支持 BGP', 'Customer supports BGP')} (ASN: ${cgwAsn || 65001})`
        : T('客户侧支持 IPSec VPN', 'Customer supports IPSec VPN'),
    ],
    contextValues: {
      [T('VPN 名称', 'VPN Name')]: vpnName,
      'TGW ASN': String(tgwAsn || 64512),
      [T('客户网关 IP', 'Customer GW IP')]: cgwIp,
      [T('远端 ASN', 'Remote ASN')]: String(cgwAsn || 65001),
      [T('路由方式', 'Routing')]: routingType === 'bgp' ? T('BGP (动态)', 'BGP (dynamic)') : T('Static (静态)', 'Static'),
      [T('隧道数量', 'Tunnels')]: String(tunnels),
    },
    steps,
  };
}

// ============================================
// Customer Gateway Guide (standalone)
// ============================================

export function generateCgwGuide(params: {
  name: string; bgpAsn: number; ipAddress: string;
}, lang: Lang = 'zh'): OperationGuide {
  const T = (zh: string, en: string) => tl(lang, zh, en);
  return {
    resourceType: 'Customer Gateway',
    title: `Customer Gateway: ${params.name}`,
    prerequisites: [
      T('AWS 账号具有 VPC 相关 IAM 权限', 'AWS account has VPC IAM permissions'),
      `${T('客户侧公网 IP', 'Customer public IP')}: ${params.ipAddress}`,
    ],
    contextValues: {
      [T('名称', 'Name')]: params.name,
      'BGP ASN': String(params.bgpAsn),
      [T('IP 地址', 'IP Address')]: params.ipAddress,
    },
    steps: [{
      order: 1,
      title: T('创建 Customer Gateway', 'Create Customer Gateway'),
      consolePath: 'VPC > Customer gateways > Create customer gateway',
      fields: [
        { name: 'Name tag', value: params.name, description: T('名称标签', 'Name tag'), required: true },
        { name: 'BGP ASN', value: String(params.bgpAsn), description: 'BGP ASN', required: true },
        { name: 'IP address', value: params.ipAddress, description: T('公网 IP', 'Public IP'), required: true },
      ],
      awsCliEquivalent: `aws ec2 create-customer-gateway --type ipsec.1 --bgp-asn ${params.bgpAsn} --public-ip ${params.ipAddress}`,
    }],
  };
}

// ============================================
// Virtual Private Gateway Guide
// ============================================

export function generateVgwGuide(params: {
  name: string; asn?: number; vpcName: string;
}, lang: Lang = 'zh'): OperationGuide {
  const T = (zh: string, en: string) => tl(lang, zh, en);
  return {
    resourceType: 'Virtual Private Gateway',
    title: `VGW: ${params.name}`,
    prerequisites: [
      T('AWS 账号具有 VPC 相关 IAM 权限', 'AWS account has VPC IAM permissions'),
      `${T('目标 VPC', 'Target VPC')}: ${params.vpcName}`,
    ],
    contextValues: {
      [T('名称', 'Name')]: params.name,
      'ASN': params.asn ? String(params.asn) : T('(AWS 分配)', '(AWS assigned)'),
      'VPC': params.vpcName,
    },
    steps: [
      {
        order: 1,
        title: T('创建 Virtual Private Gateway', 'Create Virtual Private Gateway'),
        consolePath: 'VPC > Virtual private gateways > Create virtual private gateway',
        fields: [
          { name: 'Name tag', value: params.name, description: T('名称标签', 'Name tag'), required: true },
          { name: 'ASN', value: params.asn ? String(params.asn) : 'Amazon default ASN (64512)', description: 'BGP ASN', required: false },
        ],
        awsCliEquivalent: `aws ec2 create-vpn-gateway --type ipsec.1 ${params.asn ? `--amazon-side-asn ${params.asn}` : ''}`,
      },
      {
        order: 2,
        title: T('附加到 VPC', 'Attach to VPC'),
        consolePath: T('VPC > Virtual private gateways > 选择 VGW > Actions > Attach to VPC', 'VPC > Virtual private gateways > Select VGW > Actions > Attach to VPC'),
        fields: [
          { name: 'VPC', value: params.vpcName, description: T('目标 VPC', 'Target VPC'), required: true },
        ],
        notes: [
          T('一个 VGW 只能附加到一个 VPC', 'A VGW can only be attached to one VPC'),
          T('附加后需要更新 VPC 路由表以启用路由传播', 'After attaching, update VPC route tables to enable route propagation'),
        ],
        awsCliEquivalent: `aws ec2 attach-vpn-gateway --vpn-gateway-id vgw-xxx --vpc-id vpc-xxx`,
      },
      {
        order: 3,
        title: T('启用路由传播', 'Enable Route Propagation'),
        consolePath: T('VPC > Route tables > 选择路由表 > Route propagation > Edit', 'VPC > Route tables > Select route table > Route propagation > Edit'),
        fields: [
          { name: 'Propagation', value: T(`启用 ${params.name} 的路由传播`, `Enable route propagation for ${params.name}`), description: T('允许 VGW 路由自动传播到路由表', 'Allow VGW routes to auto-propagate to route table'), required: true },
        ],
        notes: [T('需要对每个需要接收 VGW 路由的子网路由表启用传播', 'Enable propagation for each subnet route table that needs VGW routes')],
      },
    ],
  };
}
