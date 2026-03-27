# Landing Zone 网络配置 JSON 结构规范

## 一、顶层结构

```jsonc
{
  // ===== 主区域资源（必须） =====
  "vpcs": { ... },          // 主区域 VPC 定义（必须）
  "tgw": { ... },           // 主区域 Transit Gateway（可选）
  "resolver": { ... },      // 主区域 Route 53 Resolver（可选）
  "dx": { ... },            // Direct Connect 网关（可选，仅主区域）
  "variables": { ... },     // 变量定义（可选，不参与可视化）

  // ===== 对等区域（可选，0~N 个） =====
  // key 必须是 AWS 区域代码格式，如 us-west-1, ap-east-1
  "us-west-1": {
    "vpcs": { ... },        // 该区域 VPC 定义
    "tgw": { ... },         // 该区域 TGW（通常 peer: true）
    "resolver": { ... }     // 该区域 Resolver（可选）
  },
  "ap-east-1": { ... },
  "eu-central-1": { ... }
}
```

**规则：**
- 顶层 key 分两类：保留属性名（`vpcs`, `tgw`, `resolver`, `dx`, `variables`）和区域代码
- 区域代码格式：`xx-xxxx-N`（如 `us-east-1`, `cn-northwest-1`）
- 主区域没有显式名称，通过排除法推断（不在对等区域列表中的区域）
- 每个区域内部结构相同：`vpcs` + `tgw` + `resolver`

---

## 二、VPC 定义

```jsonc
"vpcs": {
  "vpc-name": {
    // ===== 基础属性 =====
    "enabled": true,           // bool, 默认 true。false 时仅声明 accounts/IAM 角色
    "cidr": "10.0.0.0/16",    // string, 必须。VPC CIDR 块
    "az_count": 2,             // int, 默认 2。可用区数量（2 或 3）
    "is_hub": false,           // bool, 默认 false。指定为中心 VPC（每区域最多一个）
    "is_endpoint": false,      // bool, 默认 false。指定为端点 VPC

    // ===== DNS 配置 =====
    "dns": {
      "hostnames": true,       // bool, 默认 true
      "support": true          // bool, 默认 true
    },
    "map_public": false,       // bool, 默认 false。公有子网自动分配公网 IP
    "metrics": false,          // bool, 默认 false。网络地址使用指标

    // ===== 子网定义（两种格式） =====
    "subnets": { ... },        // 见第三节

    // ===== 网络组件 =====
    "nat": { ... },            // NAT 网关，见 2.1
    "igw": { ... },            // 互联网网关，见 2.2
    "nfw": { ... },            // AWS 网络防火墙，见 2.3
    "gwlb": { ... },           // 网关负载均衡器，见 2.4
    "log": { ... },            // VPC 流日志，见 2.5

    // ===== 安全组 =====
    "group": { ... },          // 默认安全组配置
    "groups": { ... },         // 自定义安全组定义

    // ===== 共享与连接 =====
    "accounts": ["123456789012"],  // string[], 资源共享账户 ID
    "peers": ["other-vpc"],        // string[], 对等连接的接受方 VPC 名称
    "endpoints": ["ssm", "kms"],   // string[], 接口端点
    "gw_endpoints": ["s3"],        // string[], 网关端点

    // ===== 标签 =====
    "tags": { "key": "value" }     // map(string), 资源标签
  }
}
```

**规则：**
- `enabled: false` 的 VPC 不创建实际资源，仅用于声明 accounts（跨区域 IAM 角色场景）
- `is_hub` 每个区域最多一个，Hub VPC 不应设置 `accounts`
- `is_endpoint` 的 VPC 不应设置 `accounts`
- `accounts` 每个 VPC 最多一个账户（TGW 共享模式防止 CIDR 重叠）

### 2.1 NAT 网关

```jsonc
"nat": {
  "enabled": false,        // bool, 默认 false
  "mode": "zonal",         // enum: "zonal"(每 AZ 一个) | "regional"(仅一个)
  "type": "public",        // enum: "public" | "private"
  "tags": {}               // map(string)
}
```

**依赖规则：** 启用 NAT 必须同时启用 IGW 并配置 `public` 子网

### 2.2 互联网网关

```jsonc
"igw": {
  "enabled": false,        // bool, 默认 false
  "table": {
    "enabled": false,      // bool, 创建 IGW 路由表
    "subnets": []          // string[], IGW 路由到设备的子网名称
  }
}
```

### 2.3 AWS 网络防火墙

```jsonc
"nfw": {
  "enabled": false,        // bool, 默认 false
  "in_public": false,      // bool, 端点放置在公有子网
  "policy": {},            // map, 防火墙策略
  "protects": []           // enum[], 保护范围: "az", "delete", "policy", "subnet"
}
```

**依赖规则：** 启用 NFW 必须配置 `private` 子网

### 2.4 网关负载均衡器

```jsonc
"gwlb": {
  "enabled": false,        // bool, 默认 false
  "cross_zone": false,     // bool, 跨 AZ 负载均衡
  "in_public": false,      // bool, 端点放置在公有子网
  "same_ns_ew": true,      // bool, 南北和东西流量使用相同端点
  "same_subnet": true,     // bool, GWLB 和端点在同一子网
  "two_arm": false,        // bool, 双臂模式
  "groups": {              // 目标组映射
    "main": {
      "type": "instance",  // enum: "instance" | "ip"
      "health": {
        "enabled": false,
        "path": null,
        "port": 80,
        "protocol": "TCP"  // enum: "TCP", "HTTP", "HTTPS"
      }
    }
  }
}
```

**依赖规则：**
- 启用 GWLB 必须配置 `private` 子网
- `same_subnet: false` 时需要 `gwlb` 子网或至少两个私有子网

### 2.5 VPC 流日志

```jsonc
"log": {
  "enabled": false,        // bool
  "attaches": false,       // bool, TGW 连接流日志
  "subnets": false,        // bool, 子网流日志
  "format": null,          // string, 日志格式（null 使用默认）
  "traffic": "all",        // enum: "all", "accept", "reject"
  "types": ["cw"]          // enum[]: "s3", "cw"
}
```

---

## 三、子网定义

支持两种格式，解析器自动识别。

### 格式 A：Map 格式（推荐）

```jsonc
"subnets": {
  "intra": {               // 保留名称：TGW 连接子网（必须有 TGW 时）
    "cidrs": [[12, 0], [12, 1]],  // [newbits, netnum] × az_count
    "tags": {}
  },
  "public": {              // 保留名称：NAT/IGW 子网（必须有 NAT/IGW 时）
    "cidrs": [[8, 1], [8, 2]]
  },
  "private": {             // 保留名称：NFW/GWLB 端点子网（必须有 NFW/GWLB 时）
    "cidrs": [[8, 3], [8, 4]]
  },
  "app": {                 // 自定义名称：应用子网
    "cidrs": [[4, 3], [4, 4]]
  },
  "gwlb": {                // 特殊名称：GWLB 独立子网（same_subnet=false 时）
    "cidrs": [[8, 5], [8, 6]]
  }
}
```

### 格式 B：数组格式（旧版兼容）

```jsonc
"subnets": [
  [[4, 0], [4, 1]],       // index 0 = intra
  [[2, 1], [2, 2]],       // index 1 = public（空数组 [] 表示跳过）
  [[2, 0], [2, 1]],       // index 2 = private
  [[3, 4], [3, 5]]        // index 3+ = private-1, private-2, ...
]
```

### CIDR 计算规则

每个子网定义为 `[newbits, netnum]`：
- `newbits`：从 VPC 掩码到子网掩码的偏移量
- `netnum`：子网的网络编号
- 子网掩码 = VPC 掩码 + newbits
- 子网 IP = VPC 基础 IP + netnum × 子网大小

**示例：** VPC `10.0.0.0/16`，子网 `[8, 3]`
- 子网掩码 = 16 + 8 = /24
- 子网大小 = 2^(32-24) = 256
- 子网 IP = 10.0.0.0 + 3 × 256 = 10.0.3.0
- 结果：`10.0.3.0/24`

**保留子网名称规则：**
| 名称 | 用途 | 何时必须 |
|------|------|---------|
| `intra` | TGW 连接 | 使用 TGW 时 |
| `public` | NAT/IGW | 使用 IGW 或 NAT 时 |
| `private` | NFW/GWLB 端点默认放置 | 使用 NFW 或 GWLB 时 |
| `gwlb` | GWLB 独立子网 | `gwlb.same_subnet=false` 时 |

**约束：**
- `cidrs` 数组长度必须等于 `az_count`
- 每个元素是 `[newbits, netnum]` 二元组
- 空数组 `[]` 表示跳过该子网类型

---

## 四、Transit Gateway

```jsonc
"tgw": {
  "enabled": false,            // bool, 默认 false
  "name": "major",             // string, TGW 名称标识符
  "asn": 64512,                // int, 自治系统号（各区域必须唯一）
  "cidr": "10.0.0.0/8",       // string, 覆盖所有辐射 VPC 的通用 CIDR（各区域必须唯一）
  "cidrs": [],                 // cidr[], 额外 CIDR 块
  "description": "by CF",     // string
  "peer": false,               // bool, 创建到主区域的对等连接（仅对等区域设置）

  // ===== 功能开关 =====
  "dns": true,                // bool, DNS 支持
  "vpn_ecmp": true,           // bool, VPN ECMP 支持
  "multicast": false,         // bool, 组播支持
  "encryption": false,        // bool, 传输加密
  "auto_accept": false,       // bool, 自动接受共享挂载
  "group_ref": false,         // bool, 跨 VPC 安全组引用

  // ===== 路由表 =====
  "tables": { ... },          // 见 4.1

  // ===== 连接附件 =====
  "connects": { ... },        // 见 4.2

  // ===== 流日志 =====
  "log": { ... }              // 同 VPC 流日志格式
}
```

**多区域规则：**
- 主区域 TGW 不应设置 `peer: true`
- 各区域 `asn` 必须唯一
- 各区域 `cidr` 必须唯一
- 仅主区域 TGW 与 DX 网关关联

### 4.1 路由表

```jsonc
"tables": {
  "table-name": {              // 路由表名称（如 pre, post, spoke, firewall）
    "associations": [          // string[], 路由表关联
      "vpc-name",              // VPC 名称 → 该 VPC 使用此路由表
      "peer"                   // 特殊值：对等附件使用此路由表
    ],
    "propagations": [          // string[], 路由传播
      "vpc-name"               // VPC 名称 → 从该 VPC 学习路由
    ],
    "routes": {                // map(string), 静态路由
      "*": "hub-vpc",          // 默认路由 (0.0.0.0/0) → 转发到 VPC
      "tgw": "blackhole",     // 区域通用 CIDR → 黑洞（丢弃）
      "tgw": "inspect-vpc",   // 区域通用 CIDR → 转发到检查 VPC
      "main": "peer",         // 主区域 CIDR → 通过对等连接
      "us-east-1": "peer",    // 指定区域 CIDR → 通过对等连接
      "10.0.0.0/8": "vpc-name" // 直接 CIDR → 转发到 VPC
    },
    "tags": {}                 // map(string)
  }
}
```

**路由键（key）含义：**
| 键 | 含义 |
|---|------|
| `*` | 默认路由 0.0.0.0/0 |
| `tgw` | 当前区域 TGW 通用 CIDR |
| `main` | 主区域 TGW 通用 CIDR |
| 区域代码（如 `us-east-1`） | 该区域 TGW 通用 CIDR |
| VPC 名称 | 该 VPC 的 CIDR |
| CIDR 块（如 `10.0.0.0/8`） | 直接指定的 CIDR |

**路由值（target）含义：**
| 值 | 含义 |
|---|------|
| `blackhole` | 黑洞路由，丢弃匹配流量 |
| `peer` | 通过 TGW 对等连接转发 |
| VPC 名称 | 转发到该 VPC 的 TGW 附件 |

### 4.2 连接附件

```jsonc
"connects": {
  "connect-name": {
    "attachment": "vpc-name",  // string, VPC 或 Direct Connect 附件
    "address": "from-tgw-cidr", // string, TGW 侧地址
    "cidrs": ["169.254.7.0/29"], // cidr[], BGP 对等内部 CIDR
    "peer": {
      "enabled": false,        // bool, 启用 BGP 对等
      "asn": 64515,            // int, 对等 ASN
      "address": "192.168.0.11" // string, 对等设备地址
    }
  }
}
```

---

## 五、Route 53 Resolver

```jsonc
"resolver": {
  "in": {                      // 入站端点（一个）
    "vpc": "hub-vpc",          // string, 端点放置的 VPC（使用 intra 子网）
    "groups": ["default"]      // string[], 安全组
  },
  "out": {                     // 出站端点（一个）
    "vpc": "hub-vpc",
    "groups": ["default"]
  },
  "rules": {                   // 转发规则（map）
    "rule-name": {
      "domain": "site.company.com",  // string, 域名
      "ips": ["123.45.67.89"],       // string[], 目标 IP
      "type": "FORWARD",             // enum: "FORWARD", "SYSTEM", "RECURSIVE"
      "vpcs": ["dev"]                // string[], 关联的 VPC
    }
  }
}
```

---

## 六、Direct Connect

```jsonc
"dx": {
  "enabled": false,            // bool
  "asn": 64512,                // int, 自治系统号
  "prefixes": ["10.0.0.0/8"]  // cidr[], 允许的前缀通告（默认 [tgw.cidr]）
}
```

**规则：**
- 仅在主区域配置
- 必须同时启用主区域 TGW
- 多个 TGW 关联同一 DX 网关时，前缀不允许重叠

---

## 七、安全组定义

```jsonc
"groups": {
  "group-name": {
    "in": [                    // 入站规则数组
      {
        "cidr": "*",           // "*" = 0.0.0.0/0, "vpc" = VPC CIDR
        "protocol": "http",   // 预定义协议或 "tcp"/"udp"/"*"
        "ports": [80],         // int[], 端口（单端口或范围）
        "group": "default",    // 引用安全组："default", "this", 或组 ID
        "description": ""      // string
      }
    ],
    "out": [                   // 出站规则数组
      { "cidr": "*", "protocol": "*" }
    ]
  }
}
```

**预定义协议：** http(80), https(443), ssh(22), rdp(3389), mssql(1433), mysql(3306), postgres(5432), oracle(1521), redshift(5439), nfs(2049)

**特殊 cidr 值：**
| 值 | 含义 |
|---|------|
| `*` | 0.0.0.0/0（所有流量） |
| `vpc` | 当前 VPC 的 CIDR |

**特殊 group 值：**
| 值 | 含义 |
|---|------|
| `default` | VPC 默认安全组 |
| `this` | 自引用（同组内流量） |
| `sg-xxx` | 直接引用安全组 ID |

---

## 八、常见架构模式速查

### 8.1 集中式出口（Hub-Spoke）
```
Hub VPC: is_hub + igw + nat + intra + public
Spoke VPC: intra + private
TGW: pre(spoke→hub, tgw→blackhole), post(hub, propagate spokes)
```

### 8.2 南北流量检查
```
Hub VPC: is_hub + igw + nat + nfw/gwlb + intra + public + private
Spoke VPC: intra + private
TGW: pre(spoke→hub), post(hub, propagate spokes)
```

### 8.3 东西流量检查
```
Hub VPC: is_hub + gwlb + intra + private（无 igw/nat）
Spoke VPC: intra + private
TGW: pre(spoke→hub), post(hub, propagate spokes)
```

### 8.4 分离检查（东西+南北）
```
Inspect VPC: nfw + intra + private
Egress VPC: is_hub + igw + nat + gwlb + intra + public + private + gwlb子网
Ingress VPC: igw + gwlb(in_public) + intra + public + private
Spoke VPC: intra + private
TGW: pre(spoke→egress, tgw→inspect), post(inspect+egress, propagate spokes)
```

### 8.5 多区域对等
```
主区域: 完整架构 + tgw.tables 中 region→peer 路由
对等区域: 完整架构 + tgw.peer=true + tables 中 main→peer 路由
```

### 8.6 VPC 对等（无 TGW）
```
VPC: peers=["other-vpc"] + private（无 intra）
无 TGW
```

### 8.7 端点集中访问
```
Endpoint VPC: is_endpoint + endpoints=["ssm","kms",...] + intra + private
Spoke VPC: intra + private
TGW: pre(spoke, propagate endpoint), post(endpoint, propagate spokes)
```

---

## 九、校验规则汇总

| 规则 | 级别 | 说明 |
|------|------|------|
| VPC 缺少 CIDR | error | enabled=true 的 VPC 必须有 cidr |
| CIDR 格式无效 | error | 必须匹配 x.x.x.x/N，掩码 0-32 |
| NAT 无 IGW | error | nat.enabled 需要 igw.enabled |
| NAT 无 public 子网 | error | nat.enabled 需要 public 子网 |
| NFW/GWLB 无 private 子网 | error | 需要 private 子网 |
| TGW 无 intra 子网 | warning | VPC 无法连接 TGW |
| TGW 缺少 CIDR | error | enabled 的 TGW 必须有 cidr |
| 路由表引用不存在的 VPC | warning | associations/propagations/routes 中的 VPC 名 |
| 多区域 ASN 重复 | error | 各区域 TGW ASN 必须唯一 |
| 多区域 CIDR 重复 | error | 各区域 TGW CIDR 必须唯一 |
| 主区域设置 peer | error | 主区域 TGW 不应 peer=true |
| Hub VPC 设置 accounts | warning | Hub/Endpoint VPC 不应共享 |
| 多账户 VPC | warning | TGW 共享模式下可能 CIDR 重叠 |
| cidrs 长度 ≠ az_count | warning | 子网 AZ 数量不一致 |
| GWLB same_subnet=false 无 gwlb 子网 | warning | 需要独立 gwlb 子网 |
| Resolver VPC 引用不存在 | warning | in/out/rules 中的 VPC 名 |
| DX 无 TGW | warning | DX 需要主区域 TGW |
